import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrir } from '../src/db.mjs';
import {
  executerMoteur, validerEvenement, rejeterEvenement, actionEvaluation, deposerDemande, traiterDemande,
  catalogueDemarches, verifierDiplome, ErreurMetier,
} from '../src/services.mjs';
import { criteres } from '../src/evaluation.mjs';

const nouvelleBase = () => ouvrir(':memory:');
const PDF = (nom) => ({ nom, contenu: Buffer.from(`%PDF-1.4\n% ${nom}\n`).toString('base64') });
const user = (db, id) => db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(id);
const compter = (db, sql, ...p) => db.prepare(`SELECT COUNT(*) AS n FROM evenements WHERE ${sql}`).get(...p).n;

test('le moteur détecte les cas de démonstration, sans doublons', () => {
  const db = nouvelleBase();
  const r = executerMoteur(db);
  for (const t of ['AVANCEMENT_ECHELON', 'AVENANT', 'AVANCEMENT_GRADE', 'TITULARISATION', 'DEPART_RETRAITE', 'ALERTE']) {
    assert.ok(r.propositions[t] > 0, `aucune proposition ${t}`);
  }
  const n = compter(db, '1 = 1');
  executerMoteur(db);
  assert.equal(compter(db, '1 = 1'), n);
});

test("circuit d'un avenant ACDPE : instruction, signature, situation mise à jour", () => {
  const db = nouvelleBase();
  executerMoteur(db);
  const e = db.prepare("SELECT * FROM evenements WHERE agent_id = 2 AND type = 'AVENANT'").get();
  const vers = JSON.parse(e.details).vers;
  assert.throws(() => validerEvenement(db, e.id, user(db, 'agent')), ErreurMetier);
  assert.equal(validerEvenement(db, e.id, user(db, 'gestionnaire')).statut, 'VALIDE_RH');
  assert.throws(() => validerEvenement(db, e.id, user(db, 'gestionnaire')), /DRH/);
  assert.equal(validerEvenement(db, e.id, user(db, 'drh')).statut, 'SIGNE');
  assert.equal(db.prepare('SELECT echelon FROM agents WHERE id = 2').get().echelon, vers);
  executerMoteur(db);
  assert.equal(compter(db, "agent_id = 2 AND type = 'AVENANT' AND statut = 'PROPOSE'"), 0);
});

test('rejet motivé obligatoire', () => {
  const db = nouvelleBase();
  executerMoteur(db);
  const e = db.prepare("SELECT id FROM evenements WHERE type = 'AVANCEMENT_GRADE'").get();
  assert.throws(() => rejeterEvenement(db, e.id, '', user(db, 'gestionnaire')), /motif/);
  rejeterEvenement(db, e.id, 'Quota du grade atteint', user(db, 'gestionnaire'));
  assert.equal(db.prepare('SELECT statut FROM evenements WHERE id = ?').get(e.id).statut, 'REJETE');
});

test('circuit de notation : auto-évaluation, notation, rapport spécial, recours, CAP', () => {
  const db = nouvelleBase();
  const ev = db.prepare('SELECT * FROM evaluations WHERE agent_id = 2 ORDER BY annee DESC').get();
  const notes = (n) => Object.fromEntries(criteres(JSON.parse(ev.fiche)).map((c) => [c.code, n]));
  assert.throws(() => actionEvaluation(db, ev.id, 'auto', { notes: notes(4) }, user(db, 'evaluateur')), /agent/);
  assert.equal(actionEvaluation(db, ev.id, 'auto', { notes: notes(4) }, user(db, 'agent')).statut, 'AUTO_EVALUEE');
  // Note de 8/20 : rapport spécial exigé.
  assert.throws(() => actionEvaluation(db, ev.id, 'evaluer', { notes: notes(2), commentaire: 'Insuffisant' }, user(db, 'evaluateur')), /rapport spécial/);
  const r = actionEvaluation(db, ev.id, 'evaluer', { notes: notes(3), commentaire: 'Travail correct' }, user(db, 'evaluateur'));
  assert.deepEqual([r.note_finale, r.mention], [12, 'Assez bon']);
  assert.throws(() => actionEvaluation(db, ev.id, 'viser', { accord: false }, user(db, 'agent')), /motif/);
  assert.equal(actionEvaluation(db, ev.id, 'viser', { accord: false, motif: 'Objectifs atteints' }, user(db, 'agent')).statut, 'CONTESTEE');
  const c = actionEvaluation(db, ev.id, 'commission', { note: 14, decision: 'Note relevée sur avis de la CAP' }, user(db, 'drh'));
  assert.deepEqual([c.statut, c.note_finale, c.mention], ['CLOTUREE', 14, 'Bon']);
});

