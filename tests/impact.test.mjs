import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrir } from '../src/db.mjs';
import { executerMoteur, validerEvenement, deposerDemande, actionEvaluation } from '../src/services.mjs';
import { mesurerSimplification } from '../src/impact.mjs';
import { criteres } from '../src/evaluation.mjs';

const user = (db, id) => db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(id);
const notifs = (db, agentId) => db.prepare('SELECT titre FROM notifications WHERE agent_id = ? ORDER BY id').all(agentId).map((n) => n.titre);

test("notifications proactives : l'agent est prévenu sans rien demander, sans doublon", () => {
  const db = ouvrir(':memory:');
  executerMoteur(db);
  executerMoteur(db); // le moteur repasse chaque nuit : pas de seconde notification
  assert.deepEqual(notifs(db, 2), ['Augmentation biennale détectée']);
  const e = db.prepare("SELECT id FROM evenements WHERE agent_id = 2 AND type = 'AVENANT'").get();
  validerEvenement(db, e.id, user(db, 'gestionnaire'));
  validerEvenement(db, e.id, user(db, 'drh'));
  assert.deepEqual(notifs(db, 2), ['Augmentation biennale détectée', 'Acte signé']);
});

test("notation : l'évaluateur puis l'agent sont prévenus à leur tour", () => {
  const db = ouvrir(':memory:');
  const ev = db.prepare('SELECT * FROM evaluations WHERE agent_id = 2 ORDER BY annee DESC').get();
  const notes = (n) => Object.fromEntries(criteres(JSON.parse(ev.fiche)).map((c) => [c.code, n]));
  actionEvaluation(db, ev.id, 'auto', { notes: notes(4) }, user(db, 'agent'));
  assert.deepEqual(notifs(db, 1), ['Fiche de notation à remplir']);
  actionEvaluation(db, ev.id, 'evaluer', { notes: notes(3), commentaire: 'Correct' }, user(db, 'evaluateur'));
  assert.deepEqual(notifs(db, 2), ['Votre notation est disponible']);
});

test('mesure de la simplification : indicateurs agrégés et cohérents', () => {
  const db = ouvrir(':memory:');
  executerMoteur(db);
  deposerDemande(db, 2, { type: 'ATTESTATION_SERVICE' }, user(db, 'agent'));
  const m = mesurerSimplification(db);
  assert.equal(m.agents, 65);
  assert.ok(m.pieces.evitees > 0 && m.pieces.evitees < m.pieces.total);
  assert.equal(m.attestations_immediates, 1);
  assert.ok(m.droits_detectes > 0 && m.retards_rattrapes > 0 && m.rappel_estime > 0);
  // Aucune donnée personnelle dans la réponse publique.
  const texte = JSON.stringify(m);
  for (const interdit of ['HOUNKPATIN', 'npi', 'matricule', '2087345611']) assert.ok(!texte.includes(interdit), interdit);
});
