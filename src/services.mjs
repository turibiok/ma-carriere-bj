// Traitements métier sur la base : exécution du moteur, circuit des actes,
// démarches. L'API HTTP (api.mjs) ne fait que vérifier les droits et appeler ces fonctions.

import { randomBytes } from 'node:crypto';
import { lireRegles, journaliser } from './db.mjs';
import {
  detecterEvenements, dateRetraite, ageRetraite, indice, noteSur20, mention, ajouterMois, echelonMax, gradeDe,
  libelleEchelle, exigeRapportSpecial,
} from './regles.mjs';
import { resoudrePieces, DEMARCHES, PIECES } from './pieces.mjs';
import { ETAPES, criteres, remplacerObjectifs } from './evaluation.mjs';
import { lireFichier, enregistrerDocument } from './fichiers.mjs';

export const aujourdhui = () => new Date().toISOString().slice(0, 10);
const json = (v) => JSON.stringify(v);
export class ErreurMetier extends Error {
  constructor(message, statut = 400) { super(message); this.statut = statut; }
}

const TYPES_SIGNABLES = ['AVANCEMENT_ECHELON', 'AVENANT', 'AVANCEMENT_GRADE', 'TITULARISATION', 'DEPART_RETRAITE'];

export function agentComplet(db, id) {
  const a = db.prepare(`SELECT a.*, c.libelle AS corps, c.secteur, s.nom AS structure, s.departement, s.ministere,
      (SELECT prenoms || ' ' || nom FROM agents x WHERE x.id = a.superieur_id) AS superieur
    FROM agents a JOIN corps c ON c.code = a.corps_code JOIN structures s ON s.id = a.structure_id WHERE a.id = ?`).get(id);
  if (!a) throw new ErreurMetier('Agent introuvable', 404);
  const regles = lireRegles(db);
  a.indice = indice(a.echelle, a.echelon);
  a.grade = a.statut === 'APE' ? gradeDe(a.echelon, regles) : null;
  a.libelle_echelle = libelleEchelle(a);
  a.age_retraite = ageRetraite(a, regles);
  a.date_retraite = dateRetraite(a, regles);
  a.prochain_echelon = a.echelon < echelonMax(regles) ? ajouterMois(a.date_effet_echelon, regles.duree_echelon_mois) : null;
  return a;
}

// --- Moteur de règles ---

