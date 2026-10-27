// Inscription en ligne d'un agent de l'État : choix du secteur, identité et emploi,
// justificatifs d'emploi public, mot de passe. Le service du personnel vérifie la demande
// en la rapprochant du dossier RH, puis active le compte. Les justificatifs validés
// rejoignent le coffre-fort de l'agent : ils ne lui seront plus redemandés.

import { journaliser } from './db.mjs';
import { ErreurMetier, aujourdhui } from './services.mjs';
import { hacher } from './motdepasse.mjs';
import { normaliserTelephone, politiqueMotDePasse } from './auth.mjs';
import { lireFichier, enregistrerDocument, TAILLE_MAX } from './fichiers.mjs';

export { TAILLE_MAX, politiqueMotDePasse };

export const STATUTS_AGENT = {
  APE: 'Fonctionnaire (agent permanent de l\'État)',
  ACDPE: "Agent contractuel de droit public de l'État (ACDPE)",
  AUTRE: "Autre agent contractuel de l'État",
};

export const JUSTIFICATIFS = [
  { type: 'ACTE_ENGAGEMENT', libelle: "Acte d'engagement : arrêté de nomination ou contrat de travail", obligatoire: true },
  { type: 'BULLETIN_SOLDE', libelle: 'Dernier bulletin de solde (moins de 3 mois)', obligatoire: true },
  { type: 'ATTESTATION_SERVICE', libelle: 'Attestation de présence au poste ou certificat de prise de service', obligatoire: true },
  { type: 'CARTE_PROFESSIONNELLE', libelle: 'Carte professionnelle', obligatoire: false },
];

