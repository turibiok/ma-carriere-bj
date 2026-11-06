import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:ma_carriere_bj/api.dart';
import 'package:ma_carriere_bj/attente.dart';
import 'package:ma_carriere_bj/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Faux serveur reprenant les réponses de l'API de Ma Carrière BJ (données fictives).
class FauxServeur {
  bool enLigne = true;
  final recus = <String>[];
  String statutFiche = 'OBJECTIFS_FIXES';

  static const criteres = ['obj1', 'metier', 'assiduite', 'usagers'];

  late final client = MockClient((req) async {
    if (!enLigne) throw http.ClientException('Réseau indisponible');
    final chemin = req.url.path;
    recus.add('${req.method} $chemin');
    Object? corps;
    if (chemin == '/api/connexion') {
      corps = {
        'jeton': 'jeton-test',
        'utilisateur': {'id': 'agent', 'nom': 'Afiavi HOUNKPATIN', 'role': 'agent', 'agent_id': 2, 'matricule': 'C208842'},
      };
    } else if (chemin == '/api/notifications') {
      corps = [
        {'id': 1, 'horodatage': '2026-10-31T08:00:00', 'titre': 'Augmentation biennale détectée', 'message': 'Vous n\'avez aucune démarche à faire.', 'lu': 0},
      ];
    } else if (chemin == '/api/evaluations') {
      corps = [
        {'id': 291, 'annee': 2026, 'statut': statutFiche, 'note_finale': null, 'agent_id': 2, 'nom': 'HOUNKPATIN', 'prenoms': 'Afiavi', 'corps': 'Instituteur adjoint'},
      ];
    } else if (chemin == '/api/evaluations/291') {
      corps = {
        'id': 291, 'agent_id': 2, 'superieur_id': 1, 'annee': 2026, 'statut': statutFiche, 'nom': 'HOUNKPATIN', 'prenoms': 'Afiavi',
        'corps': 'Instituteur adjoint', 'structure': 'EPP Godomey Centre', 'note_finale': null, 'mention': null,
        'fiche': {
          'rubriques': [
            {'code': 'competence', 'libelle': 'Compétence', 'criteres': [for (final c in criteres.take(2)) {'code': c, 'libelle': 'Critère $c', 'auto': null, 'note': null}]},
            {'code': 'conscience', 'libelle': 'Conscience professionnelle', 'criteres': [{'code': 'assiduite', 'libelle': 'Assiduité', 'auto': null, 'note': null}]},
            {'code': 'service', 'libelle': 'Sens du service public', 'criteres': [{'code': 'usagers', 'libelle': 'Usagers', 'auto': null, 'note': null}]},
          ],
        },
        'ponderation': {'competence': 40, 'conscience': 30, 'service': 30},
        'rapport_special': {'sous': 12, 'des': 18},
      };
    } else if (chemin == '/api/evaluations/291/auto') {
      statutFiche = 'AUTO_EVALUEE';
      corps = {'ok': true, 'note_finale': null};
    } else if (chemin.startsWith('/api/agents/')) {
      corps = {
        'agent': {'nom': 'HOUNKPATIN', 'prenoms': 'Afiavi', 'statut': 'ACDPE', 'corps': 'Instituteur adjoint', 'matricule': 'C208842',
          'structure': 'EPP Godomey Centre', 'superieur': 'Comlan DOSSOU', 'libelle_echelle': 'CC1', 'echelon': 3, 'indice': 326,
          'date_prise_service': '2017-08-31', 'prochain_echelon': '2023-08-31', 'date_retraite': '2047-06-30', 'age_retraite': 55},
        'historique': [{'date_effet': '2021-08-31', 'libelle': 'Avenant : palier 3'}],
        'actes': [],
      };
    } else {
      corps = {'ok': true};
    }
    return http.Response.bytes(utf8.encode(jsonEncode(corps)), 200, headers: {'content-type': 'application/json'});
  });
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('connexion, puis auto-évaluation hors connexion transmise au retour du réseau', (tester) async {
    final serveur = FauxServeur();
    final api = Api('http://serveur-test', client: serveur.client);
    await tester.pumpWidget(MaCarriereApp(api: api));

    // Connexion par NPI : contrôle du format avant tout appel.
    await tester.enterText(find.byKey(const Key('identifiant')), '2087');
    await tester.enterText(find.byKey(const Key('mot-de-passe')), 'MaCarriere@2026');
    await tester.tap(find.text('Se connecter'));
    await tester.pump();
    expect(find.text('Le NPI comporte 10 chiffres.'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('identifiant')), '2087345611');
    await tester.enterText(find.byKey(const Key('mot-de-passe')), 'MaCarriere@2026');
    await tester.tap(find.text('Se connecter'));
    await tester.pumpAndSettle();
    expect(find.text('Mon dossier'), findsWidgets);
    expect(find.textContaining('CC1, palier 3'), findsOneWidget);

    // Onglet Notation, puis la fiche.
    await tester.tap(find.text('Notation').last);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'Afiavi HOUNKPATIN'));
    await tester.pumpAndSettle();
    expect(find.text('Fiche de notation'), findsOneWidget);
    // La liste de la fiche (et non le champ de commentaire, qui défile aussi).
    final fiche = find.byType(Scrollable).first;

    // Envoi incomplet : les éléments manquants sont signalés.
    await tester.scrollUntilVisible(find.byKey(const Key('envoyer')), 200, scrollable: fiche);
    expect(find.text('Transmettre mon auto-évaluation'), findsOneWidget);
    await tester.tap(find.byKey(const Key('envoyer')));
    await tester.pump();
    expect(find.textContaining('4 élément(s) à noter'), findsOneWidget);

    // Retour en haut de la fiche, puis une note par élément.
    await tester.drag(fiche, const Offset(0, 5000));
    await tester.pumpAndSettle();
    for (final c in FauxServeur.criteres) {
      final puce = find.byKey(Key('note-$c-4'));
      await tester.scrollUntilVisible(puce, 100, scrollable: fiche);
      await tester.tap(puce);
      await tester.pump();
    }
    expect((await Attente.brouillon('agent', 291, 'auto'))!['notes'], {'obj1': 4, 'metier': 4, 'assiduite': 4, 'usagers': 4});

    // Plus de réseau : la saisie attend sur le téléphone.
    serveur.enLigne = false;
    await tester.scrollUntilVisible(find.byKey(const Key('envoyer')), 200, scrollable: fiche);
    await tester.tap(find.byKey(const Key('envoyer')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('en-attente')), findsOneWidget);
    expect((await Attente.file()).length, 1);
    expect(serveur.statutFiche, 'OBJECTIFS_FIXES');

    // Retour du réseau : envoi automatique, file vidée, brouillon effacé.
    serveur.enLigne = true;
    final r = await Attente.envoyer(api);
    expect(r.envoyees, 1);
    expect(serveur.statutFiche, 'AUTO_EVALUEE');
    expect(await Attente.file(), isEmpty);
    expect(await Attente.brouillon('agent', 291, 'auto'), isNull);
  });

  test('une saisie en attente ne part qu\'avec le compte qui l\'a faite', () async {
    final serveur = FauxServeur();
    final api = Api('http://serveur-test', client: serveur.client)
      ..jeton = 'jeton-test'
      ..utilisateur = {'id': 'evaluateur', 'agent_id': 1};
    await Attente.ajouter('agent', 291, 'auto', {'notes': {'obj1': 4}, 'commentaire': ''});
    final r = await Attente.envoyer(api);
    expect(r.envoyees, 0);
    expect((await Attente.file()).length, 1);
    expect(serveur.recus, isEmpty);
  });
}
