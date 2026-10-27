import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { REGLES_PAR_DEFAUT } from './regles.mjs';
import { semer } from './seed.mjs';
import { SECTEURS } from './secteurs.mjs';

const SCHEMA = `
CREATE TABLE secteurs (
  code TEXT PRIMARY KEY, libelle TEXT NOT NULL, ordre INTEGER NOT NULL
);
CREATE TABLE structures (
  id INTEGER PRIMARY KEY, nom TEXT NOT NULL, type TEXT NOT NULL,
  secteur TEXT NOT NULL REFERENCES secteurs(code), departement TEXT NOT NULL, ministere TEXT NOT NULL
);
CREATE TABLE corps (
  code TEXT PRIMARY KEY, libelle TEXT NOT NULL, secteur TEXT NOT NULL REFERENCES secteurs(code), echelle_recrutement TEXT NOT NULL
);
CREATE TABLE agents (
  id INTEGER PRIMARY KEY, matricule TEXT UNIQUE NOT NULL, npi TEXT UNIQUE,
  nom TEXT NOT NULL, prenoms TEXT NOT NULL, sexe TEXT NOT NULL, date_naissance TEXT NOT NULL,
  telephone TEXT, statut TEXT NOT NULL CHECK (statut IN ('APE','ACDPE')),
  corps_code TEXT NOT NULL REFERENCES corps(code),
  echelle TEXT NOT NULL, echelon INTEGER NOT NULL, date_effet_echelon TEXT NOT NULL,
  date_prise_service TEXT NOT NULL, stagiaire INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL DEFAULT 'ACTIVITE',
  structure_id INTEGER NOT NULL REFERENCES structures(id),
  superieur_id INTEGER REFERENCES agents(id), fonction TEXT
);
CREATE TABLE historique (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id),
  date_effet TEXT NOT NULL, type TEXT NOT NULL, libelle TEXT NOT NULL, acte_id INTEGER
);
CREATE TABLE diplomes (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id),
  intitule TEXT NOT NULL, niveau TEXT NOT NULL, date_obtention TEXT NOT NULL,
  verifie INTEGER NOT NULL DEFAULT 0, pris_en_compte INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE coffre (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id),
  type_piece TEXT NOT NULL, libelle TEXT NOT NULL, date_depot TEXT NOT NULL, verifie INTEGER NOT NULL DEFAULT 1,
  document_id INTEGER REFERENCES documents(id)
);
CREATE TABLE documents (
  id INTEGER PRIMARY KEY, agent_id INTEGER REFERENCES agents(id), demande_id INTEGER REFERENCES demandes(id),
  type_piece TEXT NOT NULL, nom_fichier TEXT NOT NULL, mime TEXT NOT NULL, taille INTEGER NOT NULL,
  contenu BLOB NOT NULL, depose_le TEXT NOT NULL
);
CREATE TABLE reinitialisations (
  id INTEGER PRIMARY KEY, utilisateur_id TEXT NOT NULL REFERENCES utilisateurs(id), code TEXT NOT NULL,
  expire TEXT NOT NULL, essais INTEGER NOT NULL DEFAULT 0, utilise INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE evaluations (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id),
  annee INTEGER NOT NULL, evaluateur_id INTEGER REFERENCES agents(id),
  statut TEXT NOT NULL, fiche TEXT NOT NULL, note_finale REAL, mention TEXT,
  commentaire_evaluateur TEXT, commentaire_agent TEXT, decision_commission TEXT,
  maj TEXT NOT NULL, UNIQUE (agent_id, annee)
);
CREATE TABLE evenements (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id),
  type TEXT NOT NULL, libelle TEXT NOT NULL, date_effet TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'PROPOSE', details TEXT NOT NULL DEFAULT '{}',
  motif_rejet TEXT, cree_le TEXT NOT NULL, acte_id INTEGER
);
CREATE TABLE actes (
  id INTEGER PRIMARY KEY, numero TEXT UNIQUE NOT NULL, type TEXT NOT NULL,
  agent_id INTEGER NOT NULL REFERENCES agents(id), objet TEXT NOT NULL,
  date_signature TEXT NOT NULL, signataire TEXT NOT NULL, code_verification TEXT UNIQUE NOT NULL,
  contenu TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE demandes (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id),
  type TEXT NOT NULL, motif TEXT, statut TEXT NOT NULL DEFAULT 'DEPOSEE',
  pieces TEXT NOT NULL, depose_le TEXT NOT NULL, traite_le TEXT, reponse TEXT, acte_id INTEGER
);
CREATE TABLE regles (
  cle TEXT PRIMARY KEY, valeur TEXT NOT NULL, libelle TEXT NOT NULL, groupe TEXT NOT NULL
);
CREATE TABLE utilisateurs (
  id TEXT PRIMARY KEY, nom TEXT NOT NULL, role TEXT NOT NULL, agent_id INTEGER, description TEXT,
  matricule TEXT UNIQUE NOT NULL, npi TEXT UNIQUE, telephone TEXT, mot_de_passe TEXT NOT NULL
);
CREATE TABLE sessions (
  jeton TEXT PRIMARY KEY, utilisateur_id TEXT NOT NULL REFERENCES utilisateurs(id), expire TEXT NOT NULL
);
CREATE TABLE tentatives (
  cle TEXT PRIMARY KEY, echecs INTEGER NOT NULL, bloque_jusqua TEXT
);
CREATE TABLE inscriptions (
  id INTEGER PRIMARY KEY, numero TEXT UNIQUE NOT NULL, secteur TEXT NOT NULL REFERENCES secteurs(code),
  npi TEXT NOT NULL, nom TEXT NOT NULL, prenoms TEXT NOT NULL, date_naissance TEXT NOT NULL,
  matricule TEXT NOT NULL, statut_agent TEXT NOT NULL, ministere TEXT NOT NULL, structure TEXT NOT NULL,
  emploi TEXT NOT NULL, telephone TEXT NOT NULL, email TEXT, mot_de_passe TEXT NOT NULL,
  statut TEXT NOT NULL DEFAULT 'EN_ATTENTE', motif TEXT, depose_le TEXT NOT NULL,
  traite_le TEXT, traite_par TEXT, agent_id INTEGER REFERENCES agents(id)
);
CREATE TABLE justificatifs (
  id INTEGER PRIMARY KEY, inscription_id INTEGER NOT NULL REFERENCES inscriptions(id),
  type TEXT NOT NULL, nom_fichier TEXT NOT NULL, mime TEXT NOT NULL, taille INTEGER NOT NULL, contenu BLOB NOT NULL
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY, agent_id INTEGER NOT NULL REFERENCES agents(id), cle TEXT NOT NULL,
  horodatage TEXT NOT NULL, titre TEXT NOT NULL, message TEXT NOT NULL, lu INTEGER NOT NULL DEFAULT 0,
  UNIQUE (agent_id, cle)
);
CREATE TABLE audit (
  id INTEGER PRIMARY KEY, horodatage TEXT NOT NULL, utilisateur TEXT NOT NULL, action TEXT NOT NULL, cible TEXT
);
CREATE INDEX idx_eval_agent ON evaluations(agent_id);
CREATE INDEX idx_evt_statut ON evenements(statut);
CREATE INDEX idx_user_tel ON utilisateurs(telephone);
`;
// À incrémenter à chaque changement de schéma : une base plus ancienne est rechargée.
const VERSION_SCHEMA = 5;