const normaliserNom = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
const nettoyer = (s, max = 120) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function deposerInscription(db, d, maintenant = new Date()) {
  const secteur = db.prepare('SELECT code FROM secteurs WHERE code = ?').get(d.secteur);
  if (!secteur) throw new ErreurMetier("Choisissez votre secteur d'activité.");
  const npi = String(d.npi ?? '').trim();
  if (!/^\d{10}$/.test(npi)) throw new ErreurMetier('Le NPI comporte 10 chiffres.');
  const champs = {
    nom: nettoyer(d.nom, 60).toUpperCase(), prenoms: nettoyer(d.prenoms, 80), matricule: nettoyer(d.matricule, 20).toUpperCase(),
    ministere: nettoyer(d.ministere), structure: nettoyer(d.structure), emploi: nettoyer(d.emploi),
  };
  const manquant = Object.entries({ nom: 'le nom', prenoms: 'les prénoms', matricule: 'le matricule', ministere: 'le ministère ou l\'institution', structure: "la structure d'affectation", emploi: "l'emploi ou le corps" })
    .find(([k]) => !champs[k]);
  if (manquant) throw new ErreurMetier(`Renseignez ${manquant[1]}.`);
  if (!STATUTS_AGENT[d.statut_agent]) throw new ErreurMetier('Précisez votre statut.');
  const naissance = String(d.date_naissance ?? '');
  const age = (maintenant - Date.parse(naissance)) / (365.25 * 864e5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(naissance) || !(age >= 18 && age <= 70)) throw new ErreurMetier('Date de naissance invalide.');
  const telephone = normaliserTelephone(d.telephone);
  if (!/^\d{10}$/.test(telephone)) throw new ErreurMetier('Le numéro de téléphone comporte 10 chiffres (01 XX XX XX XX).');
  const email = nettoyer(d.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErreurMetier("L'adresse e-mail est invalide.");
  politiqueMotDePasse(d.mot_de_passe);
  if (!d.consentement) throw new ErreurMetier("Certifiez l'exactitude des informations et acceptez le traitement de vos données.");

  // Justificatifs : obligatoires présents, 2 Mo au plus, PDF, JPEG ou PNG.
  const fichiers = [];
  for (const j of JUSTIFICATIFS) {
    const f = d.justificatifs?.[j.type];
    if (!f) {
      if (j.obligatoire) throw new ErreurMetier(`Justificatif manquant : ${j.libelle}.`);
      continue;
    }
    fichiers.push({ type: j.type, ...lireFichier(f, j.libelle) });
  }

  // Doublons : un compte existe déjà, ou une demande est déjà en cours.
  if (db.prepare('SELECT 1 FROM utilisateurs WHERE npi = ? OR UPPER(matricule) = ?').get(npi, champs.matricule)) {
    throw new ErreurMetier('Un compte existe déjà pour ce NPI ou ce matricule. Connectez-vous ou utilisez « Mot de passe oublié ».', 409);
  }
  if (db.prepare("SELECT 1 FROM inscriptions WHERE (npi = ? OR UPPER(matricule) = ?) AND statut = 'EN_ATTENTE'").get(npi, champs.matricule)) {
    throw new ErreurMetier('Une demande d\'inscription est déjà en cours de vérification pour ce NPI ou ce matricule.', 409);
  }

  db.exec('BEGIN');
  try {
    const annee = aujourdhui().slice(0, 4);
    const n = db.prepare('SELECT COUNT(*) AS n FROM inscriptions').get().n + 1;
    const numero = `INS-${annee}-${String(n).padStart(5, '0')}`;
    const r = db.prepare(`INSERT INTO inscriptions (numero, secteur, npi, nom, prenoms, date_naissance, matricule, statut_agent,
        ministere, structure, emploi, telephone, email, mot_de_passe, depose_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(numero, secteur.code, npi, champs.nom, champs.prenoms, naissance, champs.matricule, d.statut_agent,
        champs.ministere, champs.structure, champs.emploi, telephone, email || null, hacher(String(d.mot_de_passe)), maintenant.toISOString());
    const id = Number(r.lastInsertRowid);
    const insJ = db.prepare('INSERT INTO justificatifs (inscription_id, type, nom_fichier, mime, taille, contenu) VALUES (?, ?, ?, ?, ?, ?)');
    for (const f of fichiers) insJ.run(id, f.type, f.nom, f.mime, f.octets.length, f.octets);
    journaliser(db, `${champs.prenoms} ${champs.nom}`, "Demande d'inscription déposée", `${numero}, ${fichiers.length} justificatif(s)`);
    db.exec('COMMIT');
    return { numero, statut: 'EN_ATTENTE' };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Suivi public : il faut le numéro de demande ET le NPI.
export function suivreInscription(db, numero, npi) {
  const i = db.prepare('SELECT numero, statut, motif, depose_le, traite_le FROM inscriptions WHERE numero = ? AND npi = ?')
    .get(String(numero ?? '').trim().toUpperCase(), String(npi ?? '').trim());
  if (!i) throw new ErreurMetier('Aucune demande ne correspond à ce numéro et à ce NPI.', 404);
  return i;
}

// Rapprochement avec la base RH, pour aider le gestionnaire à vérifier la demande.
export function correspondance(db, i) {
  const parNpi = db.prepare('SELECT a.*, c.secteur, c.libelle AS corps FROM agents a JOIN corps c ON c.code = a.corps_code WHERE a.npi = ?').get(i.npi);
  const parMatricule = db.prepare('SELECT a.*, c.secteur, c.libelle AS corps FROM agents a JOIN corps c ON c.code = a.corps_code WHERE UPPER(a.matricule) = ?').get(i.matricule);
  const agent = parNpi && parMatricule && parNpi.id === parMatricule.id ? parNpi : null;
  return {
    agent_id: agent?.id ?? null,
    controles: [
      { libelle: 'NPI connu dans la base RH', ok: Boolean(parNpi) },
      { libelle: 'Matricule connu dans la base RH', ok: Boolean(parMatricule) },
      { libelle: 'NPI et matricule désignent le même agent', ok: Boolean(agent) },
      { libelle: 'Nom identique au dossier', ok: Boolean(agent && normaliserNom(agent.nom) === normaliserNom(i.nom)) },
      { libelle: 'Date de naissance identique au dossier', ok: Boolean(agent && agent.date_naissance === i.date_naissance) },
      { libelle: 'Secteur identique au dossier', ok: Boolean(agent && agent.secteur === i.secteur) },
      { libelle: 'Aucun compte existant pour cet agent', ok: !(agent && db.prepare('SELECT 1 FROM utilisateurs WHERE agent_id = ?').get(agent.id)) },
    ],
    dossier: agent ? { nom: `${agent.prenoms} ${agent.nom}`, corps: agent.corps, matricule: agent.matricule, statut: agent.statut } : null,
  };
}

export function detailInscription(db, id) {
  const i = db.prepare(`SELECT i.*, s.libelle AS secteur_libelle FROM inscriptions i JOIN secteurs s ON s.code = i.secteur WHERE i.id = ?`).get(id);
  if (!i) throw new ErreurMetier('Demande introuvable', 404);
  const { mot_de_passe, ...reste } = i;
  return {
    ...reste,
    statut_agent_libelle: STATUTS_AGENT[i.statut_agent],
    justificatifs: db.prepare('SELECT id, type, nom_fichier, mime, taille FROM justificatifs WHERE inscription_id = ?').all(id)
      .map((j) => ({ ...j, libelle: JUSTIFICATIFS.find((x) => x.type === j.type)?.libelle ?? j.type })),
    correspondance: correspondance(db, i),
  };
}

export function lireJustificatif(db, inscriptionId, justificatifId) {
  const j = db.prepare('SELECT nom_fichier, mime, contenu FROM justificatifs WHERE id = ? AND inscription_id = ?').get(justificatifId, inscriptionId);
  if (!j) throw new ErreurMetier('Justificatif introuvable', 404);
  return j;
}

export function validerInscription(db, id, user) {
  const i = db.prepare('SELECT * FROM inscriptions WHERE id = ?').get(id);
  if (!i || i.statut !== 'EN_ATTENTE') throw new ErreurMetier('Demande non traitable');
  const c = correspondance(db, i);
  const bloquants = c.controles.filter((x) => !x.ok);
  if (bloquants.length) {
    throw new ErreurMetier(`Validation impossible : ${bloquants.map((x) => x.libelle.toLowerCase()).join(' ; ')} — non vérifié.`);
  }
  const agent = db.prepare(`SELECT a.*, c.libelle AS corps, s.nom AS structure_nom FROM agents a JOIN corps c ON c.code = a.corps_code
    JOIN structures s ON s.id = a.structure_id WHERE a.id = ?`).get(c.agent_id);
  const encadre = db.prepare('SELECT 1 FROM agents WHERE superieur_id = ?').get(agent.id);
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO utilisateurs (id, nom, role, agent_id, description, matricule, npi, telephone, mot_de_passe)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(`u-${agent.id}`, `${agent.prenoms} ${agent.nom}`, encadre ? 'evaluateur' : 'agent', agent.id,
      `${agent.fonction ?? agent.corps}${agent.statut === 'ACDPE' ? ' (ACDPE)' : ''}, ${agent.structure_nom}`,
      agent.matricule, agent.npi, i.telephone, i.mot_de_passe);
    // Les justificatifs vérifiés rejoignent le coffre-fort : ils ne seront plus redemandés.
    const insCoffre = db.prepare('INSERT INTO coffre (agent_id, type_piece, libelle, date_depot, document_id) VALUES (?, ?, ?, ?, ?)');
    for (const j of db.prepare('SELECT * FROM justificatifs WHERE inscription_id = ?').all(id)) {
      const docId = enregistrerDocument(db, {
        agent_id: agent.id, type_piece: j.type, depose_le: i.depose_le.slice(0, 10),
        fichier: { nom: j.nom_fichier, mime: j.mime, octets: Buffer.from(j.contenu) },
      });
      insCoffre.run(agent.id, j.type, JUSTIFICATIFS.find((x) => x.type === j.type).libelle, i.depose_le.slice(0, 10), docId);
    }
    db.prepare("UPDATE inscriptions SET statut = 'VALIDEE', traite_le = ?, traite_par = ?, agent_id = ? WHERE id = ?")
      .run(new Date().toISOString(), user.nom, agent.id, id);
    journaliser(db, user.nom, 'Inscription validée, compte activé', `${i.numero} – ${agent.prenoms} ${agent.nom}`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { statut: 'VALIDEE' };
}

export function rejeterInscription(db, id, motif, user) {
  if (!String(motif ?? '').trim()) throw new ErreurMetier('Le motif du rejet est obligatoire : il est communiqué au demandeur.');
  const r = db.prepare("UPDATE inscriptions SET statut = 'REJETEE', motif = ?, traite_le = ?, traite_par = ? WHERE id = ? AND statut = 'EN_ATTENTE'")
    .run(String(motif).trim(), new Date().toISOString(), user.nom, id);
  if (!r.changes) throw new ErreurMetier('Demande non traitable');
  journaliser(db, user.nom, 'Inscription rejetée', `demande ${id} : ${motif}`);
  return { statut: 'REJETEE' };
}
