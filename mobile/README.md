# Ma Carrière BJ : application Android (Flutter)

Application mobile native des agents et des évaluateurs, construite avec Flutter. Elle utilise la même
API que la plateforme web : un agent y retrouve son dossier, ses notifications, sa notation et ses
démarches, sans se déplacer.

> Prototype : données fictives, documents sans valeur juridique.

## Écrans

| Onglet | Ce que l'agent y fait |
| --- | --- |
| Connexion | NPI, matricule ou téléphone, avec mot de passe ; comptes de démonstration en un geste |
| Mon dossier | Situation (échelle, échelon, indice), prochain avancement, départ à la retraite, actes, carrière |
| Notifications | Messages de l'administration : droit détecté, acte signé, notation disponible |
| Notation | Sa fiche et, pour un évaluateur, celles de son équipe : auto-évaluation, notation avec aperçu de la note, visa ou recours |
| Démarches | Pièces que l'administration retrouve seule ; attestation de service délivrée immédiatement |

Les profils gestionnaire RH, DRH et administrateur gardent leurs écrans sur la plateforme web.

## Notation hors connexion

Chaque note cochée est gardée en brouillon sur le téléphone. Une fiche envoyée sans réseau attend sur
le téléphone et part seule au retour du réseau : au retour dans l'application, toutes les 30 secondes,
ou à la prochaine connexion du même compte. Seules les notes et le commentaire sont conservés, jamais
les données du dossier. Le jeton de session reste en mémoire : fermer l'application déconnecte.

## Construire l'APK

Prérequis : Flutter 3.47 ou plus récent, le SDK Android et Java 17 ou plus récent.

```bash
flutter pub get
```

```bash
flutter test
```

```bash
flutter build apk --release
```

L'APK est produit dans `build/app/outputs/flutter-apk/app-release.apk`.

## Adresse du serveur

Par défaut, l'application joint `http://10.0.2.2:3800`, c'est-à-dire la plateforme lancée avec
`npm start` sur l'ordinateur qui fait tourner l'émulateur Android. Sur un vrai téléphone, saisir
l'adresse de l'ordinateur sur le réseau local (par exemple `http://192.168.1.20:3800`) dans
« Adresse du serveur », sur l'écran de connexion. L'adresse peut aussi être fixée à la construction :

```bash
flutter build apk --release --dart-define=MCBJ_SERVEUR=https://macarriere.bj
```

## Limites du prototype

- APK signé avec la clé de débogage : une clé de l'État est nécessaire pour une diffusion officielle
  (Play Store ou distribution interne).
- Le trafic HTTP en clair est autorisé pour joindre un serveur local ; une version de production
  n'accepterait que HTTPS.
- Les démarches qui demandent des pièces jointes se déposent sur la plateforme web.