export function ouvrir(chemin, { aujourdhui } = {}) {
  if (chemin !== ':memory:') mkdirSync(dirname(chemin), { recursive: true });
  const db = new DatabaseSync(chemin);
  db.exec('PRAGMA foreign_keys = ON');
  const existe = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").get();
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (!existe || version < VERSION_SCHEMA) initialiser(db, aujourdhui);
  return db;
}

// Recrée le schéma et recharge les données de démonstration.
export function initialiser(db, aujourdhui = new Date().toISOString().slice(0, 10)) {
  db.exec('PRAGMA foreign_keys = OFF');
  for (const t of ['audit', 'notifications', 'reinitialisations', 'sessions', 'tentatives', 'justificatifs', 'coffre', 'documents', 'inscriptions', 'utilisateurs', 'regles', 'demandes', 'evenements',
    'actes', 'evaluations', 'coffre', 'diplomes', 'historique', 'agents', 'corps', 'structures', 'secteurs']) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  db.exec('BEGIN');
  const ins = db.prepare('INSERT INTO regles (cle, valeur, libelle, groupe) VALUES (?, ?, ?, ?)');
  for (const [cle, r] of Object.entries(REGLES_PAR_DEFAUT)) ins.run(cle, JSON.stringify(r.valeur), r.libelle, r.groupe);
  const insSecteur = db.prepare('INSERT INTO secteurs (code, libelle, ordre) VALUES (?, ?, ?)');
  SECTEURS.forEach(([code, libelle], i) => insSecteur.run(code, libelle, i + 1));
  semer(db, aujourdhui);
  db.exec('COMMIT');
  db.exec(`PRAGMA user_version = ${VERSION_SCHEMA}`);
}

export function lireRegles(db) {
  const r = {};
  for (const row of db.prepare('SELECT cle, valeur FROM regles').all()) r[row.cle] = JSON.parse(row.valeur);
  return r;
}

export function journaliser(db, utilisateur, action, cible = null) {
  db.prepare('INSERT INTO audit (horodatage, utilisateur, action, cible) VALUES (?, ?, ?, ?)')
    .run(new Date().toISOString(), utilisateur, action, cible);
}
