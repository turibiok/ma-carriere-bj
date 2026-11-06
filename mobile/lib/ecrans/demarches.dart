import 'package:flutter/material.dart';

import '../api.dart';
import '../main.dart';
import 'commun.dart';

/// « Dites-le-nous une fois » : pour chaque démarche, les pièces que l'administration retrouve seule.
class EcranDemarches extends StatelessWidget {
  const EcranDemarches({super.key, required this.api});
  final Api api;

  Future<void> _attestation(BuildContext context, Future<void> Function() actualiser) async {
    final messager = ScaffoldMessenger.of(context);
    try {
      final r = await api.post('/api/demandes', {'type': 'ATTESTATION_SERVICE', 'motif': 'Demande depuis l\'application mobile'});
      messager.showSnackBar(SnackBar(content: Text('${r['reponse']} délivrée : elle figure dans « Mes actes ».')));
      await actualiser();
    } on Exception catch (e) {
      messager.showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Chargement<List>(
      charger: () async => await api.get('/api/demarches') as List,
      construire: (context, liste, actualiser) {
        final total = liste.fold<int>(0, (s, d) => s + (d['total'] as int));
        final evitees = liste.fold<int>(0, (s, d) => s + (d['evitees'] as int));
        return ListView(padding: const EdgeInsets.all(16), children: [
          Text('L\'administration retrouve elle-même $evitees des $total pièces exigées par ces démarches.',
              style: const TextStyle(color: Color(0xFF5B6B7B))),
          const SizedBox(height: 12),
          for (final d in liste) ...[
            Carte(titre: '${d['libelle']}', enfants: [
              Text('Délai : ${d['delai']}', style: const TextStyle(color: Color(0xFF5B6B7B), fontSize: 13)),
              const SizedBox(height: 6),
              Text('${d['evitees']} pièce(s) sur ${d['total']} obtenue(s) sans vous',
                  style: const TextStyle(color: vertFonce, fontWeight: FontWeight.w600)),
              Theme(
                data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                child: ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: const Text('Voir les pièces et leur source', style: TextStyle(fontSize: 13)),
                  children: [
                    for (final p in d['pieces'] as List)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(p['a_fournir'] == true ? Icons.upload_file : Icons.check_circle, color: p['a_fournir'] == true ? const Color(0xFFA15C00) : vert),
                        title: Text('${p['libelle']}'),
                        subtitle: Text(p['a_fournir'] == true ? 'À fournir par vous' : '${p['source_libelle']}'),
                      ),
                  ],
                ),
              ),
              if (d['ouverte'] != true)
                const Etiquette('Non ouverte à votre statut', couleur: Color(0xFF5B6B7B), fond: Color(0xFFEEF1F4))
              else if (d['type'] == 'ATTESTATION_SERVICE')
                FilledButton.icon(
                  key: const Key('attestation'),
                  onPressed: () => _attestation(context, actualiser),
                  icon: const Icon(Icons.bolt),
                  label: const Text('Obtenir mon attestation maintenant'),
                )
              else
                const Text('À déposer sur la plateforme web, qui reçoit les pièces jointes.', style: TextStyle(fontSize: 13, color: Color(0xFF5B6B7B))),
            ]),
            const SizedBox(height: 12),
          ],
        ]);
      },
    );
  }
}
