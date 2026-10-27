// Mesure de la simplification : indicateurs agrégés, publics, sans aucune donnée personnelle.
// Ils permettent de vérifier, chiffres à l'appui, ce que la plateforme épargne aux agents.

import { catalogueDemarches, aujourdhui } from './services.mjs';

const compter = (db, sql, ...p) => db.prepare(sql).get(...p).n ?? 0;

export function mesurerSimplification(db) {
  const annee = Number(aujourdhui().slice(0, 4));

  // Pièces : pour chaque agent, sur toutes les démarches, combien l'administration retrouve seule.
  let piecesTotal = 0, piecesEvitees = 0;
  for (const { id } of db.prepare("SELECT id FROM agents WHERE position = 'ACTIVITE'").all()) {
    for (const d of catalogueDemarches(db, id)) { piecesTotal += d.total; piecesEvitees += d.evitees; }
  }

  const propositions = db.prepare("SELECT type, statut, details FROM evenements WHERE type <> 'ALERTE'").all();
  let retards = 0, rappel = 0;
  for (const e of propositions) {
    const d = JSON.parse(e.details);
    if (d.retard_mois > 0) { retards++; rappel += d.rappel_estime ?? 0; }
  }
  const delais = db.prepare(`SELECT julianday(t.date_signature) - julianday(e.cree_le) AS jours
    FROM evenements e JOIN actes t ON t.id = e.acte_id WHERE e.statut = 'SIGNE'`).all().map((r) => r.jours);

  return {
    date: aujourdhui(),
    agents: compter(db, 'SELECT COUNT(*) AS n FROM agents'),
    secteurs: compter(db, 'SELECT COUNT(DISTINCT c.secteur) AS n FROM agents a JOIN corps c ON c.code = a.corps_code'),
    pieces: { total: piecesTotal, evitees: piecesEvitees },
    demarches_en_ligne: compter(db, 'SELECT COUNT(*) AS n FROM demandes') + compter(db, 'SELECT COUNT(*) AS n FROM inscriptions'),
    attestations_immediates: compter(db, "SELECT COUNT(*) AS n FROM demandes WHERE type = 'ATTESTATION_SERVICE' AND statut = 'DELIVREE'"),
    droits_detectes: propositions.length,
    retards_rattrapes: retards,
    rappel_estime: rappel,
    alertes: compter(db, "SELECT COUNT(*) AS n FROM evenements WHERE type = 'ALERTE'"),
    actes_signes: compter(db, "SELECT COUNT(*) AS n FROM evenements WHERE statut = 'SIGNE'"),
    delai_moyen_jours: delais.length ? Math.round(delais.reduce((s, j) => s + j, 0) / delais.length) : null,
    notation: {
      annee,
      cloturees: compter(db, "SELECT COUNT(*) AS n FROM evaluations WHERE annee = ? AND statut = 'CLOTUREE'", annee),
      total: compter(db, 'SELECT COUNT(*) AS n FROM evaluations WHERE annee = ?', annee),
    },
    notifications: compter(db, 'SELECT COUNT(*) AS n FROM notifications'),
    inscriptions_validees: compter(db, "SELECT COUNT(*) AS n FROM inscriptions WHERE statut = 'VALIDEE'"),
  };
}
