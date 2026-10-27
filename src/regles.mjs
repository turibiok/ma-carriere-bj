// Moteur de règles de carrière : fonctions pures, sans accès à la base.
// Toutes les durées, seuils et correspondances viennent de la table `regles`.
// Valeurs par défaut tirées de la loi n°2015-18 (version votée en 2015) ; les
// articles cités sont ceux de cette version et restent à confirmer sur le texte
// consolidé (lois 2017-43 et 2018-35).

export const REGLES_PAR_DEFAUT = {
  duree_echelon_mois: { valeur: 24, groupe: 'Avancement', libelle: "Ancienneté requise dans un échelon, en mois (art. 116)" },
  echelons_par_grade: { valeur: [4, 3, 3, 3, 2], groupe: 'Avancement', libelle: "Nombre d'échelons de chacun des 5 grades (art. 88)" },
  note_min_grade: { valeur: 14, groupe: 'Avancement', libelle: "Moyenne minimale pour l'avancement de grade, sur 20 (art. 123)" },
  nb_notes_grade: { valeur: 3, groupe: 'Avancement', libelle: "Nombre de dernières notations prises en compte pour le grade (art. 123)" },
  note_min_avenant_acdpe: { valeur: 13, groupe: 'Avancement', libelle: "Moyenne minimale pour l'augmentation biennale des ACDPE, sur 20 (art. 293)" },
  duree_stage_mois: { valeur: 12, groupe: 'Titularisation', libelle: "Durée minimale du stage probatoire, en mois (art. 108)" },
  note_min_titularisation: { valeur: 12, groupe: 'Titularisation', libelle: "Note minimale proposée pour titulariser, sur 20 (à valider)" },
  age_retraite: {
    valeur: { A: 60, B: 58, C: 55, D: 55 },
    groupe: 'Retraite',
    libelle: "Âge limite par catégorie, en années (art. 263, à confirmer)",
  },
  age_retraite_corps: {
    valeur: {},
    groupe: 'Retraite',
    libelle: "Exceptions par code de corps, en années (ex. enseignants du supérieur)",
  },
  alerte_retraite_mois: { valeur: 24, groupe: 'Retraite', libelle: "Préavis de l'alerte de départ, en mois" },
  ponderation_evaluation: {
    valeur: { competence: 40, conscience: 30, service: 30 },
    groupe: 'Évaluation',
    libelle: "Poids des trois critères de notation, en % (art. 53-54 ; poids à valider)",
  },
  mentions: {
    valeur: [
      { min: 18, libelle: 'Excellent' },
      { min: 16, libelle: 'Très bon' },
      { min: 14, libelle: 'Bon' },
      { min: 12, libelle: 'Assez bon' },
      { min: 10, libelle: 'Passable' },
      { min: 0, libelle: 'Médiocre' },
    ],
    groupe: 'Évaluation',
    libelle: "Classes de notation selon la note sur 20 (loi 2015-18)",
  },
  rapport_special: {
    valeur: { sous: 12, des: 18 },
    groupe: 'Évaluation',
    libelle: "Note exigeant un rapport spécial : inférieure à « sous » ou au moins « des » (art. 57)",
  },
  valeur_point_indice: { valeur: 500, groupe: 'Incidence financière', libelle: "Valeur mensuelle du point d'indice, FCFA (démonstration)" },
};

// Quatre catégories (art. 84), trois échelles chacune (art. 85). Rang 0 = la plus élevée.
export const ECHELLES = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3', 'D1', 'D2', 'D3'];
// Grille indiciaire FICTIVE (base, pas par échelon), pour la démonstration uniquement.
const GRILLE = {
  A1: [600, 30], A2: [520, 26], A3: [450, 22], B1: [400, 18], B2: [360, 16], B3: [330, 15],
  C1: [300, 13], C2: [280, 12], C3: [260, 11], D1: [240, 10], D2: [225, 9], D3: [210, 8],
};

export function indice(echelle, echelon) {
  const [base, pas] = GRILLE[echelle];
  return base + pas * (echelon - 1);
}

