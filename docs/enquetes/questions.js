// Questions des deux enquêtes. Chaque question renvoie à une colonne de la base (champ `col`).
// Les deux enquêtes partagent le tronc commun ; seules les questions propres au métier changent.
(() => {
  const ouiNon = [['oui', 'Oui'], ['non', 'Non']];
  const ouiNonNsp = [['oui', 'Oui'], ['non', 'Non'], ['nsp', 'Je ne sais pas']];
  const fois = [['0', '0'], ['1', '1 fois'], ['2', '2 fois'], ['3', '3 fois ou plus']];
  const employeur = { type: 'choix', col: 'employeur', texte: 'Votre employeur :', options: [['etat', 'L\'État'], ['commune', 'Une commune'], ['nsp', 'Je ne sais pas']] };
  const memeVille = { type: 'choix', col: 'meme_ville', texte: 'Votre lieu d\'exercice est-il dans la même ville que votre service du personnel ?', options: ouiNon };

  const avancement = (qui) => ({ titre: 'Votre avancement', questions: [
    { type: 'choix', col: 'sans_demande', texte: 'Votre dernier avancement d\'échelon ou votre dernière augmentation a-t-il été accordé sans que vous le demandiez ?', options: ouiNonNsp },
    { type: 'choix', col: 'delai', requis: false, si: ['sans_demande', '=', 'non'], texte: 'Vous avez dû le réclamer : combien de temps après la date où il était dû l\'avez-vous obtenu ?',
      options: [['moins6', 'Moins de 6 mois'], ['6a12', '6 à 12 mois'], ['1a2ans', '1 à 2 ans'], ['plus2ans', 'Plus de 2 ans'], ['pasEncore', 'Pas encore obtenu']] },
    { type: 'choix', col: 'connait_date', texte: `Connaissez-vous la date de votre prochain avancement${qui} ?`, options: ouiNon },
  ] });

  const pieces = { type: 'pieces', texte: 'Au cours des deux dernières années, combien de fois avez-vous dû fournir ces pièces pour une démarche administrative ?',
    lignes: [['pieces_naissance', 'Acte de naissance'], ['pieces_diplomes', 'Diplômes'], ['pieces_prise_service', 'Certificat de prise de service'], ['pieces_arretes', 'Arrêtés ou contrats antérieurs']], options: fois };

  const deplacements = [
    { type: 'choix', col: 'deplacements', texte: 'Au cours de l\'année écoulée, combien de déplacements avez-vous faits pour une démarche de carrière (dépôt, retrait d\'attestation, suivi de dossier) ?',
      options: [['0', 'Aucun'], ['1', '1'], ['2-3', '2 à 3'], ['4+', '4 ou plus']] },
    { type: 'nombres', requis: false, si: ['deplacements', '!=', '0'], texte: 'Pour le dernier de ces déplacements :', champs: [
      { col: 'duree_h', label: 'Durée totale, en heures', min: 0, max: 200, step: 0.5 },
      { col: 'cout_f', label: 'Coût approximatif en FCFA (transport, légalisations, photocopies)', min: 0, max: 1000000, step: 100 }] },
  ];
  const attestation = { type: 'choix', col: 'attestation', texte: 'Combien de temps avez-vous attendu votre dernière attestation de présence ou de service ?',
    options: [['jour', 'Le jour même'], ['2a7', '2 à 7 jours'], ['plus7', 'Plus d\'une semaine'], ['jamaisObtenue', 'Jamais obtenue'], ['jamaisDemandee', 'Jamais demandée']] };
  const fiche = { type: 'choix', col: 'fiche', texte: 'Votre fiche de notation de l\'an dernier a-t-elle été remplie et vous a-t-elle été communiquée ?', options: ouiNonNsp };
  const fin = { titre: 'Pour finir', questions: [
    { type: 'choix', col: 'utiliserait', texte: 'Si une plateforme vous permettait de suivre votre carrière et vos démarches sur téléphone, l\'utiliseriez-vous ?',
      options: [['oui', 'Oui'], ['peutEtre', 'Peut-être'], ['non', 'Non']] },
    { type: 'texte', col: 'phrase', requis: false, max: 400, multiligne: true, texte: 'En une phrase : la démarche de carrière qui vous a fait perdre le plus de temps.',
      aide: 'Facultatif. N\'écrivez aucun nom, ni le vôtre ni celui d\'un collègue ou d\'un service. Cette phrase n\'est jamais publiée telle quelle.' },
  ] };

  window.ENQUETES = {
    sante: {
      nom: 'personnels de santé',
      blocs: [
        { titre: 'Votre emploi', questions: [
          { type: 'choix', col: 'metier', texte: 'Vous êtes :', options: [['medecin', 'Médecin'], ['sage-femme', 'Sage-femme'], ['infirmier', 'Infirmier ou infirmière'], ['aide-soignant', 'Aide-soignant(e)'], ['technicien', 'Technicien(ne) de santé'], ['autre', 'Autre']] },
          employeur,
          { type: 'choix', col: 'statut', texte: 'Votre statut :', options: [['fonctionnaire', 'Fonctionnaire'], ['acdpe', 'Contractuel de l\'État (ACDPE)'], ['autre', 'Autre contractuel'], ['retraite', 'Retraité(e)']] },
          memeVille,
        ] },
        avancement(''),
        { titre: 'Les pièces qu\'on vous redemande', questions: [
          pieces,
          { type: 'choix', col: 'transfert', texte: 'Si votre gestion est passée de l\'État à une commune : vous a-t-on redemandé des pièces déjà fournies ?', options: [['oui', 'Oui'], ['non', 'Non'], ['nc', 'Non concerné']] },
          { type: 'texte', col: 'transfert_lesquelles', requis: false, max: 200, si: ['transfert', '=', 'oui'], texte: 'Lesquelles ?' },
        ] },
        { titre: 'Vos déplacements et absences', questions: [
          ...deplacements,
          { type: 'choix', col: 'absence', texte: 'Pour une démarche administrative, avez-vous déjà dû quitter votre service ou faire remplacer une garde ?', options: ouiNon },
          { type: 'nombre', col: 'absences_nb', requis: false, si: ['absence', '=', 'oui'], texte: 'Combien de fois l\'an dernier ?', min: 0, max: 365, step: 1 },
          attestation,
        ] },
        { titre: 'La notation', questions: [
          fiche,
          { type: 'choix', col: 'responsable', texte: 'Notez-vous une équipe (médecin-chef, responsable de centre, major) ?', options: ouiNon },
          { type: 'nombre', col: 'heures_notation', requis: false, si: ['responsable', '=', 'oui'], texte: 'Combien d\'heures vous a pris la notation de votre équipe l\'an dernier ?', min: 0, max: 500, step: 0.5 },
        ] },
        fin,
      ],
    },
    enseignants: {
      nom: 'enseignants',
      blocs: [
        { titre: 'Votre emploi', questions: [
          { type: 'choix', col: 'metier', texte: 'Vous êtes :', options: [['primaire', 'Enseignant(e) du primaire'], ['secondaire', 'Enseignant(e) du secondaire'], ['technique', 'Enseignant(e) du technique'], ['directeur', 'Directeur d\'école ou chef d\'établissement'], ['autre', 'Autre']] },
          employeur,
          { type: 'choix', col: 'statut', texte: 'Votre statut :', options: [['fonctionnaire', 'Fonctionnaire'], ['acdpe', 'Contractuel de l\'État (ACDPE)'], ['ame', 'Aspirant au métier d\'enseignant (AME)'], ['autre', 'Autre contractuel'], ['retraite', 'Retraité(e)']] },
          memeVille,
        ] },
        avancement(''),
        { titre: 'Les pièces qu\'on vous redemande', questions: [pieces] },
        { titre: 'Vos déplacements et absences', questions: [
          ...deplacements,
          { type: 'choix', col: 'absence', texte: 'Pour une attestation ou un dossier, avez-vous déjà dû vous absenter de votre classe ?', options: ouiNon },
          { type: 'nombre', col: 'absences_nb', requis: false, si: ['absence', '=', 'oui'], texte: 'Combien de demi-journées l\'an dernier ?', min: 0, max: 365, step: 1 },
          attestation,
          { type: 'choix', col: 'mutation', texte: 'Avez-vous déjà demandé une mutation ?', options: [['suivie', 'Oui, et j\'ai pu suivre l\'examen de ma demande'], ['nonSuivie', 'Oui, sans pouvoir suivre l\'examen'], ['jamais', 'Non, jamais']] },
        ] },
        { titre: 'La notation', questions: [
          fiche,
          { type: 'choix', col: 'responsable', texte: 'Notez-vous une équipe (directeur, chef d\'établissement, censeur) ?', options: ouiNon },
          { type: 'nombre', col: 'heures_notation', requis: false, si: ['responsable', '=', 'oui'], texte: 'Combien d\'heures vous a pris la notation de votre équipe l\'an dernier ?', min: 0, max: 500, step: 0.5 },
        ] },
        fin,
      ],
    },
  };
})();
