// Jeu de données de démonstration. Tous les noms, matricules et NPI sont FICTIFS.
// Les dates sont calculées par rapport à « aujourd'hui » pour que le moteur de
// règles trouve toujours des cas à traiter.

import { ajouterMois, noteSur20, mention, ageRetraite, echelonMax, REGLES_PAR_DEFAUT } from './regles.mjs';
import { ficheVierge, criteres, objectifsTypes } from './evaluation.mjs';
import { hacher } from './motdepasse.mjs';

// Mot de passe commun à tous les comptes de démonstration (voir le README).
export const MOT_DE_PASSE_DEMO = 'MaCarriere@2026';
const deuxChiffres = (n) => String(n).padStart(2, '0');
// Agent sans compte, dont le dossier existe dans la base RH : cas de démonstration de l'inscription.
export const DEMO_INSCRIPTION = { agent: 52, npi: '3011223344', naissance: '1973-09-27' };

function generateur(graine) {
  let a = graine;
  const suivant = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    reel: suivant,
    entier: (min, max) => min + Math.floor(suivant() * (max - min + 1)),
    choix: (liste) => liste[Math.floor(suivant() * liste.length)],
  };
}

const STRUCTURES = [
  ['EPP Godomey Centre', 'École primaire publique', 'EDUCATION', 'Atlantique', 'MEMP'],
  ['EPP Gbégamey', 'École primaire publique', 'EDUCATION', 'Littoral', 'MEMP'],
  ['CEG Dodomè', "Collège d'enseignement général", 'EDUCATION', 'Littoral', 'MESTFP'],
  ['CEG 1 Parakou', "Collège d'enseignement général", 'EDUCATION', 'Borgou', 'MESTFP'],
  ['Lycée technique de Bohicon', 'Lycée technique', 'EDUCATION', 'Zou', 'MESTFP'],
  ["Hôpital de zone d'Abomey-Calavi", 'Hôpital de zone', 'SANTE', 'Atlantique', 'Ministère de la Santé'],
  ['Centre de santé de Godomey', 'Centre de santé', 'SANTE', 'Atlantique', 'Ministère de la Santé'],
  ['Centre de santé de Djougou', 'Centre de santé', 'SANTE', 'Donga', 'Ministère de la Santé'],
  ['Hôpital de zone de Pobè', 'Hôpital de zone', 'SANTE', 'Plateau', 'Ministère de la Santé'],
  ['Centre de santé de Bohicon', 'Centre de santé', 'SANTE', 'Zou', 'Ministère de la Santé'],
  // Autres administrations : la plateforme couvre tous les agents de l'État.
  ['Centre des impôts du Littoral', 'Service des impôts', 'FINANCES', 'Littoral', 'Ministère chargé des finances'],
  ['Tribunal de première instance de Parakou', 'Juridiction', 'JUSTICE', 'Borgou', 'Ministère chargé de la justice'],
  ["Direction départementale de l'agriculture du Zou", 'Direction départementale', 'AGRICULTURE', 'Zou', "Ministère chargé de l'agriculture"],
];

// code, libellé, secteur, échelle de recrutement (fictive), niveau et intitulé du diplôme d'accès
const CORPS = [
  ['INST_ADJ', 'Instituteur adjoint', 'EDUCATION', 'C1', 'BEPC', 'BEPC et CEAP'],
  ['INST', 'Instituteur', 'EDUCATION', 'B1', 'BAC', 'Baccalauréat et CAP'],
  ['PROF_ADJ', 'Professeur adjoint', 'EDUCATION', 'A3', 'LICENCE', 'Licence et BAPES'],
  ['PROF_CERT', 'Professeur certifié', 'EDUCATION', 'A1', 'MASTER', 'Master et CAPES'],
  ['AIDE_SOIG', 'Aide-soignant', 'SANTE', 'C2', 'BEPC', "BEPC et diplôme d'aide-soignant"],
  ['INF', "Infirmier diplômé d'État", 'SANTE', 'B1', 'BAC2', "Diplôme d'État d'infirmier"],
  ['SF', "Sage-femme d'État", 'SANTE', 'B1', 'BAC2', "Diplôme d'État de sage-femme"],
  ['TECH_LABO', 'Technicien de laboratoire', 'SANTE', 'B2', 'BAC2', 'Diplôme de technicien de laboratoire'],
  ['MED', 'Médecin', 'SANTE', 'A1', 'DOCTORAT', 'Doctorat en médecine'],
  ['INSP_IMPOTS', 'Inspecteur des impôts', 'FINANCES', 'A1', 'MASTER', 'Master en fiscalité'],
  ['CTRL_IMPOTS', 'Contrôleur des impôts', 'FINANCES', 'B1', 'BAC2', 'BTS en comptabilité'],
  ['GREFFIER', 'Greffier', 'JUSTICE', 'B1', 'LICENCE', 'Licence en droit'],
  ['SECR_GREFFE', 'Secrétaire des greffes et parquets', 'JUSTICE', 'C1', 'BAC', 'Baccalauréat'],
  ['ING_AGRO', 'Ingénieur agronome', 'AGRICULTURE', 'A1', 'MASTER', "Diplôme d'ingénieur agronome"],
  ['TECH_AGRI', "Technicien d'agriculture", 'AGRICULTURE', 'B2', 'BAC2', "Diplôme de technicien d'agriculture"],
];

