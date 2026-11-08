import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { ouvrir } from '../src/db.mjs';
import { creerApi } from '../src/api.mjs';
import { executerMoteur } from '../src/services.mjs';
import { MOT_DE_PASSE_DEMO } from '../src/seed.mjs';

const db = ouvrir(':memory:');
const serveur = createServer(creerApi(db));
await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${serveur.address().port}`;
after(() => serveur.close());

const appeler = async (chemin, { jeton, methode = 'GET', corps } = {}) => {
  const r = await fetch(base + chemin, {
    method: methode,
    headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { statut: r.status, corps: await r.json() };
};
const connecter = async (id) => {
  const { matricule } = db.prepare('SELECT matricule FROM utilisateurs WHERE id = ?').get(id);
  return (await appeler('/api/connexion', { methode: 'POST', corps: { type: 'matricule', identifiant: matricule, mot_de_passe: MOT_DE_PASSE_DEMO } })).corps.jeton;
};
const fichier = (nom) => ({ nom, contenu: readFileSync(new URL(`../public/exemples/${nom}`, import.meta.url)).toString('base64') });
const PNG = /^data:image\/png;base64,/;

const drh = await connecter('drh');
const gestionnaire = await connecter('gestionnaire');

// Fait instruire puis signer par le DRH la première proposition signable ; renvoie l'acte.
async function signerUnActe() {
  const e = db.prepare("SELECT id FROM evenements WHERE statut = 'PROPOSE' AND type <> 'ALERTE' ORDER BY id LIMIT 1").get();
  assert.equal((await appeler(`/api/evenements/${e.id}/valider`, { jeton: gestionnaire, methode: 'POST' })).statut, 200);
  const r = await appeler(`/api/evenements/${e.id}/valider`, { jeton: drh, methode: 'POST' });
  assert.equal(r.statut, 200);
  return (await appeler(`/api/actes/${r.corps.acte.id}`, { jeton: drh })).corps;
}

test('sans image importée, l\'acte porte le nom du signataire seul', async () => {
  executerMoteur(db);
  const s = await appeler('/api/signature', { jeton: drh });
  assert.deepEqual([s.statut, s.corps.signature, s.corps.cachet], [200, null, null]);
  const acte = await signerUnActe();
  assert.equal(acte.signature, null);
  assert.equal(acte.cachet, null);
});

test('le DRH importe sa signature et son cachet, apposés sur les actes qu\'il signe', async () => {
  assert.equal((await appeler('/api/signature/signature', { jeton: drh, methode: 'PUT', corps: fichier('signature-demo.png') })).statut, 200);
  const r = await appeler('/api/signature/cachet', { jeton: drh, methode: 'PUT', corps: fichier('cachet-demo.png') });
  assert.equal(r.statut, 200);
  assert.match(r.corps.signature, PNG);
  assert.match(r.corps.cachet, PNG);
  assert.equal(r.corps.fichiers.cachet.nom, 'cachet-demo.png');

  const acte = await signerUnActe();
  assert.equal(acte.signature, r.corps.signature);
  assert.equal(acte.cachet, r.corps.cachet);

  // Remplacer puis retirer les images ne modifie pas l'acte déjà signé.
  await appeler('/api/signature/signature', { jeton: drh, methode: 'PUT', corps: fichier('cachet-demo.png') });
  const retrait = await appeler('/api/signature/cachet', { jeton: drh, methode: 'DELETE' });
  assert.equal(retrait.corps.cachet, null);
  const relu = (await appeler(`/api/actes/${acte.id}`, { jeton: drh })).corps;
  assert.equal(relu.signature, r.corps.signature);
  assert.equal(relu.cachet, r.corps.cachet);

  // La vérification publique ne diffuse pas les images.
  const v = await appeler(`/api/verifier/${acte.code_verification}`);
  assert.equal(v.corps.authentique, true);
  assert.equal(v.corps.signature, undefined);
  assert.equal(v.corps.cachet, undefined);

  const journal = db.prepare("SELECT action FROM audit WHERE action LIKE '%Signature%' OR action LIKE '%Cachet%'").all().map((a) => a.action);
  assert.deepEqual(journal, ['Signature importée', 'Cachet importé', 'Signature importée', 'Cachet retiré']);
});

test('chaque signataire a ses propres images ; l\'attestation automatique n\'en porte pas', async () => {
  assert.equal((await appeler('/api/signature', { jeton: gestionnaire })).corps.signature, null);
  const agent = await connecter('agent');
  const r = await appeler('/api/demandes', { jeton: agent, methode: 'POST', corps: { type: 'ATTESTATION_SERVICE' } });
  assert.equal(r.statut, 200);
  const id = db.prepare('SELECT acte_id FROM demandes WHERE id = ?').get(r.corps.id).acte_id;
  const attestation = (await appeler(`/api/actes/${id}`, { jeton: agent })).corps;
  assert.equal(attestation.signataire, 'Délivrance automatique');
  assert.equal(attestation.signature, null);
});

test('import refusé : profil non signataire, PDF, image trop lourde, type inconnu', async () => {
  const agent = await connecter('agent');
  assert.equal((await appeler('/api/signature/signature', { jeton: agent, methode: 'PUT', corps: fichier('signature-demo.png') })).statut, 403);
  assert.equal((await appeler('/api/signature', { jeton: await connecter('admin') })).statut, 403);
  const pdf = { nom: 'faux.pdf', contenu: Buffer.from('%PDF-1.4\n%').toString('base64') };
  const r1 = await appeler('/api/signature/signature', { jeton: drh, methode: 'PUT', corps: pdf });
  assert.equal(r1.statut, 400);
  assert.match(r1.corps.erreur, /PNG ou JPEG/);
  // Un SVG (qui pourrait porter du script) est refusé : seul le contenu réel compte, pas le nom.
  const svg = { nom: 'signature.png', contenu: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64') };
  assert.equal((await appeler('/api/signature/signature', { jeton: drh, methode: 'PUT', corps: svg })).statut, 400);
  const lourd = Buffer.alloc(600 * 1024); lourd.set([0x89, 0x50, 0x4e, 0x47]);
  const r2 = await appeler('/api/signature/cachet', { jeton: drh, methode: 'PUT', corps: { nom: 'gros.png', contenu: lourd.toString('base64') } });
  assert.equal(r2.statut, 400);
  assert.match(r2.corps.erreur, /500 Ko/);
  assert.equal((await appeler('/api/signature/paraphe', { jeton: drh, methode: 'PUT', corps: fichier('signature-demo.png') })).statut, 400);
});
