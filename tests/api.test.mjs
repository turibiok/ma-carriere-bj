import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ouvrir } from '../src/db.mjs';
import { creerApi } from '../src/api.mjs';
import { MOT_DE_PASSE_DEMO } from '../src/seed.mjs';

// Chaque profil ouvre toutes les pages de son menu : aucune route appelée ne doit échouer.
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
  const u = db.prepare('SELECT matricule FROM utilisateurs WHERE id = ?').get(id);
  const r = await appeler('/api/connexion', { methode: 'POST', corps: { type: 'matricule', identifiant: u.matricule, mot_de_passe: MOT_DE_PASSE_DEMO } });
  assert.equal(r.statut, 200, `connexion de ${id}`);
  return r.corps.jeton;
};

const AGENT = ['/api/moi', '/api/referentiels', '/api/notifications', '/api/evaluations', '/api/demarches', '/api/demandes', '/api/actes'];
const GESTION = ['/api/moi', '/api/referentiels', '/api/tableau-de-bord', '/api/inscriptions', '/api/evenements?statut=PROPOSE',
  '/api/agents', '/api/evaluations', '/api/demandes', '/api/actes', '/api/regles'];
const PAGES = {
  agent: AGENT,
  evaluateur: [...AGENT, '/api/tableau-de-bord', '/api/agents'],
  gestionnaire: GESTION,
  drh: [...GESTION, '/api/audit'],
  admin: ['/api/moi', '/api/referentiels', '/api/tableau-de-bord', '/api/inscriptions', '/api/regles', '/api/agents', '/api/audit'],
};

for (const [profil, routes] of Object.entries(PAGES)) {
  test(`${profil} : toutes les pages du menu se chargent`, async () => {
    const jeton = await connecter(profil);
    for (const chemin of routes) {
      const r = await appeler(chemin, { jeton });
      assert.equal(r.statut, 200, `${profil} ${chemin} : ${JSON.stringify(r.corps).slice(0, 120)}`);
    }
  });
}

test("l'évaluateur voit ses propres démarches, et celles d'un agent de son équipe s'il le désigne", async () => {
  const jeton = await connecter('evaluateur');
  const moi = db.prepare("SELECT agent_id FROM utilisateurs WHERE id = 'evaluateur'").get().agent_id;
  const equipier = db.prepare('SELECT id FROM agents WHERE superieur_id = ?').get(moi).id;
  const etranger = db.prepare('SELECT id FROM agents WHERE id <> ? AND (superieur_id IS NULL OR superieur_id <> ?)').get(moi, moi).id;
  assert.equal((await appeler('/api/demarches', { jeton })).statut, 200);
  assert.equal((await appeler(`/api/demarches?agent=${equipier}`, { jeton })).statut, 200);
  assert.equal((await appeler(`/api/demarches?agent=${etranger}`, { jeton })).statut, 403);
});
