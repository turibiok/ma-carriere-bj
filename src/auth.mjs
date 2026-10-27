// Authentification : identifiant au choix (NPI, matricule ou téléphone) et mot de passe.
// Mots de passe hachés avec scrypt et un sel par compte ; sessions par jeton aléatoire,
// dont seule l'empreinte est stockée ; blocage temporaire après plusieurs échecs.

import { randomBytes, randomInt, createHash } from 'node:crypto';
import { journaliser } from './db.mjs';
import { ErreurMetier } from './services.mjs';
import { motDePasseValide, hacher } from './motdepasse.mjs';

export const MAX_ECHECS = 5;
const BLOCAGE_MINUTES = 15;
const DUREE_SESSION_HEURES = 8;
const ERREUR_GENERIQUE = 'Identifiant ou mot de passe incorrect.';

const empreinteJeton = (jeton) => createHash('sha256').update(jeton).digest('hex');

// Numéros béninois à 10 chiffres (01 XX XX XX XX), avec ou sans l'indicatif +229.
export const normaliserTelephone = (t) => String(t ?? '').replace(/\D/g, '').replace(/^229(?=\d{10}$)/, '');

export function normaliserIdentifiant(type, identifiant) {
  const brut = String(identifiant ?? '').trim();
  if (type === 'npi') {
    if (!/^\d{10}$/.test(brut)) throw new ErreurMetier('Le NPI comporte 10 chiffres.');
    return brut;
  }
  if (type === 'telephone') {
    const tel = normaliserTelephone(brut);
    if (!/^\d{10}$/.test(tel)) throw new ErreurMetier('Le numéro de téléphone comporte 10 chiffres (01 XX XX XX XX).');
    return tel;
  }
  if (type === 'matricule') {
    if (!brut) throw new ErreurMetier('Saisissez votre matricule.');
    return brut.toUpperCase();
  }
  throw new ErreurMetier("Type d'identifiant inconnu.");
}

function trouverUtilisateur(db, type, valeur) {
  if (type === 'npi') return db.prepare('SELECT * FROM utilisateurs WHERE npi = ?').all(valeur);
  if (type === 'matricule') return db.prepare('SELECT * FROM utilisateurs WHERE UPPER(matricule) = ?').all(valeur);
  return db.prepare('SELECT * FROM utilisateurs WHERE telephone = ?').all(valeur);
}

export function connecter(db, { type, identifiant, mot_de_passe }, maintenant = new Date()) {
  const valeur = normaliserIdentifiant(type, identifiant);
  if (!mot_de_passe) throw new ErreurMetier('Saisissez votre mot de passe.');
  const cle = `${type}:${valeur}`;
  const t = db.prepare('SELECT * FROM tentatives WHERE cle = ?').get(cle);
  if (t?.bloque_jusqua && t.bloque_jusqua > maintenant.toISOString()) {
    const minutes = Math.ceil((Date.parse(t.bloque_jusqua) - maintenant.getTime()) / 60000);
    throw new ErreurMetier(`Trop de tentatives échouées. Réessayez dans ${minutes} minute(s).`, 429);
  }
  const trouves = trouverUtilisateur(db, type, valeur);
  // Un identifiant ambigu (téléphone partagé) est refusé comme un identifiant inconnu.
  const user = trouves.length === 1 ? trouves[0] : null;
  if (!user || !motDePasseValide(String(mot_de_passe), user.mot_de_passe)) {
    const echecs = (t?.bloque_jusqua ? 0 : t?.echecs ?? 0) + 1;
    const bloque = echecs >= MAX_ECHECS ? new Date(maintenant.getTime() + BLOCAGE_MINUTES * 60000).toISOString() : null;
    db.prepare('INSERT INTO tentatives (cle, echecs, bloque_jusqua) VALUES (?, ?, ?) ON CONFLICT(cle) DO UPDATE SET echecs = excluded.echecs, bloque_jusqua = excluded.bloque_jusqua')
      .run(cle, bloque ? 0 : echecs, bloque);
    journaliser(db, user?.nom ?? 'inconnu', 'Échec de connexion', `${type} ${type === 'npi' ? valeur.slice(0, 3) + '…' : valeur}`);
    throw new ErreurMetier(bloque ? `Trop de tentatives échouées. Compte bloqué ${BLOCAGE_MINUTES} minutes.` : ERREUR_GENERIQUE, bloque ? 429 : 401);
  }
  db.prepare('DELETE FROM tentatives WHERE cle = ?').run(cle);
  db.prepare('DELETE FROM sessions WHERE expire < ?').run(maintenant.toISOString());
  const jeton = randomBytes(32).toString('base64url');
  const expire = new Date(maintenant.getTime() + DUREE_SESSION_HEURES * 3600000).toISOString();
  db.prepare('INSERT INTO sessions (jeton, utilisateur_id, expire) VALUES (?, ?, ?)').run(empreinteJeton(jeton), user.id, expire);
  journaliser(db, user.nom, 'Connexion', `par ${type}`);
  return { jeton, expire, utilisateur: profil(user) };
}

export function utilisateurDuJeton(db, jeton, maintenant = new Date()) {
  if (!jeton) return null;
  const u = db.prepare(`SELECT u.* FROM sessions s JOIN utilisateurs u ON u.id = s.utilisateur_id
    WHERE s.jeton = ? AND s.expire > ?`).get(empreinteJeton(jeton), maintenant.toISOString());
  return u ?? null;
}

export function deconnecter(db, jeton) {
  if (jeton) db.prepare('DELETE FROM sessions WHERE jeton = ?').run(empreinteJeton(jeton));
}