test('dites-le nous une fois : seules les pièces nouvelles sont demandées, et une seule fois', () => {
  const db = nouvelleBase();
  db.prepare("DELETE FROM coffre WHERE agent_id = 2 AND type_piece = 'RIB'").run();
  const pension = () => catalogueDemarches(db, 2).find((d) => d.type === 'PENSION');
  assert.deepEqual(pension().pieces.filter((p) => p.a_fournir).map((p) => p.type), ['RIB']);
  assert.throws(() => deposerDemande(db, 2, { type: 'PENSION' }, user(db, 'agent')), /Pièces à joindre/);
  deposerDemande(db, 2, { type: 'PENSION', fichiers: { RIB: PDF('rib.pdf') } }, user(db, 'agent'));
  assert.equal(pension().pieces.filter((p) => p.a_fournir).length, 0);
});

test('sans NPI, les pièces d\'état civil redeviennent à fournir', () => {
  const db = nouvelleBase();
  db.prepare('UPDATE agents SET npi = NULL WHERE id = 2').run();
  const att = catalogueDemarches(db, 2).find((d) => d.type === 'ATTESTATION_SERVICE');
  assert.deepEqual(att.pieces.filter((p) => p.a_fournir).map((p) => p.type), ['CIP']);
});

test('attestation de service délivrée immédiatement, sans aucune pièce', () => {
  const db = nouvelleBase();
  const r = deposerDemande(db, 2, { type: 'ATTESTATION_SERVICE' }, user(db, 'agent'));
  assert.equal(r.statut, 'DELIVREE');
  assert.equal(r.evitees, r.total);
});

test('nouveau diplôme déclaré par un fonctionnaire : vérifié puis signalé pour le concours professionnel', () => {
  const db = nouvelleBase();
  const evaluateur = user(db, 'evaluateur'); // agent 1, fonctionnaire
  db.prepare('UPDATE diplomes SET verifie = 1, pris_en_compte = 1 WHERE agent_id = 1').run();
  deposerDemande(db, 1, { type: 'DECLARATION_DIPLOME', fichiers: { NOUVEAU_DIPLOME: PDF('master.pdf') }, diplome: { intitule: 'Master', niveau: 'MASTER', date_obtention: '2026-07-01' } }, evaluateur);
  executerMoteur(db);
  const motifs = () => db.prepare("SELECT details FROM evenements WHERE agent_id = 1 AND type = 'ALERTE'").all().map((e) => JSON.parse(e.details).motif);
  assert.ok(!motifs().includes('CONCOURS_PROFESSIONNEL'));
  verifierDiplome(db, db.prepare('SELECT id FROM diplomes WHERE agent_id = 1 AND verifie = 0').get().id, user(db, 'gestionnaire'));
  executerMoteur(db);
  assert.ok(motifs().includes('CONCOURS_PROFESSIONNEL'));
});

test('disponibilité : refusée aux ACDPE, acceptée pour un fonctionnaire avec acte et changement de position', () => {
  const db = nouvelleBase();
  assert.throws(() => deposerDemande(db, 2, { type: 'DISPONIBILITE', motif: 'Études', fichiers: { JUSTIFICATIF_MOTIF: PDF('justificatif.pdf') } }, user(db, 'agent')), /statut/);
  const r = deposerDemande(db, 1, { type: 'DISPONIBILITE', motif: 'Suivre son conjoint', fichiers: { JUSTIFICATIF_MOTIF: PDF('justificatif.pdf') } }, user(db, 'evaluateur'));
  traiterDemande(db, r.id, { decision: 'ACCEPTEE' }, user(db, 'gestionnaire'));
  assert.equal(db.prepare('SELECT position FROM agents WHERE id = 1').get().position, 'DISPONIBILITE');
});

test('pièces jointes : fichier réel exigé, conservé au coffre-fort ou joint à la demande', () => {
  const db = nouvelleBase();
  db.prepare("DELETE FROM coffre WHERE agent_id = 2 AND type_piece = 'RIB'").run();
  // Une déclaration sans fichier, ou un faux PDF, est refusée.
  assert.throws(() => deposerDemande(db, 2, { type: 'PENSION', fichiers: { RIB: { nom: 'rib.pdf', contenu: '' } } }, user(db, 'agent')), /vide/);
  const faux = { nom: 'rib.pdf', contenu: Buffer.from('<html>').toString('base64') };
  assert.throws(() => deposerDemande(db, 2, { type: 'PENSION', fichiers: { RIB: faux } }, user(db, 'agent')), /Format non accepté/);
  deposerDemande(db, 2, { type: 'PENSION', fichiers: { RIB: PDF('rib.pdf') } }, user(db, 'agent'));
  const coffre = db.prepare("SELECT document_id FROM coffre WHERE agent_id = 2 AND type_piece = 'RIB'").get();
  assert.ok(coffre.document_id, 'le RIB est conservé avec son fichier');
  assert.equal(db.prepare('SELECT mime FROM documents WHERE id = ?').get(coffre.document_id).mime, 'application/pdf');
  // Pièce propre à une démarche : jointe à la demande, pas au coffre-fort.
  const r = deposerDemande(db, 1, { type: 'DISPONIBILITE', motif: 'Études', fichiers: { JUSTIFICATIF_MOTIF: PDF('inscription.pdf') } }, user(db, 'evaluateur'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents WHERE demande_id = ?').get(r.id).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM coffre WHERE agent_id = 1 AND type_piece = 'JUSTIFICATIF_MOTIF'").get().n, 0);
});
