// Fiche de notation annuelle. Trois critères (loi 2015-18, art. 53-54) :
//   compétence (taux de réalisation des attentes), conscience professionnelle,
//   et sens du service public — ou leadership pour les agents qui encadrent.
// Chaque critère se décline en éléments notés de 1 à 5 ; la note est ramenée
// sur 20 selon la règle `ponderation_evaluation`.

export const ECHELLE_NOTATION = [
  { note: 1, libelle: 'Insuffisant' },
  { note: 2, libelle: 'À améliorer' },
  { note: 3, libelle: 'Conforme aux attentes' },
  { note: 4, libelle: 'Au-delà des attentes' },
  { note: 5, libelle: 'Exceptionnel' },
];

// Élément « métier » propre au secteur ; un élément générique vaut pour les autres.
const METIER = {
  SANTE: { code: 'metier', libelle: 'Qualité et sécurité des soins, respect des protocoles' },
  EDUCATION: { code: 'metier', libelle: 'Préparation et conduite des enseignements' },
  ENSEIGNEMENT_SUP: { code: 'metier', libelle: 'Qualité des enseignements et de la recherche' },
};
const METIER_GENERIQUE = { code: 'metier', libelle: 'Maîtrise des tâches du poste et qualité du travail' };

const CONSCIENCE = [
  { code: 'assiduite', libelle: 'Assiduité et ponctualité' },
  { code: 'rigueur', libelle: 'Rigueur et respect des procédures' },
  { code: 'discipline', libelle: 'Discipline et respect de la hiérarchie' },
];

const SERVICE_PUBLIC = [
  { code: 'usagers', libelle: 'Accueil et relations avec les usagers' },
  { code: 'integrite', libelle: 'Intégrité et neutralité' },
  { code: 'disponibilite', libelle: 'Disponibilité et esprit d\'équipe' },
];

const LEADERSHIP = [
  { code: 'animation', libelle: "Animation et encadrement de l'équipe" },
  { code: 'decision', libelle: 'Organisation et prise de décision' },
  { code: 'exemplarite', libelle: 'Exemplarité' },
];

export const OBJECTIFS_TYPES = {
  SANTE: [
    'Réaliser les consultations prénatales prévues au plan de travail',
    'Atteindre le taux de couverture vaccinale fixé pour la zone',
    "Renseigner le système d'information sanitaire chaque mois",
  ],
  EDUCATION: [
    'Achever le programme annuel dans les délais',
    'Atteindre le taux de réussite fixé pour la classe',
    'Participer aux unités pédagogiques et animations',
  ],
};
const OBJECTIFS_GENERIQUES = [
  'Atteindre les résultats fixés par la lettre de mission',
  'Traiter les dossiers dans les délais prescrits',
  "Contribuer à l'amélioration du service rendu aux usagers",
];
export const objectifsTypes = (secteur) => OBJECTIFS_TYPES[secteur] ?? OBJECTIFS_GENERIQUES;

const vierge = (liste) => liste.map((c) => ({ ...c, note: null, auto: null }));
const objectifs = (libelles) => libelles.map((libelle, i) => ({ code: `obj${i + 1}`, libelle, note: null, auto: null }));

// Les objectifs (contrat d'objectifs, art. 51) sont fixés en début de période par l'évaluateur.
export function ficheVierge(secteur, libellesObjectifs = [], encadrant = false) {
  return {
    encadrant,
    rubriques: [
      { code: 'competence', libelle: 'Compétence : réalisation des attentes', criteres: [...objectifs(libellesObjectifs), ...vierge([METIER[secteur] ?? METIER_GENERIQUE])] },
      { code: 'conscience', libelle: 'Conscience professionnelle', criteres: vierge(CONSCIENCE) },
      encadrant
        ? { code: 'service', libelle: 'Leadership', criteres: vierge(LEADERSHIP) }
        : { code: 'service', libelle: 'Sens du service public', criteres: vierge(SERVICE_PUBLIC) },
    ],
  };
}

export function remplacerObjectifs(fiche, libelles) {
  const competence = fiche.rubriques.find((r) => r.code === 'competence');
  competence.criteres = [...objectifs(libelles), ...competence.criteres.filter((c) => !c.code.startsWith('obj'))];
}

export const criteres = (fiche) => fiche.rubriques.flatMap((r) => r.criteres);

// Circuit de la fiche (période du 15 octobre au 15 octobre, art. 51 et 60).
export const ETAPES = {
  OBJECTIFS_FIXES: { libelle: 'Objectifs fixés', acteur: "l'agent (auto-évaluation)" },
  AUTO_EVALUEE: { libelle: 'Auto-évaluation faite', acteur: "l'évaluateur (notation)" },
  EVALUEE: { libelle: "Notée par l'évaluateur", acteur: "l'agent (visa ou recours)" },
  CONTESTEE: { libelle: 'Recours, avis de la CAP', acteur: 'la commission administrative paritaire' },
  CLOTUREE: { libelle: 'Clôturée', acteur: null },
};

export const CALENDRIER = {
  periode: 'du 15 octobre N-1 au 15 octobre N',
  notation: 'du 15 septembre au 15 octobre',
  validation: 'comité de direction, au plus tard le 30 octobre',
  recours: 'avis de la CAP sous 8 jours',
};
