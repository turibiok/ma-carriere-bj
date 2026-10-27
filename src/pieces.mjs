// Principe « Dites-le nous une fois » : pour chaque pièce, on indique d'où
// l'administration peut l'obtenir elle-même. L'agent ne fournit que ce qui est
// réellement nouveau (motif, nouveau diplôme, accord d'un organisme d'accueil...).

export const SOURCES = {
  RNPP: "Registre national des personnes physiques (ANIP), lu avec le NPI",
  BASE_RH: "Dossier individuel numérique (pièces versées au recrutement et actes de carrière)",
  COFFRE: "Coffre-fort de l'agent (pièce déjà fournie et vérifiée)",
  SOLDE: 'Système de solde (Finances), par interconnexion',
  JUSTICE: 'Casier judiciaire en ligne, authentifié par le NPI',
  FORMULAIRE: 'Saisie en ligne dans la démarche',
  CIRCUIT: 'Avis recueilli dans le circuit de validation',
  AGENT: "À fournir par l'agent",
};

// Pièces exigées au recrutement (loi 2015-18, art. 13). Une fois versées, elles
// alimentent le dossier individuel et ne doivent plus être redemandées.
export const PIECES_RECRUTEMENT = [
  'Demande', 'Certificat de nationalité', 'Fiche de renseignements', 'Acte de naissance',
  'Casier judiciaire de moins de 3 mois', 'État signalétique militaire', 'Certificat médical',
  'Diplôme certifié conforme', 'Certificat de prise de service', "Deux photos d'identité",
  "Engagement au code d'éthique",
];

// type → { libelle, source }
export const PIECES = {
  DEMANDE_MANUSCRITE: { libelle: 'Demande manuscrite adressée au ministre', source: 'FORMULAIRE' },
  ACTE_NAISSANCE: { libelle: "Copie de l'acte de naissance", source: 'RNPP' },
  CERTIFICAT_NATIONALITE: { libelle: 'Certificat de nationalité', source: 'BASE_RH' },
  CIP: { libelle: "Certificat d'identification personnelle (CIP)", source: 'RNPP' },
  CASIER_JUDICIAIRE: { libelle: 'Extrait de casier judiciaire', source: 'JUSTICE' },
  ACTE_MARIAGE: { libelle: 'Acte de mariage', source: 'RNPP' },
  ACTES_NAISSANCE_ENFANTS: { libelle: 'Actes de naissance des enfants', source: 'RNPP' },
  DIPLOMES: { libelle: 'Copies certifiées des diplômes', source: 'COFFRE' },
  ACTE_RECRUTEMENT: { libelle: 'Arrêté de nomination ou contrat de travail', source: 'BASE_RH' },
  CERTIFICAT_PRISE_SERVICE: { libelle: 'Certificat de première prise de service', source: 'BASE_RH' },
  DERNIER_ACTE_CARRIERE: { libelle: "Dernier acte d'avancement (arrêté ou avenant)", source: 'BASE_RH' },
  ATTESTATION_PRESENCE: { libelle: 'Attestation de présence au poste', source: 'BASE_RH' },
  FICHES_EVALUATION: { libelle: 'Bulletins de notation des dernières années', source: 'BASE_RH' },
  BULLETIN_SOLDE: { libelle: 'Dernier bulletin de solde', source: 'SOLDE' },
  RIB: { libelle: "Relevé d'identité bancaire", source: 'COFFRE' },
  PHOTOS: { libelle: "Photos d'identité", source: 'COFFRE' },
  AVIS_SUPERIEUR: { libelle: 'Avis motivé du supérieur hiérarchique', source: 'CIRCUIT' },
  NOUVEAU_DIPLOME: { libelle: 'Nouveau diplôme (copie certifiée)', source: 'AGENT' },
  JUSTIFICATIF_MOTIF: { libelle: "Justificatif du motif (acte de naissance de l'enfant, attestation d'inscription...)", source: 'AGENT' },
  ACCORD_ACCUEIL: { libelle: "Accord de l'organisme d'accueil", source: 'AGENT' },
};

