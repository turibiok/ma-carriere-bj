import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGLES_PAR_DEFAUT, detecterEvenements, ajouterMois, moisEntre, noteSur20, mention, dateRetraite,
  gradeDe, dernierEchelonDuGrade, echelonMax, exigeRapportSpecial,
} from '../src/regles.mjs';
import { ficheVierge, criteres } from '../src/evaluation.mjs';

const regles = Object.fromEntries(Object.entries(REGLES_PAR_DEFAUT).map(([k, v]) => [k, v.valeur]));
const AUJ = '2026-10-27';
const base = {
  statut: 'APE', stagiaire: 0, position: 'ACTIVITE', corps_code: 'INST', echelle: 'B1', echelon: 2,
  date_naissance: '1990-05-10', date_prise_service: '2015-01-01', date_effet_echelon: '2024-01-01',
};
const evals = (annees, note = 14) => annees.map((annee) => ({ annee, note_finale: note, statut: 'CLOTUREE' }));
const types = (props) => props.map((p) => p.type);
const sans = (props, motif) => props.filter((p) => p.details.motif !== motif);

test('dates : ajout de mois en fin de mois et écart en mois', () => {
  assert.equal(ajouterMois('2024-01-31', 1), '2024-02-29');
  assert.equal(moisEntre('2024-01-01', '2026-01-01'), 24);
  assert.equal(moisEntre('2024-01-15', '2026-01-14'), 23);
});

test('grades : 5 grades de 4, 3, 3, 3 et 2 échelons', () => {
  assert.equal(echelonMax(regles), 15);
  assert.deepEqual([1, 4, 5, 7, 8, 11, 14, 15].map((e) => gradeDe(e, regles)), [1, 1, 2, 2, 3, 4, 5, 5]);
  assert.equal(dernierEchelonDuGrade(9, regles), 10);
});

test("fonctionnaire : pas d'avancement avant 24 mois", () => {
  const p = detecterEvenements({ ...base, date_effet_echelon: '2025-01-01' }, { evaluations: evals([2025]), diplomes: [] }, regles, AUJ);
  assert.deepEqual(types(p), []);
});

test("fonctionnaire : avancement d'échelon automatique, sans condition de note", () => {
  const p = detecterEvenements(base, { evaluations: evals([2024, 2025], 9), diplomes: [] }, regles, AUJ);
  assert.deepEqual(types(p), ['AVANCEMENT_ECHELON']);
  assert.equal(p[0].details.vers, 3);
  assert.equal(p[0].date_effet, '2026-01-01');
});

test("rattrapage des retards plafonné au dernier échelon du grade, avec rappel estimé", () => {
  const p = detecterEvenements({ ...base, echelon: 1, date_effet_echelon: '2018-01-01' }, { evaluations: evals([2021, 2022, 2023, 2024, 2025]), diplomes: [] }, regles, AUJ);
  const av = p.find((x) => x.type === 'AVANCEMENT_ECHELON');
  assert.equal(av.details.vers, 4); // 4 échelons dus, mais le grade 1 s'arrête à l'échelon 4
  assert.equal(av.details.etapes.length, 3);
  assert.ok(av.details.rappel_estime > 0);
});

test("avancement de grade : dernier échelon depuis 2 ans et moyenne d'au moins 14 sur 3 notations", () => {
  const agent = { ...base, echelon: 7, date_effet_echelon: '2024-03-01' };
  const ok = detecterEvenements(agent, { evaluations: evals([2023, 2024, 2025], 15), diplomes: [] }, regles, AUJ);
  assert.deepEqual(types(ok), ['AVANCEMENT_GRADE']);
  assert.deepEqual([ok[0].details.grade_vers, ok[0].details.vers, ok[0].date_effet], [3, 8, '2027-01-01']);
  const faible = detecterEvenements(agent, { evaluations: evals([2023, 2024, 2025], 13.5), diplomes: [] }, regles, AUJ);
  assert.equal(faible[0].details.motif, 'NOTE_INSUFFISANTE');
  const incomplet = detecterEvenements(agent, { evaluations: evals([2024, 2025], 17), diplomes: [] }, regles, AUJ);
  assert.equal(incomplet[0].details.motif, 'EVALUATION_MANQUANTE');
});

test('ACDPE : augmentation biennale par avenant si la moyenne atteint 13', () => {
  const acdpe = { ...base, statut: 'ACDPE' };
  assert.deepEqual(types(detecterEvenements(acdpe, { evaluations: evals([2024, 2025], 13), diplomes: [] }, regles, AUJ)), ['AVENANT']);
  const p = detecterEvenements(acdpe, { evaluations: evals([2024, 2025], 12.5), diplomes: [] }, regles, AUJ);
  assert.equal(p[0].details.motif, 'NOTE_INSUFFISANTE');
});