export function executerMoteur(db, utilisateur = 'systeme', date = aujourdhui()) {
  const regles = lireRegles(db);
  const agents = db.prepare("SELECT a.*, c.secteur FROM agents a JOIN corps c ON c.code = a.corps_code WHERE position = 'ACTIVITE'").all();
  const evals = db.prepare('SELECT annee, note_finale, statut FROM evaluations WHERE agent_id = ?');
  const dipl = db.prepare('SELECT * FROM diplomes WHERE agent_id = ?');
  const purger = db.prepare("DELETE FROM evenements WHERE agent_id = ? AND statut = 'PROPOSE'");
  const dejaTraite = db.prepare("SELECT 1 FROM evenements WHERE agent_id = ? AND type = ? AND date_effet = ? AND statut NOT IN ('PROPOSE','REJETE')");
  const inserer = db.prepare('INSERT INTO evenements (agent_id, type, libelle, date_effet, details, cree_le) VALUES (?, ?, ?, ?, ?, ?)');
  const compte = {};
  db.exec('BEGIN');
  try {
    for (const a of agents) {
      purger.run(a.id);
      const props = detecterEvenements(a, { evaluations: evals.all(a.id), diplomes: dipl.all(a.id) }, regles, date);
      for (const p of props) {
        if (dejaTraite.get(a.id, p.type, p.date_effet)) continue;
        inserer.run(a.id, p.type, p.libelle, p.date_effet, json(p.details), date);
        compte[p.type] = (compte[p.type] ?? 0) + 1;
      }
    }
    journaliser(db, utilisateur, 'Exécution du moteur de règles', json(compte));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { agents: agents.length, propositions: compte };
}

// --- Actes ---

function creerActe(db, { type, agent_id, objet, signataire, contenu = {} }) {
  const annee = aujourdhui().slice(0, 4);
  const n = db.prepare('SELECT COUNT(*) AS n FROM actes').get().n + 1;
  const numero = `${String(n).padStart(5, '0')}/${annee}/DRH`;
  const code = randomBytes(5).toString('hex').toUpperCase();
  const r = db.prepare('INSERT INTO actes (numero, type, agent_id, objet, date_signature, signataire, code_verification, contenu) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(numero, type, agent_id, objet, aujourdhui(), signataire, code, json(contenu));
  return { id: Number(r.lastInsertRowid), numero, code };
}

// Gestionnaire : PROPOSE → VALIDE_RH. DRH : VALIDE_RH → SIGNE (acte + mise à jour de la situation).
export function validerEvenement(db, id, user) {
  const e = db.prepare('SELECT * FROM evenements WHERE id = ?').get(id);
  if (!e) throw new ErreurMetier('Proposition introuvable', 404);
  if (e.type === 'ALERTE') {
    if (e.statut !== 'PROPOSE') throw new ErreurMetier('Alerte déjà traitée');
    db.prepare("UPDATE evenements SET statut = 'TRAITE' WHERE id = ?").run(id);
    journaliser(db, user.nom, 'Alerte traitée', `evenement ${id}`);
    return { statut: 'TRAITE' };
  }
  if (e.statut === 'PROPOSE') {
    if (!['gestionnaire', 'drh'].includes(user.role)) throw new ErreurMetier('Réservé au gestionnaire RH', 403);
    db.prepare("UPDATE evenements SET statut = 'VALIDE_RH' WHERE id = ?").run(id);
    journaliser(db, user.nom, 'Proposition instruite', `${e.type} agent ${e.agent_id}`);
    return { statut: 'VALIDE_RH' };
  }
  if (e.statut !== 'VALIDE_RH') throw new ErreurMetier('Cette proposition ne peut plus être validée');
  if (user.role !== 'drh') throw new ErreurMetier('La signature est réservée au DRH', 403);
  if (!TYPES_SIGNABLES.includes(e.type)) throw new ErreurMetier('Type non signable');

  const d = JSON.parse(e.details);
  const a = agentComplet(db, e.agent_id);
  db.exec('BEGIN');
  try {
    const acte = creerActe(db, {
      type: e.type, agent_id: a.id, objet: e.libelle, signataire: user.nom,
      contenu: { ...d, date_effet: e.date_effet, situation_avant: `${a.echelle}-${a.echelon}`, indice_avant: a.indice },
    });
    const hist = db.prepare('INSERT INTO historique (agent_id, date_effet, type, libelle, acte_id) VALUES (?, ?, ?, ?, ?)');
    if (e.type === 'AVANCEMENT_ECHELON' || e.type === 'AVENANT') {
      db.prepare('UPDATE agents SET echelon = ?, date_effet_echelon = ? WHERE id = ?').run(d.vers, e.date_effet, a.id);
      const mot = e.type === 'AVENANT' ? 'Avenant : palier' : 'Avancement à l\'échelon';
      for (const et of d.etapes) hist.run(a.id, et.date_effet, e.type, `${mot} ${et.echelon} (acte ${acte.numero})`, acte.id);
    } else if (e.type === 'AVANCEMENT_GRADE') {
      db.prepare('UPDATE agents SET echelon = ?, date_effet_echelon = ? WHERE id = ?').run(d.vers, e.date_effet, a.id);
      hist.run(a.id, e.date_effet, e.type, `Avancement au grade ${d.grade_vers}, échelon ${d.vers} (acte ${acte.numero})`, acte.id);
    } else if (e.type === 'TITULARISATION') {
      db.prepare('UPDATE agents SET stagiaire = 0 WHERE id = ?').run(a.id);
      hist.run(a.id, e.date_effet, e.type, `Titularisation (acte ${acte.numero})`, acte.id);
    } else if (e.type === 'DEPART_RETRAITE') {
      if (e.date_effet <= aujourdhui()) db.prepare("UPDATE agents SET position = 'RETRAITE' WHERE id = ?").run(a.id);
      hist.run(a.id, e.date_effet, e.type, `Admission à la retraite ; dossier transmis pour liquidation automatique de la pension (acte ${acte.numero})`, acte.id);
    }
    db.prepare("UPDATE evenements SET statut = 'SIGNE', acte_id = ? WHERE id = ?").run(acte.id, id);
    journaliser(db, user.nom, 'Acte signé', `${acte.numero} – ${e.libelle}`);
    db.exec('COMMIT');
    return { statut: 'SIGNE', acte };
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

export function rejeterEvenement(db, id, motif, user) {
  if (!motif) throw new ErreurMetier('Le motif du rejet est obligatoire');
  const e = db.prepare('SELECT * FROM evenements WHERE id = ?').get(id);
  if (!e || !['PROPOSE', 'VALIDE_RH'].includes(e.statut)) throw new ErreurMetier('Proposition non rejetable');
  db.prepare("UPDATE evenements SET statut = 'REJETE', motif_rejet = ? WHERE id = ?").run(motif, id);
  journaliser(db, user.nom, 'Proposition rejetée', `${e.type} agent ${e.agent_id} : ${motif}`);
}

// --- Évaluation ---

function majFiche(fiche, valeurs, champ) {
  for (const c of criteres(fiche)) {
    const v = Number(valeurs?.[c.code]);
    if (!(v >= 1 && v <= 5)) throw new ErreurMetier(`Note manquante ou invalide : ${c.libelle}`);
    c[champ] = v;
  }
}

export function actionEvaluation(db, id, action, corps, user) {
  const ev = db.prepare('SELECT e.*, a.superieur_id FROM evaluations e JOIN agents a ON a.id = e.agent_id WHERE e.id = ?').get(id);
  if (!ev) throw new ErreurMetier('Fiche introuvable', 404);
  const fiche = JSON.parse(ev.fiche);
  const regles = lireRegles(db);
  const estAgent = user.agent_id === ev.agent_id;
  const estEvaluateur = user.agent_id && user.agent_id === ev.superieur_id;
  const exiger = (cond, msg) => { if (!cond) throw new ErreurMetier(msg, 403); };
  const etat = (s) => { if (ev.statut !== s) throw new ErreurMetier(`Étape attendue : ${ETAPES[s].libelle}`); };
  const maj = db.prepare('UPDATE evaluations SET statut = ?, fiche = ?, note_finale = ?, mention = ?, commentaire_evaluateur = ?, commentaire_agent = ?, decision_commission = ?, maj = ? WHERE id = ?');
  let { statut, note_finale, mention: men, commentaire_evaluateur, commentaire_agent, decision_commission } = ev;

  switch (action) {
    case 'objectifs':
      exiger(estEvaluateur, "Seul le supérieur hiérarchique fixe les objectifs");
      etat('OBJECTIFS_FIXES');
      if (!Array.isArray(corps.objectifs) || !corps.objectifs.length) throw new ErreurMetier('Au moins un objectif');
      remplacerObjectifs(fiche, corps.objectifs.map((o) => String(o).trim()).filter(Boolean));
      break;
    case 'auto':
      exiger(estAgent, "Seul l'agent remplit son auto-évaluation");
      etat('OBJECTIFS_FIXES');
      majFiche(fiche, corps.notes, 'auto');
      commentaire_agent = corps.commentaire ?? null;
      statut = 'AUTO_EVALUEE';
      break;
    case 'evaluer':
      exiger(estEvaluateur, "Seul le supérieur hiérarchique note l'agent");
      etat('AUTO_EVALUEE');
      majFiche(fiche, corps.notes, 'note');
      note_finale = noteSur20(fiche, regles.ponderation_evaluation);
      men = mention(note_finale, regles.mentions);
      commentaire_evaluateur = (corps.commentaire ?? '').trim() || null;
      if (exigeRapportSpecial(note_finale, regles) && (commentaire_evaluateur ?? '').length < 40) {
        throw new ErreurMetier(`Note de ${note_finale}/20 : un rapport spécial motivé (40 caractères au moins) est obligatoire`);
      }
      statut = 'EVALUEE';
      break;
    case 'viser':
      exiger(estAgent, "Seul l'agent vise sa fiche");
      etat('EVALUEE');
      if (corps.accord) statut = 'CLOTUREE';
      else {
        if (!corps.motif) throw new ErreurMetier('Le motif de la contestation est obligatoire');
        statut = 'CONTESTEE';
        commentaire_agent = corps.motif;
      }
      break;
    case 'commission':
      exiger(user.role === 'drh', 'Réservé à la commission (DRH)');
      etat('CONTESTEE');
      if (corps.note !== undefined && corps.note !== null && corps.note !== '') {
        const n = Number(corps.note);
        if (!(n >= 0 && n <= 20)) throw new ErreurMetier('Note sur 20 attendue');
        note_finale = n;
        men = mention(n, regles.mentions);
      }
      decision_commission = corps.decision || 'Note maintenue';
      statut = 'CLOTUREE';
      break;
    default:
      throw new ErreurMetier('Action inconnue', 404);
  }
  maj.run(statut, json(fiche), note_finale, men, commentaire_evaluateur, commentaire_agent, decision_commission, aujourdhui(), id);
  journaliser(db, user.nom, `Évaluation : ${action}`, `fiche ${id} (${statut})`);
  return { statut, note_finale, mention: men };
}

// --- Démarches (« dites-le nous une fois ») ---

export function dossierAgent(db, agentId) {
  const a = db.prepare('SELECT npi, statut FROM agents WHERE id = ?').get(agentId);
  const coffre = db.prepare('SELECT type_piece FROM coffre WHERE agent_id = ? AND verifie = 1').all(agentId).map((r) => r.type_piece);
  return { npi: a?.npi, statut: a?.statut, coffre };
}

export function catalogueDemarches(db, agentId) {
  const dossier = dossierAgent(db, agentId);
  return Object.keys(DEMARCHES).map((t) => resoudrePieces(t, dossier));
}

const PIECES_CONSERVEES = ['RIB', 'PHOTOS']; // déposées une fois, réutilisées ensuite

// fichiers : { TYPE_PIECE: { nom, contenu (base64) } } — seules les pièces « à fournir » sont attendues.
export function deposerDemande(db, agentId, { type, motif, fichiers = {}, diplome }, user) {
  if (!DEMARCHES[type]) throw new ErreurMetier('Démarche inconnue');
  const r = resoudrePieces(type, dossierAgent(db, agentId));
  if (!r.ouverte) throw new ErreurMetier("Cette démarche n'est pas ouverte à votre statut");
  const aFournir = r.pieces.filter((p) => p.a_fournir);
  const manquantes = aFournir.filter((p) => !fichiers[p.type]);
  if (manquantes.length) throw new ErreurMetier(`Pièces à joindre : ${manquantes.map((p) => p.libelle).join(', ')}`);
  const lus = aFournir.map((p) => ({ type: p.type, fichier: lireFichier(fichiers[p.type], p.libelle) }));
  if (['DISPONIBILITE', 'DETACHEMENT', 'MUTATION', 'RECLAMATION'].includes(type) && !String(motif ?? '').trim()) throw new ErreurMetier('Précisez le motif');
  if (type === 'DECLARATION_DIPLOME' && !(diplome?.intitule && diplome?.niveau && diplome?.date_obtention)) throw new ErreurMetier('Renseignez le diplôme');

  db.exec('BEGIN');
  try {
    // Pièces durables (RIB, photos) : rangées au coffre-fort, elles ne seront plus redemandées.
    for (const { type: t, fichier } of lus.filter((x) => PIECES_CONSERVEES.includes(x.type))) {
      const docId = enregistrerDocument(db, { agent_id: agentId, type_piece: t, fichier, depose_le: aujourdhui() });
      db.prepare('INSERT INTO coffre (agent_id, type_piece, libelle, date_depot, document_id) VALUES (?, ?, ?, ?, ?)')
        .run(agentId, t, PIECES[t].libelle, aujourdhui(), docId);
    }
    if (type === 'DECLARATION_DIPLOME') {
      db.prepare('INSERT INTO diplomes (agent_id, intitule, niveau, date_obtention, verifie, pris_en_compte) VALUES (?, ?, ?, ?, 0, 0)')
        .run(agentId, diplome.intitule, diplome.niveau, diplome.date_obtention);
    }
    let statut = 'DEPOSEE', acteId = null, reponse = null;
    if (type === 'ATTESTATION_SERVICE') {
      // Toutes les informations sont en base : délivrance immédiate.
      const a = agentComplet(db, agentId);
      const acte = creerActe(db, {
        type: 'ATTESTATION', agent_id: agentId, signataire: 'Délivrance automatique',
        objet: `Attestation de service de ${a.prenoms} ${a.nom}`,
        contenu: { corps: a.corps, structure: a.structure, situation: `${a.echelle}-${a.echelon}`, prise_service: a.date_prise_service, statut: a.statut },
      });
      statut = 'DELIVREE'; acteId = acte.id; reponse = `Attestation n° ${acte.numero}`;
    }
    const res = db.prepare('INSERT INTO demandes (agent_id, type, motif, statut, pieces, depose_le, traite_le, reponse, acte_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(agentId, type, motif ?? null, statut, json(r), aujourdhui(), statut === 'DELIVREE' ? aujourdhui() : null, reponse, acteId);
    // Pièces propres à cette démarche (justificatif du motif, nouveau diplôme…) : jointes à la demande.
    for (const { type: t, fichier } of lus.filter((x) => !PIECES_CONSERVEES.includes(x.type))) {
      enregistrerDocument(db, { agent_id: agentId, demande_id: Number(res.lastInsertRowid), type_piece: t, fichier, depose_le: aujourdhui() });
    }
    journaliser(db, user.nom, `Démarche déposée : ${r.libelle}`, `agent ${agentId}, ${r.evitees}/${r.total} pièces obtenues sans l'agent`);
    db.exec('COMMIT');
    return { id: Number(res.lastInsertRowid), statut, reponse, evitees: r.evitees, total: r.total };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function traiterDemande(db, id, { decision, reponse }, user) {
  const d = db.prepare('SELECT * FROM demandes WHERE id = ?').get(id);
  if (!d || d.statut !== 'DEPOSEE') throw new ErreurMetier('Demande non traitable');
  if (!['ACCEPTEE', 'REJETEE'].includes(decision)) throw new ErreurMetier('Décision attendue');
  if (decision === 'REJETEE' && !reponse) throw new ErreurMetier('Motivez le rejet');
  db.exec('BEGIN');
  try {
    let acteId = null;
    if (decision === 'ACCEPTEE' && ['DISPONIBILITE', 'DETACHEMENT', 'MUTATION'].includes(d.type)) {
      const acte = creerActe(db, { type: d.type, agent_id: d.agent_id, objet: DEMARCHES[d.type].libelle, signataire: user.nom, contenu: { motif: d.motif } });
      acteId = acte.id;
      if (d.type !== 'MUTATION') db.prepare('UPDATE agents SET position = ? WHERE id = ?').run(d.type, d.agent_id);
      db.prepare('INSERT INTO historique (agent_id, date_effet, type, libelle, acte_id) VALUES (?, ?, ?, ?, ?)')
        .run(d.agent_id, aujourdhui(), d.type, `${DEMARCHES[d.type].libelle} (acte ${acte.numero})`, acte.id);
    }
    db.prepare('UPDATE demandes SET statut = ?, traite_le = ?, reponse = ?, acte_id = ? WHERE id = ?')
      .run(decision, aujourdhui(), reponse ?? (decision === 'ACCEPTEE' ? 'Demande acceptée' : null), acteId, id);
    journaliser(db, user.nom, `Demande ${decision.toLowerCase()}`, `demande ${id}`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function verifierDiplome(db, id, user) {
  const r = db.prepare('UPDATE diplomes SET verifie = 1 WHERE id = ? AND verifie = 0').run(id);
  if (!r.changes) throw new ErreurMetier('Diplôme introuvable ou déjà vérifié');
  journaliser(db, user.nom, 'Diplôme vérifié', `diplome ${id}`);
}