export const DEMARCHES = {
  ATTESTATION_SERVICE: {
    libelle: 'Attestation de service / de présence au poste',
    delai: 'Immédiat',
    pieces: ['DEMANDE_MANUSCRITE', 'CIP', 'ACTE_RECRUTEMENT', 'CERTIFICAT_PRISE_SERVICE', 'DERNIER_ACTE_CARRIERE'],
  },
  DECLARATION_DIPLOME: {
    libelle: "Déclaration d'un nouveau diplôme",
    delai: 'Vérification sous 15 jours',
    note: "Pour un fonctionnaire, ouvre l'accès au concours professionnel ; pour un ACDPE, sert lors d'un nouveau recrutement.",
    pieces: ['DEMANDE_MANUSCRITE', 'NOUVEAU_DIPLOME', 'ACTE_NAISSANCE', 'CERTIFICAT_NATIONALITE', 'ACTE_RECRUTEMENT', 'DERNIER_ACTE_CARRIERE'],
  },
  DISPONIBILITE: {
    libelle: 'Mise en disponibilité',
    delai: '30 jours',
    statuts: ['APE'], // les ACDPE n'ont que les positions d'activité et de détachement (art. 286)
    note: "Au moins un an ; ni avancement ni droits à pension pendant la période ; réintégration à demander 6 mois avant l'échéance.",
    pieces: ['DEMANDE_MANUSCRITE', 'CIP', 'ACTE_RECRUTEMENT', 'CERTIFICAT_PRISE_SERVICE', 'DERNIER_ACTE_CARRIERE', 'AVIS_SUPERIEUR', 'JUSTIFICATIF_MOTIF'],
  },
  DETACHEMENT: {
    libelle: 'Détachement',
    delai: '45 jours',
    note: 'Arrêté conjoint Fonction publique et Finances ; avancement et droits à pension conservés.',
    pieces: ['DEMANDE_MANUSCRITE', 'CIP', 'ACTE_RECRUTEMENT', 'CERTIFICAT_PRISE_SERVICE', 'DERNIER_ACTE_CARRIERE', 'AVIS_SUPERIEUR', 'ACCORD_ACCUEIL'],
  },
  MUTATION: {
    libelle: 'Demande de mutation',
    delai: 'Prochaine note de service',
    pieces: ['DEMANDE_MANUSCRITE', 'CIP', 'DERNIER_ACTE_CARRIERE', 'ATTESTATION_PRESENCE', 'AVIS_SUPERIEUR', 'JUSTIFICATIF_MOTIF'],
  },
  PENSION: {
    libelle: 'Ayants droit et compte de paiement de la pension',
    delai: 'Transmis avec l\'acte de mise à la retraite',
    note: 'La liquidation de la pension est automatique depuis novembre 2020 : seules les informations nouvelles sont demandées.',
    pieces: ['ACTE_MARIAGE', 'ACTES_NAISSANCE_ENFANTS', 'RIB'],
  },
  RECLAMATION: {
    libelle: 'Réclamation (acte non pris en compte, erreur de situation)',
    delai: '15 jours',
    pieces: ['DEMANDE_MANUSCRITE', 'DERNIER_ACTE_CARRIERE'],
  },
};

// Résout chaque pièce d'une démarche pour un agent donné.
// dossier : { npi, statut, coffre: [types de pièces présentes et vérifiées] }
export function resoudrePieces(typeDemarche, dossier) {
  const demarche = DEMARCHES[typeDemarche];
  if (!demarche) throw new Error(`Démarche inconnue : ${typeDemarche}`);
  const lignes = demarche.pieces.map((type) => {
    const p = PIECES[type];
    let obtenue;
    switch (p.source) {
      case 'RNPP':
      case 'JUSTICE': obtenue = Boolean(dossier.npi); break;
      case 'COFFRE': obtenue = dossier.coffre.includes(type); break;
      case 'AGENT': obtenue = false; break;
      default: obtenue = true; // dossier individuel, solde, formulaire, circuit
    }
    return {
      type,
      libelle: p.libelle,
      source: obtenue ? p.source : 'AGENT',
      source_libelle: obtenue ? SOURCES[p.source] : SOURCES.AGENT,
      a_fournir: !obtenue,
    };
  });
  return {
    type: typeDemarche,
    libelle: demarche.libelle,
    delai: demarche.delai,
    note: demarche.note ?? null,
    ouverte: !demarche.statuts || demarche.statuts.includes(dossier.statut),
    pieces: lignes,
    total: lignes.length,
    evitees: lignes.filter((l) => !l.a_fournir).length,
  };
}