export const rangEchelle = (echelle) => ECHELLES.indexOf(echelle);
export const categorieDe = (echelle) => echelle[0];
// Les ACDPE ont leurs propres catégories CA à CD (art. 270).
export const libelleEchelle = (agent) => (agent.statut === 'ACDPE' ? `C${agent.echelle}` : agent.echelle);

// Échelons numérotés en continu (1 à 15) ; le grade se déduit de l'échelon.
export function bornesGrades(echelonsParGrade) {
  let cumul = 0;
  return echelonsParGrade.map((n) => (cumul += n));
}
export const echelonMax = (regles) => regles.echelons_par_grade.reduce((s, n) => s + n, 0);
export function gradeDe(echelon, regles) {
  return bornesGrades(regles.echelons_par_grade).findIndex((b) => echelon <= b) + 1;
}
export function dernierEchelonDuGrade(echelon, regles) {
  return bornesGrades(regles.echelons_par_grade)[gradeDe(echelon, regles) - 1];
}

// --- Dates (chaînes ISO AAAA-MM-JJ, calculs en UTC) ---

const parse = (iso) => {
  const [a, m, j] = iso.split('-').map(Number);
  return { a, m, j };
};

export function ajouterMois(iso, n) {
  const { a, m, j } = parse(iso);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  const dernierJour = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(j, dernierJour));
  return d.toISOString().slice(0, 10);
}

export function moisEntre(debut, fin) {
  const a = parse(debut), b = parse(fin);
  let mois = (b.a - a.a) * 12 + (b.m - a.m);
  if (b.j < a.j) mois -= 1;
  return mois;
}

export const anneeDe = (iso) => Number(iso.slice(0, 4));

// --- Évaluation ---

export function noteSur20(fiche, ponderation) {
  let total = 0, poids = 0;
  for (const r of fiche.rubriques) {
    const notes = r.criteres.map((c) => Number(c.note)).filter((n) => n >= 1 && n <= 5);
    if (!notes.length || !ponderation[r.code]) continue;
    total += (notes.reduce((s, n) => s + n, 0) / notes.length / 5) * ponderation[r.code];
    poids += ponderation[r.code];
  }
  if (!poids) return null;
  return Math.round((total / poids) * 20 * 100) / 100;
}

export function mention(note, mentions) {
  if (note === null || note === undefined) return null;
  return mentions.find((m) => note >= m.min)?.libelle ?? null;
}

export const exigeRapportSpecial = (note, regles) => note < regles.rapport_special.sous || note >= regles.rapport_special.des;

// --- Retraite ---

export function ageRetraite(agent, regles) {
  return regles.age_retraite_corps[agent.corps_code] ?? regles.age_retraite[categorieDe(agent.echelle)] ?? 60;
}

export function dateRetraite(agent, regles) {
  return ajouterMois(agent.date_naissance, 12 * ageRetraite(agent, regles));
}

// --- Détection des événements de carrière ---
// ctx : { evaluations: [{annee, note_finale, statut}], diplomes: [{id, niveau, intitule, verifie, pris_en_compte}] }
// Retourne des propositions { type, libelle, date_effet, details } ; la déduplication est faite par l'appelant.

const moyenne = (notes) => Math.round((notes.reduce((s, e) => s + e.note_finale, 0) / notes.length) * 100) / 100;

function etapesAvancement(agent, vers, regles, aujourdhui) {
  const etapes = [];
  let rappel = 0;
  for (let k = 1; k <= vers - agent.echelon; k++) {
    const dateEffet = ajouterMois(agent.date_effet_echelon, regles.duree_echelon_mois * k);
    const gain = indice(agent.echelle, agent.echelon + k) - indice(agent.echelle, agent.echelon + k - 1);
    // Chaque échelon franchi augmente la solde de sa date d'effet jusqu'à aujourd'hui.
    rappel += gain * Math.max(0, moisEntre(dateEffet, aujourdhui)) * regles.valeur_point_indice;
    etapes.push({ echelon: agent.echelon + k, date_effet: dateEffet, indice: indice(agent.echelle, agent.echelon + k) });
  }
  return { etapes, rappel };
}