// Chef de structure puis composition de l'équipe, par type de structure.
const COMPOSITION = {
  'École primaire publique': { chef: ['INST', "Directeur d'école"], equipe: ['INST_ADJ', 'INST_ADJ', 'INST', 'INST_ADJ'] },
  "Collège d'enseignement général": { chef: ['PROF_CERT', 'Directeur'], equipe: ['PROF_ADJ', 'PROF_CERT', 'PROF_ADJ', 'PROF_CERT'] },
  'Lycée technique': { chef: ['PROF_CERT', 'Proviseur'], equipe: ['PROF_CERT', 'PROF_ADJ', 'PROF_ADJ', 'PROF_CERT'] },
  'Hôpital de zone': { chef: ['MED', 'Médecin-chef'], equipe: ['INF', 'SF', 'TECH_LABO', 'AIDE_SOIG'] },
  'Centre de santé': { chef: ['INF', 'Responsable du centre'], equipe: ['SF', 'AIDE_SOIG', 'INF', 'MED'] },
  'Service des impôts': { chef: ['INSP_IMPOTS', 'Chef de centre'], equipe: ['CTRL_IMPOTS', 'CTRL_IMPOTS', 'INSP_IMPOTS', 'CTRL_IMPOTS'] },
  'Juridiction': { chef: ['GREFFIER', 'Greffier en chef'], equipe: ['SECR_GREFFE', 'GREFFIER', 'SECR_GREFFE', 'SECR_GREFFE'] },
  'Direction départementale': { chef: ['ING_AGRO', 'Directeur départemental'], equipe: ['TECH_AGRI', 'ING_AGRO', 'TECH_AGRI', 'TECH_AGRI'] },
};

const NOMS = ['HOUNKPATIN', 'DOSSOU', 'AGBANGLA', 'ZINSOU', 'TOSSOU', 'AKPOVI', 'HOUNSOU', 'ADJOVI', 'SEIDOU', 'OROU GANI',
  'YAROU', 'ISSIFOU', 'CHABI', 'SABI', 'GOUNOU', 'KPADONOU', 'AGOSSOU', 'AHOYO', 'DEGLA', 'LOKOSSOU', 'HOUESSOU',
  'MEDEHOU', 'ASSOGBA', 'AKAKPO', 'GBAGUIDI', 'SOSSOU', 'ALIDOU', 'BOKO', 'DANSOU', 'FADONOUGBO'];
const PRENOMS_H = ['Comlan', 'Sèna', 'Codjo', 'Rodrigue', 'Hervé', 'Gildas', 'Abdou', 'Moussa', 'Fiacre', 'Romaric', 'Aristide', 'Ulrich', 'Mathias', 'Rachidi'];
const PRENOMS_F = ['Afiavi', 'Rachida', 'Sènami', 'Bernadette', 'Mariam', 'Clarisse', 'Gisèle', 'Nafissatou', 'Edwige', 'Pélagie', 'Chimène', 'Victorine', 'Reine', 'Fifamè'];

// Diplôme obtenu en cours de carrière par un fonctionnaire (ouvre le concours professionnel).
const DIPLOME_NOUVEAU = {
  INST_ADJ: ['BAC', 'Baccalauréat série D'],
  INST: ['LICENCE', "Licence en sciences de l'éducation"],
  AIDE_SOIG: ['BAC2', "Diplôme d'État d'infirmier"],
  PROF_ADJ: ['MASTER', 'Master en lettres modernes'],
};