test('ACDPE : jamais titularisé, et sans grade (paliers continus)', () => {
  const p = detecterEvenements({ ...base, statut: 'ACDPE', stagiaire: 1, echelon: 4, date_effet_echelon: '2023-01-01' }, { evaluations: evals([2023, 2024, 2025]), diplomes: [] }, regles, AUJ);
  assert.deepEqual(types(p), ['AVENANT']);
  assert.equal(p[0].details.vers, 5); // franchit la borne de grade des fonctionnaires
});

test('notation de l\'année écoulée manquante : alerte', () => {
  const p = detecterEvenements({ ...base, date_effet_echelon: '2025-06-01' }, { evaluations: evals([2024]), diplomes: [] }, regles, AUJ);
  assert.equal(p[0].details.motif, 'EVALUATION_MANQUANTE');
  assert.equal(p[0].details.annee, 2025);
});

test('fin de stage : titularisation proposée, ou renvoi à la CAP', () => {
  const stagiaire = { ...base, stagiaire: 1, date_prise_service: '2025-08-01', date_effet_echelon: '2025-08-01', echelon: 1 };
  assert.deepEqual(types(detecterEvenements(stagiaire, { evaluations: evals([2025], 13), diplomes: [] }, regles, AUJ)), ['TITULARISATION']);
  const p = detecterEvenements(stagiaire, { evaluations: evals([2025], 8), diplomes: [] }, regles, AUJ);
  assert.equal(p[0].details.motif, 'TITULARISATION_BLOQUEE');
});

test('retraite : limite d\'âge par catégorie (A 60, B 58, C 55)', () => {
  const ne = '1970-03-01';
  assert.equal(dateRetraite({ ...base, date_naissance: ne, echelle: 'A1' }, regles), '2030-03-01');
  assert.equal(dateRetraite({ ...base, date_naissance: ne, echelle: 'B1' }, regles), '2028-03-01');
  assert.equal(dateRetraite({ ...base, date_naissance: ne, echelle: 'C1' }, regles), '2025-03-01');
  const proche = { ...base, date_naissance: '1969-06-01', date_effet_echelon: '2026-01-01' }; // B : départ 2027-06-01
  assert.deepEqual(types(sans(detecterEvenements(proche, { evaluations: evals([2025]), diplomes: [] }, regles, AUJ), 'x')), ['DEPART_RETRAITE']);
  // Exception par corps prioritaire sur la catégorie.
  const r2 = { ...regles, age_retraite_corps: { INST: 62 } };
  assert.deepEqual(types(detecterEvenements(proche, { evaluations: evals([2025]), diplomes: [] }, r2, AUJ)), []);
});

test('nouveau diplôme vérifié : examen pour le concours professionnel, pas de reclassement direct', () => {
  const d = { id: 9, niveau: 'LICENCE', intitule: 'Licence', verifie: 1, pris_en_compte: 0, date_obtention: '2026-06-01' };
  const agent = { ...base, date_effet_echelon: '2026-01-01' };
  const p = detecterEvenements(agent, { evaluations: evals([2025]), diplomes: [d] }, regles, AUJ);
  assert.deepEqual(p.map((x) => x.details.motif), ['CONCOURS_PROFESSIONNEL']);
  assert.equal(detecterEvenements(agent, { evaluations: evals([2025]), diplomes: [{ ...d, verifie: 0 }] }, regles, AUJ).length, 0);
  // ACDPE : diplôme pris en compte seulement lors d'un nouveau recrutement.
  assert.equal(detecterEvenements({ ...agent, statut: 'ACDPE' }, { evaluations: evals([2025]), diplomes: [d] }, regles, AUJ).length, 0);
});

test('agent en disponibilité : aucune proposition', () => {
  assert.equal(detecterEvenements({ ...base, position: 'DISPONIBILITE' }, { evaluations: [], diplomes: [] }, regles, AUJ).length, 0);
});

test('note sur 20 pondérée, classes et rapport spécial', () => {
  const fiche = ficheVierge('EDUCATION', ['Objectif'], false);
  const notes = { competence: 5, conscience: 3, service: 4 };
  for (const r of fiche.rubriques) for (const c of r.criteres) c.note = notes[r.code];
  // (5/5*40 + 3/5*30 + 4/5*30) / 100 * 20 = 16.4
  assert.equal(noteSur20(fiche, regles.ponderation_evaluation), 16.4);
  assert.equal(mention(16.4, regles.mentions), 'Très bon');
  assert.equal(mention(18, regles.mentions), 'Excellent');
  assert.equal(mention(9.99, regles.mentions), 'Médiocre');
  assert.deepEqual([11.9, 12, 17.9, 18].map((n) => exigeRapportSpecial(n, regles)), [true, false, false, true]);
  assert.equal(ficheVierge('SANTE', [], true).rubriques[2].libelle, 'Leadership');
  assert.ok(criteres(fiche).length >= 7);
});
