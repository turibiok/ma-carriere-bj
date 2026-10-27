import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrir } from '../src/db.mjs';
import { connecter } from '../src/auth.mjs';
import { DEMO_INSCRIPTION } from '../src/seed.mjs';
import {
  deposerInscription, suivreInscription, detailInscription, validerInscription, rejeterInscription, lireJustificatif,
} from '../src/inscription.mjs';

const PDF = Buffer.from('%PDF-1.4\n%demo\n').toString('base64');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64');
const user = (db, id) => db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(id);

function demande(db, modifs = {}) {
  const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(DEMO_INSCRIPTION.agent);
  return {
    secteur: 'FINANCES', npi: a.npi, nom: a.nom.toLowerCase(), prenoms: a.prenoms, date_naissance: a.date_naissance,
    matricule: a.matricule, statut_agent: 'APE', ministere: 'Ministère chargé des finances', structure: 'Centre des impôts du Littoral',
    emploi: 'Contrôleur des impôts', telephone: '+229 01 97 00 11 22', mot_de_passe: 'NouveauMdp2026', consentement: true,
    justificatifs: {
      ACTE_ENGAGEMENT: { nom: 'arrete.pdf', contenu: PDF },
      BULLETIN_SOLDE: { nom: 'bulletin.png', contenu: PNG },
      ATTESTATION_SERVICE: { nom: 'attestation.pdf', contenu: PDF },
    },
    ...modifs,
  };
}

test("inscription complète : dépôt, contrôles, validation, connexion, justificatifs au coffre-fort", () => {
  const db = ouvrir(':memory:');
  const r = deposerInscription(db, demande(db));
  assert.match(r.numero, /^INS-\d{4}-00001$/);
  const npi = DEMO_INSCRIPTION.npi;
  assert.equal(suivreInscription(db, r.numero, npi).statut, 'EN_ATTENTE');
  assert.throws(() => suivreInscription(db, r.numero, '0000000000'), /Aucune demande/);
  const id = db.prepare('SELECT id FROM inscriptions WHERE numero = ?').get(r.numero).id;
  const d = detailInscription(db, id);
  assert.equal(d.mot_de_passe, undefined);
  assert.ok(d.correspondance.controles.every((c) => c.ok), JSON.stringify(d.correspondance.controles));
  assert.equal(d.justificatifs.find((j) => j.type === 'BULLETIN_SOLDE').mime, 'image/png');
  assert.equal(lireJustificatif(db, id, d.justificatifs[0].id).mime, 'application/pdf');
  // Tant que le compte n'est pas validé, la connexion échoue.
  assert.throws(() => connecter(db, { type: 'npi', identifiant: npi, mot_de_passe: 'NouveauMdp2026' }), /incorrect/);
  validerInscription(db, id, user(db, 'gestionnaire'));
  const c = connecter(db, { type: 'telephone', identifiant: '0197001122', mot_de_passe: 'NouveauMdp2026' });
  assert.equal(c.utilisateur.agent_id, DEMO_INSCRIPTION.agent);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM coffre WHERE agent_id = ? AND type_piece IN ('ACTE_ENGAGEMENT','BULLETIN_SOLDE','ATTESTATION_SERVICE')").get(DEMO_INSCRIPTION.agent).n, 3);
  // Une seconde inscription pour le même agent est refusée.
  assert.throws(() => deposerInscription(db, demande(db)), /compte existe déjà/);
});

test('contrôles du formulaire et des justificatifs', () => {
  const db = ouvrir(':memory:');
  assert.throws(() => deposerInscription(db, demande(db, { secteur: 'INCONNU' })), /secteur/);
  assert.throws(() => deposerInscription(db, demande(db, { npi: '12' })), /10 chiffres/);
  assert.throws(() => deposerInscription(db, demande(db, { mot_de_passe: 'court1' })), /10 caractères/);
  assert.throws(() => deposerInscription(db, demande(db, { consentement: false })), /Certifiez/);
  const j = demande(db).justificatifs;
  assert.throws(() => deposerInscription(db, demande(db, { justificatifs: { ...j, BULLETIN_SOLDE: undefined } })), /manquant/);
  // Un fichier HTML renommé en .pdf est refusé : le type est lu dans le contenu.
  const html = Buffer.from('<html><script>alert(1)</script>').toString('base64');
  assert.throws(() => deposerInscription(db, demande(db, { justificatifs: { ...j, ACTE_ENGAGEMENT: { nom: 'faux.pdf', contenu: html } } })), /Format non accepté/);
  const gros = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(2 * 1024 * 1024)]).toString('base64');
  assert.throws(() => deposerInscription(db, demande(db, { justificatifs: { ...j, ACTE_ENGAGEMENT: { nom: 'gros.pdf', contenu: gros } } })), /trop volumineux/);
  // Un agent qui a déjà un compte ne peut pas s'inscrire une seconde fois.
  const existant = db.prepare("SELECT a.* FROM agents a JOIN utilisateurs u ON u.agent_id = a.id WHERE u.id = 'agent'").get();
  assert.throws(() => deposerInscription(db, demande(db, { npi: existant.npi, matricule: existant.matricule })), /compte existe déjà/);
});

test('validation refusée sans correspondance avec la base RH ; rejet motivé', () => {
  const db = ouvrir(':memory:');
  deposerInscription(db, demande(db, { npi: '5550001111', matricule: 'X999999' }));
  const id = db.prepare("SELECT id FROM inscriptions WHERE npi = '5550001111'").get().id;
  assert.ok(!detailInscription(db, id).correspondance.agent_id);
  assert.throws(() => validerInscription(db, id, user(db, 'gestionnaire')), /Validation impossible/);
  assert.throws(() => rejeterInscription(db, id, '', user(db, 'gestionnaire')), /motif/);
  rejeterInscription(db, id, 'Agent inconnu de la base RH', user(db, 'gestionnaire'));
  assert.equal(suivreInscription(db, db.prepare('SELECT numero FROM inscriptions WHERE id = ?').get(id).numero, '5550001111').motif, 'Agent inconnu de la base RH');
  // Après un rejet, une nouvelle demande est possible.
  assert.ok(deposerInscription(db, demande(db, { npi: '5550001111', matricule: 'X999999' })).numero);
});