export function detecterEvenements(agent, ctx, regles, aujourdhui) {
  const propositions = [];
  if (agent.position !== 'ACTIVITE') return propositions;

  const cloturees = ctx.evaluations
    .filter((e) => e.statut === 'CLOTUREE' && e.note_finale !== null)
    .sort((a, b) => b.annee - a.annee);
  const annee = anneeDe(aujourdhui);

  // 1. Départ à la retraite
  const retraite = dateRetraite(agent, regles);
  const moisAvantRetraite = moisEntre(aujourdhui, retraite);
  if (moisAvantRetraite <= regles.alerte_retraite_mois) {
    propositions.push({
      type: 'DEPART_RETRAITE',
      libelle: moisAvantRetraite < 0
        ? `Limite d'âge (${ageRetraite(agent, regles)} ans) dépassée depuis ${-moisAvantRetraite} mois : admission à la retraite à régulariser`
        : `Admission à la retraite le ${retraite} (${ageRetraite(agent, regles)} ans)`,
      date_effet: retraite,
      details: { age: ageRetraite(agent, regles), mois_restants: moisAvantRetraite },
    });
  }

  // 2. Notation de l'année écoulée manquante (art. 62 : faute du notateur)
  const enServiceAnneePrecedente = agent.date_prise_service <= `${annee - 1}-10-15`;
  if (enServiceAnneePrecedente && !ctx.evaluations.some((e) => e.annee === annee - 1 && e.statut === 'CLOTUREE')) {
    propositions.push({
      type: 'ALERTE',
      libelle: `Notation ${annee - 1} absente ou non clôturée`,
      date_effet: `${annee - 1}-10-30`,
      details: { motif: 'EVALUATION_MANQUANTE', annee: annee - 1 },
    });
  }

  // 3. Fin de stage des fonctionnaires stagiaires : titularisation après avis de la CAP (art. 108-111)
  if (agent.statut === 'APE' && agent.stagiaire) {
    const finStage = ajouterMois(agent.date_prise_service, regles.duree_stage_mois);
    if (finStage <= aujourdhui) {
      const derniere = cloturees[0];
      if (derniere && derniere.note_finale >= regles.note_min_titularisation) {
        propositions.push({
          type: 'TITULARISATION',
          libelle: `Titularisation à compter du ${finStage}, après avis de la CAP (note ${derniere.note_finale}/20 en ${derniere.annee})`,
          date_effet: finStage,
          details: { note: derniere.note_finale, annee: derniere.annee },
        });
      } else {
        propositions.push({
          type: 'ALERTE',
          libelle: derniere
            ? `Stage terminé le ${finStage}, note ${derniere.note_finale}/20 : prolongation d'un an ou licenciement à soumettre à la CAP`
            : `Stage terminé le ${finStage} sans notation clôturée : rapport de fin de stage à produire`,
          date_effet: finStage,
          details: { motif: 'TITULARISATION_BLOQUEE' },
        });
      }
    }
    return propositions; // pas d'avancement pendant le stage
  }

  const mois = moisEntre(agent.date_effet_echelon, aujourdhui);
  const dus = Math.floor(mois / regles.duree_echelon_mois);
  const max = echelonMax(regles);

  if (agent.statut === 'ACDPE') {
    // 4a. ACDPE : augmentation tous les deux ans si la moyenne atteint le seuil, par avenant (art. 293)
    const vers = Math.min(agent.echelon + dus, max);
    if (vers > agent.echelon) {
      const periode = cloturees.filter((e) => e.annee >= anneeDe(agent.date_effet_echelon) && e.annee < annee);
      if (!periode.length) {
        propositions.push({
          type: 'ALERTE',
          libelle: `Augmentation biennale bloquée : aucune notation clôturée depuis ${anneeDe(agent.date_effet_echelon)}`,
          date_effet: ajouterMois(agent.date_effet_echelon, regles.duree_echelon_mois),
          details: { motif: 'EVALUATION_MANQUANTE' },
        });
      } else if (moyenne(periode) >= regles.note_min_avenant_acdpe) {
        const { etapes, rappel } = etapesAvancement(agent, vers, regles, aujourdhui);
        propositions.push({
          type: 'AVENANT',
          libelle: `Avenant : palier ${agent.echelon} → ${vers}` + (etapes.length > 1 ? ` (${etapes.length} paliers en retard)` : ''),
          date_effet: etapes.at(-1).date_effet,
          details: { echelle: agent.echelle, de: agent.echelon, vers, moyenne: moyenne(periode), etapes, retard_mois: mois - regles.duree_echelon_mois, rappel_estime: rappel },
        });
      } else {
        propositions.push({
          type: 'ALERTE',
          libelle: `Pas d'augmentation biennale : moyenne ${moyenne(periode)}/20 inférieure à ${regles.note_min_avenant_acdpe}`,
          date_effet: ajouterMois(agent.date_effet_echelon, regles.duree_echelon_mois),
          details: { motif: 'NOTE_INSUFFISANTE', moyenne: moyenne(periode) },
        });
      }
    }
    return propositions; // diplômes : pris en compte seulement à un nouveau recrutement (art. 284)
  }

  // 4b. Fonctionnaires : avancement d'échelon automatique, dans la limite du grade (art. 116-117)
  const finGrade = dernierEchelonDuGrade(agent.echelon, regles);
  const vers = Math.min(agent.echelon + dus, finGrade);
  if (vers > agent.echelon) {
    const { etapes, rappel } = etapesAvancement(agent, vers, regles, aujourdhui);
    propositions.push({
      type: 'AVANCEMENT_ECHELON',
      libelle: `${agent.echelle}, échelon ${agent.echelon} → ${vers}` + (etapes.length > 1 ? ` (${etapes.length} échelons en retard)` : ''),
      date_effet: etapes.at(-1).date_effet,
      details: { echelle: agent.echelle, de: agent.echelon, vers, etapes, retard_mois: mois - regles.duree_echelon_mois, rappel_estime: rappel },
    });
  }

  // 5. Avancement de grade : dernier échelon du grade atteint depuis 2 ans, tableau annuel (art. 119-123)
  const grade = gradeDe(agent.echelon, regles);
  if (agent.echelon === finGrade && agent.echelon < max && dus >= 1) {
    const dernieres = cloturees.slice(0, regles.nb_notes_grade);
    const effet = `${annee + 1}-01-01`;
    if (dernieres.length < regles.nb_notes_grade) {
      propositions.push({
        type: 'ALERTE',
        libelle: `Avancement au grade ${grade + 1} : seulement ${dernieres.length} notation(s) sur ${regles.nb_notes_grade} requises`,
        date_effet: effet,
        details: { motif: 'EVALUATION_MANQUANTE' },
      });
    } else if (moyenne(dernieres) >= regles.note_min_grade) {
      propositions.push({
        type: 'AVANCEMENT_GRADE',
        libelle: `Inscription au tableau d'avancement : grade ${grade} → ${grade + 1} (échelon ${agent.echelon + 1}), moyenne ${moyenne(dernieres)}/20`,
        date_effet: effet,
        details: { echelle: agent.echelle, de: agent.echelon, vers: agent.echelon + 1, grade_de: grade, grade_vers: grade + 1, moyenne: moyenne(dernieres) },
      });
    } else {
      propositions.push({
        type: 'ALERTE',
        libelle: `Non éligible au grade ${grade + 1} : moyenne ${moyenne(dernieres)}/20 sur les ${regles.nb_notes_grade} dernières notations (seuil ${regles.note_min_grade})`,
        date_effet: effet,
        details: { motif: 'NOTE_INSUFFISANTE', moyenne: moyenne(dernieres) },
      });
    }
  }

  // 6. Nouveau diplôme vérifié : il ouvre droit au concours professionnel, pas à un reclassement direct (art. 138-140)
  for (const d of ctx.diplomes.filter((x) => x.verifie && !x.pris_en_compte)) {
    propositions.push({
      type: 'ALERTE',
      libelle: `Nouveau diplôme (${d.intitule}) : candidature au prochain concours professionnel à examiner`,
      date_effet: d.date_obtention,
      details: { motif: 'CONCOURS_PROFESSIONNEL', diplome_id: d.id },
    });
  }

  return propositions;
}