export function politiqueMotDePasse(mdp) {
  const m = String(mdp ?? '');
  if (m.length < 10 || !/[A-Za-z]/.test(m) || !/\d/.test(m)) {
    throw new ErreurMetier('Le mot de passe doit comporter au moins 10 caractères, dont des lettres et des chiffres.');
  }
}

// Change le mot de passe d'un utilisateur connecté ; ses autres sessions sont fermées.
export function changerMotDePasse(db, user, { actuel, nouveau }, jetonCourant) {
  if (!motDePasseValide(String(actuel ?? ''), user.mot_de_passe)) throw new ErreurMetier('Mot de passe actuel incorrect.');
  politiqueMotDePasse(nouveau);
  if (actuel === nouveau) throw new ErreurMetier("Le nouveau mot de passe doit être différent de l'actuel.");
  db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?').run(hacher(String(nouveau)), user.id);
  db.prepare('DELETE FROM sessions WHERE utilisateur_id = ? AND jeton <> ?').run(user.id, empreinteJeton(jetonCourant ?? ''));
  journaliser(db, user.nom, 'Mot de passe changé');
  return { ok: true };
}

// Mot de passe oublié, étape 1 : un code à 6 chiffres, valable 10 minutes, est envoyé par SMS
// au téléphone du dossier. La réponse est la même que le compte existe ou non.
const CODE_MINUTES = 10;
const MAX_ESSAIS_CODE = 5;

export function demanderReinitialisation(db, { type, identifiant }, { demo = false, maintenant = new Date() } = {}) {
  const valeur = normaliserIdentifiant(type, identifiant);
  const trouves = trouverUtilisateur(db, type, valeur);
  const reponse = { message: 'Si ce compte existe, un code à 6 chiffres a été envoyé par SMS au numéro du dossier. Il est valable 10 minutes.' };
  if (trouves.length !== 1) return reponse;
  const user = trouves[0];
  const code = String(randomInt(0, 1e6)).padStart(6, '0');
  db.prepare('UPDATE reinitialisations SET utilise = 1 WHERE utilisateur_id = ? AND utilise = 0').run(user.id);
  db.prepare('INSERT INTO reinitialisations (utilisateur_id, code, expire) VALUES (?, ?, ?)')
    .run(user.id, hacher(code), new Date(maintenant.getTime() + CODE_MINUTES * 60000).toISOString());
  journaliser(db, user.nom, 'Code de réinitialisation envoyé', `SMS au ${user.telephone?.slice(0, 2)}…${user.telephone?.slice(-2)}`);
  // Prototype : aucun SMS n'est réellement envoyé, le code est renvoyé pour être affiché à l'écran.
  if (demo) reponse.sms_demo = { telephone: `+229 ${user.telephone?.slice(0, 2)} ** ** ** ${user.telephone?.slice(-2)}`, texte: `Ma Carrière BJ : votre code de réinitialisation est ${code}. Il expire dans 10 minutes. Ne le communiquez à personne.` };
  return reponse;
}

// Étape 2 : code + nouveau mot de passe. Le code est à usage unique ; 5 essais au plus.
export function reinitialiserMotDePasse(db, { type, identifiant, code, nouveau }, maintenant = new Date()) {
  const valeur = normaliserIdentifiant(type, identifiant);
  const trouves = trouverUtilisateur(db, type, valeur);
  const invalide = new ErreurMetier('Code invalide ou expiré. Demandez un nouveau code.');
  if (trouves.length !== 1) throw invalide;
  const user = trouves[0];
  const r = db.prepare('SELECT * FROM reinitialisations WHERE utilisateur_id = ? AND utilise = 0 AND expire > ? ORDER BY id DESC')
    .get(user.id, maintenant.toISOString());
  if (!r || r.essais >= MAX_ESSAIS_CODE) throw invalide;
  if (!/^\d{6}$/.test(String(code ?? '').trim()) || !motDePasseValide(String(code).trim(), r.code)) {
    db.prepare('UPDATE reinitialisations SET essais = essais + 1 WHERE id = ?').run(r.id);
    throw new ErreurMetier(`Code incorrect (${MAX_ESSAIS_CODE - r.essais - 1} essai(s) restant(s)).`);
  }
  politiqueMotDePasse(nouveau);
  db.prepare('UPDATE utilisateurs SET mot_de_passe = ? WHERE id = ?').run(hacher(String(nouveau)), user.id);
  db.prepare('UPDATE reinitialisations SET utilise = 1 WHERE id = ?').run(r.id);
  db.prepare('DELETE FROM sessions WHERE utilisateur_id = ?').run(user.id);
  // Lève le blocage éventuel de ce compte seulement, pour chacun de ses identifiants.
  db.prepare('DELETE FROM tentatives WHERE cle IN (?, ?, ?)')
    .run(`npi:${user.npi}`, `matricule:${String(user.matricule).toUpperCase()}`, `telephone:${user.telephone}`);
  journaliser(db, user.nom, 'Mot de passe réinitialisé par code SMS');
  return { ok: true };
}

// Recrée la session d'un utilisateur avec le même jeton (après rechargement des données).
export function restaurerSession(db, jeton, utilisateurId, maintenant = new Date()) {
  const expire = new Date(maintenant.getTime() + DUREE_SESSION_HEURES * 3600000).toISOString();
  db.prepare('INSERT OR REPLACE INTO sessions (jeton, utilisateur_id, expire) VALUES (?, ?, ?)').run(empreinteJeton(jeton), utilisateurId, expire);
}

// Données du compte transmises au navigateur : jamais le mot de passe haché.
export function profil(u) {
  const { mot_de_passe, ...reste } = u;
  return reste;
}
