# Ma Carrière BJ — prototype

**Ma Carrière BJ** (adresse prévue : macarriere.bj) est une plateforme de gestion automatique des carrières de tous les agents de l'État
du Bénin, quel que soit leur secteur : moteur de règles, notation annuelle des
fonctionnaires et des ACDPE, circuit de validation des actes, et démarches sans
pièces redondantes (« dites-le nous une fois »).

> Les données de démonstration couvrent cinq secteurs (santé, enseignement, finances, justice,
> agriculture) ; la liste des 15 secteurs proposés à l'inscription est un référentiel modifiable.
> Toutes les données sont fictives (noms, matricules, NPI, grille indiciaire).
> Les actes générés portent la mention « document de démonstration ».

## Lancer

Node.js 22.13 ou plus récent suffit : aucune dépendance à installer (SQLite est intégré à Node).

```bash
npm start
```

Puis ouvrir http://localhost:3800 et se connecter (voir les comptes ci-dessous).

```bash
npm test
```

```bash
npm run reset
```

`npm run reset` recharge les données de démonstration.

## Connexion

La page de connexion propose trois identifiants au choix — **NPI**, **matricule** ou
**téléphone** (10 chiffres, avec ou sans +229) — avec un **mot de passe**. Mots de passe
hachés (scrypt), session de 8 heures limitée à l'onglet, blocage de 15 minutes après
5 échecs, même message d'erreur pour un identifiant inconnu et un mauvais mot de passe.

### Comptes de démonstration

Mot de passe commun à tous les comptes : `MaCarriere@2026`. La page de connexion propose
aussi ces comptes en un clic (encadré « Comptes de démonstration », masqué avec `MODE_DEMO=0`).

| Profil | Nom | Identifiant |
| --- | --- | --- |
| Agent (ACDPE) | Afiavi HOUNKPATIN | NPI 2087345611 |
| Évaluateur | Comlan DOSSOU | NPI 1984221307 |
| Gestionnaire RH | Service du personnel | Matricule RH-0001 |
| DRH | Directeur des ressources humaines | Matricule DRH-0001 |
| Administrateur | Administrateur | Matricule ADM-0001 |

Chacun des 50 agents fictifs a aussi un compte (matricule, NPI ou téléphone de son dossier,
même mot de passe) ; les chefs de structure ont le profil évaluateur.

## Inscription en ligne

Un agent sans compte clique sur « Créer mon compte » et suit quatre étapes :

1. **Secteur** : choix parmi les 15 secteurs de l'administration.
2. **Identité et emploi** : NPI, nom, prénoms, date de naissance, téléphone, matricule, statut,
   ministère, structure d'affectation, emploi.
3. **Justificatifs d'emploi public** : acte d'engagement (arrêté ou contrat), dernier bulletin de
   solde et attestation de présence au poste (obligatoires), carte professionnelle (facultative).
   PDF, JPEG ou PNG, 2 Mo au plus ; le type réel est vérifié dans le contenu du fichier.
4. **Mot de passe et envoi** : 10 caractères au moins, lettres et chiffres ; déclarations sur l'honneur.

La demande reçoit un numéro (INS-AAAA-NNNNN), suivi en ligne avec le NPI. Le gestionnaire RH ou le
DRH la vérifie dans « Inscriptions » : sept contrôles de rapprochement avec la base RH et lecture des
justificatifs. La validation n'est possible que si tous les contrôles sont vérifiés ; elle active le
compte et range les justificatifs dans le coffre-fort de l'agent.

**Cas de démonstration** : Rodrigue ZINSOU, contrôleur des impôts (secteur « Économie, finances et
budget »), a un dossier RH mais pas encore de compte : NPI `3011223344`, matricule `511788`,
né le 27/09/1973. Tout PDF ou image de moins de 2 Mo sert de justificatif.

## Scénario de démonstration (10 minutes)

