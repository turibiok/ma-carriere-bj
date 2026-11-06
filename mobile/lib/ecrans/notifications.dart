import 'package:flutter/material.dart';

import '../api.dart';
import '../main.dart';
import 'commun.dart';

/// L'administration informe l'agent à chaque étape, sans qu'il ait à se renseigner.
class EcranNotifications extends StatelessWidget {
  const EcranNotifications({super.key, required this.api, required this.lues});
  final Api api;
  final VoidCallback lues;

  Future<List> _charger() async {
    final liste = await api.get('/api/notifications') as List;
    if (liste.any((n) => n['lu'] == 0)) {
      await api.post('/api/notifications/lues');
      lues();
    }
    return liste;
  }

  @override
  Widget build(BuildContext context) {
    return Chargement<List>(
      charger: _charger,
      construire: (context, liste, _) => ListView(padding: const EdgeInsets.all(16), children: [
        const Text('L\'administration vous informe à chaque étape. En production, chaque message part aussi par SMS.',
            style: TextStyle(color: Color(0xFF5B6B7B))),
        const SizedBox(height: 12),
        if (liste.isEmpty)
          const Carte(enfants: [Text('Aucune notification pour le moment.')]),
        for (final n in liste) ...[
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: Color(0xFFDDE3E9))),
            child: Container(
              decoration: const BoxDecoration(border: Border(left: BorderSide(color: vert, width: 4))),
              padding: const EdgeInsets.all(14),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text('${n['titre']}', style: const TextStyle(fontWeight: FontWeight.w700))),
                  if (n['lu'] == 0) const Etiquette('Nouveau', couleur: Color(0xFFA15C00), fond: Color(0xFFFDF1DF)),
                ]),
                const SizedBox(height: 4),
                Text('${n['message']}'),
                const SizedBox(height: 6),
                Text('${dateFr(n['horodatage'])} ${'${n['horodatage']}'.length >= 16 ? '${n['horodatage']}'.substring(11, 16) : ''}',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF5B6B7B))),
              ]),
            ),
          ),
          const SizedBox(height: 10),
        ],
      ]),
    );
  }
}
