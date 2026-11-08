import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { ouvrir } from '../src/db.mjs';
import { executerMoteur, validerEvenement } from '../src/services.mjs';
import { enregistrerImage } from '../src/signatures.mjs';
import { instantane, restaurer, creerApiPartagee, stockageMemoire } from '../src/persistance.mjs';
import { MOT_DE_PASSE_DEMO } from '../src/seed.mjs';

const image = (nom) => ({ nom, contenu: readFileSync(new URL(`../public/exemples/${nom}`, import.meta.url)).toString('base64') });
const serveurs = [];
after(() => serveurs.forEach((s) => s.close()));

async function instance(stockage, options) {
  const s = createServer(creerApiPartagee(stockage, options));
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  serveurs.push(s);
  const base = `http://127.0.0.1:${s.address().port}`;
  return async (chemin, { jeton, methode = 'GET', corps } = {}) => {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    return { statut: r.status, corps: await r.json() };
  };
}
const connecter = async (appeler, matricule) =>
  (await appeler('/api/connexion', { methode: 'POST', corps: { type: 'matricule', identifiant: matricule, mot_de_passe: MOT_DE_PASSE_DEMO } })).corps.jeton;

test("l'instantané restitue toute la base, fichiers compris, et range une seule fois chaque valeur volumineuse", () => {
  const db = ouvrir(':memory:');
  const drh = db.prepare("SELECT * FROM utilisateurs WHERE id = 'drh'").get();
  enregistrerImage(db, drh, 'signature', image('signature-demo.png'));
  enregistrerImage(db, drh, 'cachet', image('cachet-demo.png'));
  executerMoteur(db);
  for (const e of db.prepare("SELECT id FROM evenements WHERE type = 'AVENANT' LIMIT 2").all()) {
    validerEvenement(db, e.id, drh);
    validerEvenement(db, e.id, drh);
  }
  const { donnees, blocs } = instantane(db);
  // Deux actes portent la même signature et le même cachet : 2 images + leurs 2 data URI, pas davantage.
  assert.equal(blocs.size, 4);
  assert.ok(donnees.length < 200_000, `instantané de ${donnees.length} caractères`);

  const copie = restaurer(donnees, blocs);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  for (const t of tables) {
    assert.deepEqual(copie.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all(), db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all(), t);
  }
});

test('deux instances partagent le même état : ce qui est fait sur l\'une se voit sur l\'autre', async () => {
  const stockage = stockageMemoire();
  const a = await instance(stockage), b = await instance(stockage);
  const drhA = await connecter(a, 'DRH-0001');
  const gestB = await connecter(b, 'RH-0001'); // la session ouverte sur B vaut sur A, et inversement
  assert.equal((await a('/api/moteur/executer', { jeton: drhA, methode: 'POST' })).statut, 200);
  const props = (await b('/api/evenements?statut=PROPOSE&type=AVENANT', { jeton: gestB })).corps;
  assert.ok(props.length > 0, 'les propositions du moteur lancé sur A sont visibles sur B');
  assert.equal((await b(`/api/evenements/${props[0].id}/valider`, { jeton: gestB, methode: 'POST' })).statut, 200);
  const signe = await a(`/api/evenements/${props[0].id}/valider`, { jeton: drhA, methode: 'POST' });
  assert.equal(signe.corps.statut, 'SIGNE');
  const actesB = (await b('/api/actes', { jeton: gestB })).corps;
  assert.deepEqual(actesB.map((t) => t.numero), [signe.corps.acte.numero]);
  // Une lecture n'écrit rien.
  const n = stockage.ecritures;
  await b('/api/actes', { jeton: gestB });
  assert.equal(stockage.ecritures, n);
});

test('écritures concurrentes : la seconde est rejouée sur l\'état le plus récent, rien ne se perd', async () => {
  const commun = stockageMemoire();
  const a = await instance(commun);
  const drhA = await connecter(a, 'DRH-0001');
  await a('/api/moteur/executer', { jeton: drhA, methode: 'POST' });
  const [p1, p2] = (await a('/api/evenements?statut=PROPOSE&type=AVENANT', { jeton: drhA })).corps;

  // B : juste avant sa première écriture, A en fait une autre ; B doit constater le conflit et rejouer.
  let piege = true;
  const b = await instance({
    ...commun,
    version: () => commun.version(), lire: () => commun.lire(), lireBlocs: (h) => commun.lireBlocs(h), ecrireBlocs: (x) => commun.ecrireBlocs(x),
    async ecrire(attendue, e) {
      if (piege) { piege = false; await a(`/api/evenements/${p1.id}/valider`, { jeton: drhA, methode: 'POST' }); }
      return commun.ecrire(attendue, e);
    },
  });
  const drhB = await connecter(b, 'DRH-0001');
  assert.equal((await b(`/api/evenements/${p2.id}/valider`, { jeton: drhB, methode: 'POST' })).statut, 200);
  const instruites = (await a('/api/evenements?statut=VALIDE_RH', { jeton: drhA })).corps.map((e) => e.id).sort();
  assert.deepEqual(instruites, [p1.id, p2.id].sort());
});

test('des données de démonstration trop anciennes sont semées à nouveau', async () => {
  const stockage = stockageMemoire();
  const a = await instance(stockage, { dureeJours: 7 });
  const drh = await connecter(a, 'DRH-0001');
  await a('/api/moteur/executer', { jeton: drh, methode: 'POST' });
  stockage.vieillir('2020-01-01');
  const b = await instance(stockage, { dureeJours: 7 });
  const jeton = await connecter(b, 'DRH-0001');
  assert.equal((await b('/api/evenements?statut=PROPOSE', { jeton })).corps.length, 0, 'données neuves : le moteur n\'a pas encore tourné');
  assert.equal((await stockage.lire()).seme_le, new Date().toISOString().slice(0, 10));
});