1. **Gestionnaire RH** — Tableau de bord, puis « Lancer le moteur de règles » :
   le moteur analyse les 50 dossiers et propose avancements, avenants ACDPE,
   avancements de grade, titularisations, départs à la retraite et alertes.
2. **Propositions** — « Instruire » un avancement en retard (le rappel de solde est estimé).
3. **DRH** — onglet « À signer », « Signer l'acte » : l'acte est généré, la situation
   de l'agent mise à jour, l'historique complété. « Vérifier un acte » avec le code
   imprimé au bas de l'acte.
4. **Agent** (Afiavi HOUNKPATIN, ACDPE) — « Ma notation » : auto-évaluation.
5. **Évaluateur** (Comlan DOSSOU) — même fiche : notation. Une note inférieure à 12
   ou d'au moins 18 exige un rapport spécial.
6. **Agent** — viser la fiche ou former un recours ; **DRH** — saisir l'avis de la CAP.
7. **Agent** — « Mes démarches » : chaque démarche indique les pièces que
   l'administration retrouve seule ; l'attestation de service est délivrée immédiatement.
8. **Administrateur** — « Règles statutaires » : modifier un seuil puis relancer le moteur.

## Organisation du code

| Fichier | Rôle |
| --- | --- |
| `src/regles.mjs` | Moteur de règles (fonctions pures) et règles par défaut |
| `src/evaluation.mjs` | Fiche de notation : critères, circuit, calendrier |
| `src/pieces.mjs` | Catalogue des pièces, de leurs sources et des démarches |
| `src/services.mjs` | Traitements métier : moteur, signature des actes, notation, démarches |
| `src/api.mjs` | API HTTP et contrôle des droits par profil |
| `src/inscription.mjs`, `src/secteurs.mjs` | Inscription en ligne, justificatifs, rapprochement avec la base RH ; référentiel des secteurs |
| `src/auth.mjs`, `src/motdepasse.mjs` | Connexion, sessions, blocage après échecs, hachage des mots de passe |
| `src/db.mjs`, `src/seed.mjs` | Schéma SQLite et données de démonstration |
| `public/` | Interface web (HTML, CSS, JavaScript sans framework) |
| `tests/` | Tests du moteur et des circuits (`node --test`) |

## Règles appliquées

Les valeurs par défaut viennent de la loi n°2015-18 portant statut général de la
fonction publique, dans sa version votée en 2015. Elles sont toutes modifiables
dans « Règles statutaires » et restent à valider sur le texte consolidé
(lois 2017-43 et 2018-35) avec la DRH :

- échelon tous les 24 mois, automatique pour les fonctionnaires (art. 116-117) ;
- 5 grades de 4, 3, 3, 3 et 2 échelons (art. 88) ; avancement de grade avec une
  moyenne d'au moins 14/20 sur les 3 dernières notations (art. 123) ;
- ACDPE : augmentation biennale par avenant si la moyenne atteint 13/20 (art. 293),
  pas de titularisation (art. 269), positions d'activité et de détachement seulement (art. 286) ;
- stage d'au moins 12 mois avant titularisation (art. 108) ;
- limite d'âge : 60 ans pour la catégorie A, 58 ans pour la B, 55 ans pour la C et la D (art. 263) ;
- notation sur 20 en six classes, rapport spécial sous 12 ou à partir de 18 (art. 57).

## Limites du prototype

- Les SMS ne sont pas réellement envoyés : le code de réinitialisation du mot de passe s'affiche
  à l'écran (« SMS simulé »), seulement en mode démonstration ; pas de second facteur à la connexion.
- Mot de passe commun aux comptes de démonstration (chacun peut le changer depuis son compte).
- Interconnexions simulées (ANIP/RNPP, solde, casier judiciaire). Les pièces jointes, elles, sont
  réellement déposées, contrôlées (PDF, JPEG ou PNG, 2 Mo) et consultables.
- Grille indiciaire fictive ; le rappel de solde est une estimation indicative.
