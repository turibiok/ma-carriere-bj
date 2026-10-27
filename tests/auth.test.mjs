import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrir } from '../src/db.mjs';
import {
  connecter, utilisateurDuJeton, deconnecter, MAX_ECHECS, changerMotDePasse, demanderReinitialisation, reinitialiserMotDePasse,
} from '../src/auth.mjs';
import { MOT_DE_PASSE_DEMO } from '../src/seed.mjs';

const db = ouvrir(':memory:');
const agent = db.prepare("SELECT * FROM utilisateurs WHERE id = 'agent'").get();

test('connexion par NPI, matricule ou téléphone', () => {
  const parNpi = connecter(db, { type: 'npi', identifiant: agent.npi, mot_de_passe: MOT_DE_PASSE_DEMO });
  assert.equal(parNpi.utilisateur.id, 'agent');
  assert.equal(parNpi.utilisateur.mot_de_passe, undefined, 'le hachage ne doit jamais sortir');
  assert.equal(connecter(db, { type: 'matricule', identifiant: agent.matricule.toLowerCase(), mot_de_passe: MOT_DE_PASSE_DEMO }).utilisateur.id, 'agent');
  // Téléphone saisi avec indicatif, espaces et tirets.
  const tel = `+229 ${agent.telephone.replace(/(\d{2})(?=\d)/g, '$1-')}`;
  assert.equal(connecter(db, { type: 'telephone', identifiant: tel, mot_de_passe: MOT_DE_PASSE_DEMO }).utilisateur.id, 'agent');
  assert.equal(connecter(db, { type: 'matricule', identifiant: 'RH-0001', mot_de_passe: MOT_DE_PASSE_DEMO }).utilisateur.role, 'gestionnaire');
});

test('message identique pour un identifiant inconnu et un mauvais mot de passe', () => {
  const a = assert.throws(() => connecter(db, { type: 'matricule', identifiant: 'INCONNU', mot_de_passe: 'x' }), /incorrect/);
  assert.throws(() => connecter(db, { type: 'matricule', identifiant: 'DRH-0001', mot_de_passe: 'mauvais' }), /incorrect/);
  assert.equal(a, undefined);
});

test('format des identifiants contrôlé', () => {
  assert.throws(() => connecter(db, { type: 'npi', identifiant: '123', mot_de_passe: 'x' }), /10 chiffres/);
  assert.throws(() => connecter(db, { type: 'telephone', identifiant: '0197', mot_de_passe: 'x' }), /10 chiffres/);
});

test(`blocage après ${MAX_ECHECS} échecs, même avec le bon mot de passe`, () => {
  const t0 = new Date('2026-10-27T10:00:00Z');
  for (let i = 0; i < MAX_ECHECS; i++) {
    assert.throws(() => connecter(db, { type: 'matricule', identifiant: 'ADM-0001', mot_de_passe: 'faux' }, t0));
  }
  assert.throws(() => connecter(db, { type: 'matricule', identifiant: 'ADM-0001', mot_de_passe: MOT_DE_PASSE_DEMO }, t0), /Réessayez/);
  // Après 15 minutes, la connexion redevient possible.
  const t1 = new Date(t0.getTime() + 16 * 60000);
  assert.equal(connecter(db, { type: 'matricule', identifiant: 'ADM-0001', mot_de_passe: MOT_DE_PASSE_DEMO }, t1).utilisateur.role, 'admin');
});

test('session : jeton valide, expirée après 8 heures, supprimée à la déconnexion', () => {
  const t0 = new Date();
  const { jeton } = connecter(db, { type: 'matricule', identifiant: 'DRH-0001', mot_de_passe: MOT_DE_PASSE_DEMO }, t0);
  assert.equal(utilisateurDuJeton(db, jeton).id, 'drh');
  assert.equal(utilisateurDuJeton(db, jeton, new Date(t0.getTime() + 9 * 3600000)), null);
  assert.ok(!db.prepare('SELECT 1 FROM sessions WHERE jeton = ?').get(jeton), 'le jeton est stocké haché');
  deconnecter(db, jeton);
  assert.equal(utilisateurDuJeton(db, jeton), null);
});

test('changement du mot de passe : ancien vérifié, politique appliquée, autres sessions fermées', () => {
  const base = ouvrir(':memory:');
  const t1 = connecter(base, { type: 'matricule', identifiant: 'RH-0001', mot_de_passe: MOT_DE_PASSE_DEMO });
  const t2 = connecter(base, { type: 'matricule', identifiant: 'RH-0001', mot_de_passe: MOT_DE_PASSE_DEMO });
  const u = base.prepare("SELECT * FROM utilisateurs WHERE id = 'gestionnaire'").get();
  assert.throws(() => changerMotDePasse(base, u, { actuel: 'faux', nouveau: 'Nouveau2026xx' }, t1.jeton), /actuel incorrect/);
  assert.throws(() => changerMotDePasse(base, u, { actuel: MOT_DE_PASSE_DEMO, nouveau: 'court' }, t1.jeton), /10 caractères/);
  changerMotDePasse(base, u, { actuel: MOT_DE_PASSE_DEMO, nouveau: 'Nouveau2026xx' }, t1.jeton);
  assert.ok(utilisateurDuJeton(base, t1.jeton), 'la session courante reste ouverte');
  assert.equal(utilisateurDuJeton(base, t2.jeton), null, 'les autres sessions sont fermées');
  assert.throws(() => connecter(base, { type: 'matricule', identifiant: 'RH-0001', mot_de_passe: MOT_DE_PASSE_DEMO }), /incorrect/);
  assert.equal(connecter(base, { type: 'matricule', identifiant: 'RH-0001', mot_de_passe: 'Nouveau2026xx' }).utilisateur.id, 'gestionnaire');
});

test('mot de passe oublié : code SMS à usage unique, 5 essais, même réponse pour un compte inconnu', () => {
  const base = ouvrir(':memory:');
  const inconnu = demanderReinitialisation(base, { type: 'matricule', identifiant: 'INCONNU' }, { demo: true });
  const connu = demanderReinitialisation(base, { type: 'matricule', identifiant: 'DRH-0001' }, { demo: true });
  assert.equal(inconnu.message, connu.message);
  assert.equal(inconnu.sms_demo, undefined);
  const code = connu.sms_demo.texte.match(/\d{6}/)[0];
  const faux = code === '000000' ? '111111' : '000000';
  assert.throws(() => reinitialiserMotDePasse(base, { type: 'matricule', identifiant: 'DRH-0001', code: faux, nouveau: 'Reinit2026abc' }), /4 essai/);
  reinitialiserMotDePasse(base, { type: 'matricule', identifiant: 'DRH-0001', code, nouveau: 'Reinit2026abc' });
  assert.equal(connecter(base, { type: 'matricule', identifiant: 'DRH-0001', mot_de_passe: 'Reinit2026abc' }).utilisateur.id, 'drh');
  // Le code ne sert qu'une fois.
  assert.throws(() => reinitialiserMotDePasse(base, { type: 'matricule', identifiant: 'DRH-0001', code, nouveau: 'Encore2026abc' }), /invalide ou expiré/);
  // Sans mode démonstration, le code n'est jamais renvoyé.
  assert.equal(demanderReinitialisation(base, { type: 'matricule', identifiant: 'DRH-0001' }).sms_demo, undefined);
});