export function semer(db, aujourdhui) {
  const r = generateur(2026);
  const Y = Number(aujourdhui.slice(0, 4));
  const avant = (mois) => ajouterMois(aujourdhui, -mois);
  const regles = Object.fromEntries(Object.entries(REGLES_PAR_DEFAUT).map(([k, v]) => [k, v.valeur]));
  const MAX = echelonMax(regles);

  const insStructure = db.prepare('INSERT INTO structures (id, nom, type, secteur, departement, ministere) VALUES (?, ?, ?, ?, ?, ?)');
  STRUCTURES.forEach((s, i) => insStructure.run(i + 1, ...s));
  const insCorps = db.prepare('INSERT INTO corps (code, libelle, secteur, echelle_recrutement) VALUES (?, ?, ?, ?)');
  for (const c of CORPS) insCorps.run(c[0], c[1], c[2], c[3]);
  const corps = Object.fromEntries(CORPS.map((c) => [c[0], { echelle: c[3], niveau: c[4], diplome: c[5], secteur: c[2] }]));
  const ageMax = (code) => ageRetraite({ corps_code: code, echelle: corps[code].echelle }, regles);

  const insAgent = db.prepare(`INSERT INTO agents (id, matricule, npi, nom, prenoms, sexe, date_naissance, telephone, statut,
    corps_code, echelle, echelon, date_effet_echelon, date_prise_service, stagiaire, position, structure_id, superieur_id, fonction)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVITE', ?, ?, ?)`);
  const insHist = db.prepare('INSERT INTO historique (agent_id, date_effet, type, libelle) VALUES (?, ?, ?, ?)');
  const insDiplome = db.prepare('INSERT INTO diplomes (agent_id, intitule, niveau, date_obtention, verifie, pris_en_compte) VALUES (?, ?, ?, ?, ?, ?)');
  const insCoffre = db.prepare('INSERT INTO coffre (agent_id, type_piece, libelle, date_depot) VALUES (?, ?, ?, ?)');
  const insEval = db.prepare(`INSERT INTO evaluations (agent_id, annee, evaluateur_id, statut, fiche, note_finale, mention,
    commentaire_evaluateur, commentaire_agent, maj) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  let id = 0;
  const agents = [];
  STRUCTURES.forEach((s, si) => {
    const comp = COMPOSITION[s[1]];
    let chefId = null;
    [comp.chef[0], ...comp.equipe].forEach((code, mi) => {
      id += 1;
      const estChef = mi === 0;
      const sexe = r.reel() < 0.5 ? 'F' : 'M';
      const age = estChef ? r.entier(40, ageMax(code) - 3) : r.entier(26, ageMax(code) - 4);
      const naissance = ajouterMois(aujourdhui, -(age * 12 + r.entier(0, 11)));
      const priseService = ajouterMois(naissance, r.entier(23, Math.min(32, age - 1)) * 12 + r.entier(0, 11));
      const anneePrise = Number(priseService.slice(0, 4));
      const statut = anneePrise >= 2017 ? (r.reel() < 0.8 ? 'ACDPE' : 'APE') : (r.reel() < 0.85 ? 'APE' : 'ACDPE');
      const normal = Math.min(MAX, 1 + Math.floor(Math.max(0, (Y - anneePrise) * 12) / 24));
      const echelon = Math.max(1, normal - (r.reel() < 0.4 ? r.entier(1, 3) : 0));
      agents.push({
        id, code, sexe, naissance, priseService, statut, echelon,
        dateEffet: ajouterMois(priseService, 24 * (echelon - 1)),
        nom: r.choix(NOMS), prenoms: r.choix(sexe === 'F' ? PRENOMS_F : PRENOMS_H),
        structure: si + 1, superieur: estChef ? null : chefId, encadrant: estChef,
        fonction: estChef ? comp.chef[1] : null, stagiaire: 0,
        npi: r.reel() < 0.9 ? String(r.entier(1000000000, 9999999999)) : null,
        faible: r.reel() < 0.1, sansEvaluation: r.reel() < 0.06,
      });
      if (estChef) chefId = id;
    });
  });

  // --- Cas de démonstration forcés ---
  const parId = (n) => agents.find((a) => a.id === n);
  // Agente de démo : institutrice adjointe ACDPE à Godomey, deux paliers d'augmentation en retard.
  Object.assign(parId(2), {
    nom: 'HOUNKPATIN', prenoms: 'Afiavi', sexe: 'F', code: 'INST_ADJ', statut: 'ACDPE', npi: '2087345611',
    naissance: avant(34 * 12 + 4), priseService: avant(9 * 12 + 2), echelon: 3, faible: false, sansEvaluation: false,
  });
  parId(2).dateEffet = ajouterMois(parId(2).priseService, 48);
  Object.assign(parId(1), { nom: 'DOSSOU', prenoms: 'Comlan', sexe: 'M', npi: '1984221307', statut: 'APE', sansEvaluation: false });
  // Départs à la retraite proches, et un dépassement de la limite d'âge.
  for (const [n, moisRestants] of [[7, 7], [18, 15], [33, 20], [44, -2]]) {
    const a = parId(n);
    a.naissance = avant(ageMax(a.code) * 12 - moisRestants);
    a.priseService = ajouterMois(a.naissance, 25 * 12);
    a.echelon = MAX - 1; a.dateEffet = avant(20);
  }
  // Fonctionnaire au dernier échelon de son grade depuis plus de 2 ans, bonnes notes : tableau d'avancement.
  // Un autre, bloqué au passage de l'échelon 10 à 11 faute de moyenne suffisante.
  for (const [n, faible] of [[12, false], [27, true]]) {
    const a = parId(n);
    Object.assign(a, { statut: 'APE', echelon: n === 12 ? 7 : 10, dateEffet: avant(30), faible, sansEvaluation: false });
    a.priseService = ajouterMois(a.dateEffet, -24 * (a.echelon - 1));
    a.naissance = ajouterMois(a.priseService, -25 * 12);
  }
  // Fonctionnaires stagiaires arrivés en fin de stage.
  for (const [n, faible] of [[23, false], [38, true]]) {
    Object.assign(parId(n), { statut: 'APE', stagiaire: 1, priseService: avant(14), echelon: 1, faible, sansEvaluation: false });
    parId(n).dateEffet = parId(n).priseService;
  }
  // Contrôleur des impôts sans compte : sert à démontrer l'inscription en ligne (voir le README).
  Object.assign(parId(DEMO_INSCRIPTION.agent), {
    nom: 'ZINSOU', prenoms: 'Rodrigue', sexe: 'M', statut: 'APE', npi: DEMO_INSCRIPTION.npi, sansEvaluation: false,
    naissance: DEMO_INSCRIPTION.naissance,
  });

  for (const a of agents) {
    const c = corps[a.code];
    a.matricule = a.statut === 'APE' ? String(100000 + (a.id * 7919) % 899999) : `C${200000 + (a.id * 4421) % 799999}`;
    // Le numéro d'ordre de l'agent dans le numéro garantit des téléphones uniques.
    a.telephone = `+229 01 ${90 + (a.id % 10)} ${deuxChiffres(a.id)} ${r.entier(10, 99)} ${r.entier(10, 99)}`;
    insAgent.run(a.id, a.matricule, a.npi, a.nom, a.prenoms, a.sexe, a.naissance, a.telephone,
      a.statut, a.code, c.echelle, a.echelon, a.dateEffet, a.priseService, a.stagiaire,
      a.structure, a.superieur, a.fonction);

    // Historique de carrière
    insHist.run(a.id, a.priseService, 'PRISE_SERVICE', `Première prise de service (${a.statut === 'APE' ? 'fonctionnaire stagiaire' : 'contrat ACDPE'})`);
    if (a.statut === 'APE' && !a.stagiaire) insHist.run(a.id, ajouterMois(a.priseService, 12), 'TITULARISATION', 'Titularisation');
    for (let e = 2; e <= a.echelon; e++) {
      const libelle = a.statut === 'APE' ? `Avancement à l'échelon ${e}` : `Avenant : palier ${e}`;
      insHist.run(a.id, ajouterMois(a.priseService, 24 * (e - 1)), a.statut === 'APE' ? 'AVANCEMENT_ECHELON' : 'AVENANT', libelle);
    }

    // Diplômes et coffre-fort
    insDiplome.run(a.id, c.diplome, c.niveau, ajouterMois(a.priseService, -8), 1, 1);
    insCoffre.run(a.id, 'DIPLOMES', `Diplômes : ${c.diplome}`, a.priseService);
    if (r.reel() < 0.7) insCoffre.run(a.id, 'PHOTOS', "Photo d'identité", avant(r.entier(1, 30)));
    if (r.reel() < 0.6) insCoffre.run(a.id, 'RIB', "Relevé d'identité bancaire", avant(r.entier(1, 30)));

    // Notations clôturées des années passées
    const debut = Math.max(Number(a.priseService.slice(0, 4)), Y - 5);
    for (let annee = debut; annee < Y; annee++) {
      if (a.sansEvaluation && annee >= Y - 3) continue;
      const fiche = ficheVierge(c.secteur, objectifsTypes(c.secteur), a.encadrant);
      for (const crit of criteres(fiche)) {
        crit.note = a.faible ? r.entier(1, 4) : r.entier(3, 5);
        crit.auto = Math.min(5, crit.note + r.entier(0, 1));
      }
      const note = noteSur20(fiche, regles.ponderation_evaluation);
      insEval.run(a.id, annee, a.superieur, 'CLOTUREE', JSON.stringify(fiche), note, mention(note, regles.mentions),
        'Notation annuelle', null, `${annee}-10-30`);
    }
  }

  // Nouveaux diplômes de fonctionnaires (vérifiés, à examiner pour le concours professionnel)
  for (const a of agents.filter((x) => x.statut === 'APE' && !x.stagiaire && DIPLOME_NOUVEAU[x.code] && r.reel() < 0.25)) {
    const [niveau, intitule] = DIPLOME_NOUVEAU[a.code];
    insDiplome.run(a.id, intitule, niveau, avant(r.entier(3, 14)), 1, 0);
  }
  // Un diplôme déclaré mais pas encore vérifié par le gestionnaire.
  const enAttente = agents.find((a) => a.code === 'INST' && a.statut === 'APE');
  if (enAttente) insDiplome.run(enAttente.id, "Licence en sciences de l'éducation", 'LICENCE', avant(2), 0, 0);

  // Campagne de l'année en cours, à différents stades.
  for (const a of agents) {
    if (!a.superieur) continue;
    const c = corps[a.code];
    const fiche = ficheVierge(c.secteur, objectifsTypes(c.secteur), false);
    let statut = r.choix(['OBJECTIFS_FIXES', 'OBJECTIFS_FIXES', 'AUTO_EVALUEE', 'AUTO_EVALUEE', 'EVALUEE']);
    if (a.id === 2) statut = 'OBJECTIFS_FIXES';
    if (a.superieur === 1 && a.id !== 2) statut = 'AUTO_EVALUEE';
    if (statut !== 'OBJECTIFS_FIXES') for (const crit of criteres(fiche)) crit.auto = r.entier(3, 5);
    let note = null, men = null;
    if (statut === 'EVALUEE') {
      for (const crit of criteres(fiche)) crit.note = r.entier(3, 4);
      note = noteSur20(fiche, regles.ponderation_evaluation);
      men = mention(note, regles.mentions);
    }
    insEval.run(a.id, Y, a.superieur, statut, JSON.stringify(fiche), note, men,
      statut === 'EVALUEE' ? 'Bon engagement, à poursuivre.' : null, null, aujourdhui);
  }

  // Comptes : un par agent (évaluateur s'il dirige une structure), plus trois comptes RH.
  // Les identifiants de connexion (matricule, NPI, téléphone) sont repris du dossier de l'agent.
  const insUser = db.prepare(`INSERT INTO utilisateurs (id, nom, role, agent_id, description, matricule, npi, telephone, mot_de_passe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  // Même mot de passe pour tous les comptes de démo : un seul hachage suffit (sel unique par
  // compte dès que l'agent choisit son propre mot de passe).
  const empreinteDemo = hacher(MOT_DE_PASSE_DEMO);
  const nomsCorps = Object.fromEntries(CORPS.map((c) => [c[0], c[1]]));
  // Les agents des administrations ajoutées (structures 11 et suivantes) n'ont pas encore de
  // compte : ils doivent s'inscrire en ligne avec leurs justificatifs.
  for (const a of agents.filter((x) => x.structure <= 10)) {
    const id = a.id === 2 ? 'agent' : a.id === 1 ? 'evaluateur' : `agent-${a.id}`;
    const description = `${a.fonction ?? nomsCorps[a.code]}${a.statut === 'ACDPE' ? ' (ACDPE)' : ''}, ${STRUCTURES[a.structure - 1][0]}`;
    insUser.run(id, `${a.prenoms} ${a.nom}`, a.superieur ? 'agent' : 'evaluateur', a.id, description,
      a.matricule, a.npi, a.telephone.replace(/\D/g, '').slice(3), empreinteDemo);
  }
  insUser.run('gestionnaire', 'Service du personnel', 'gestionnaire', null, 'Gestionnaire RH : instruit les propositions et les demandes',
    'RH-0001', null, '0100000001', empreinteDemo);
  insUser.run('drh', 'Directeur des ressources humaines', 'drh', null, "Signe les actes, saisit l'avis de la CAP sur les recours",
    'DRH-0001', null, '0100000002', empreinteDemo);
  insUser.run('admin', 'Administrateur', 'admin', null, 'Paramètre les règles statutaires',
    'ADM-0001', null, '0100000003', empreinteDemo);
}
