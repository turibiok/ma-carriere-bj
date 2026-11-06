import 'package:flutter/material.dart';

import '../api.dart';
import '../main.dart';
import 'commun.dart';

/// Mon dossier : situation administrative, prochain avancement, carrière et actes.
class EcranDossier extends StatelessWidget {
  const EcranDossier({super.key, required this.api});
  final Api api;

  @override
  Widget build(BuildContext context) {
    return Chargement<Map<String, dynamic>>(
      charger: () async => Map<String, dynamic>.from(await api.get('/api/agents/${api.agentId}') as Map),
      construire: (context, d, _) {
        final a = d['agent'] as Map;
        final historique = d['historique'] as List;
        final actes = d['actes'] as List;
        final fonctionnaire = a['statut'] == 'APE';
        return ListView(padding: const EdgeInsets.all(16), children: [
          Carte(enfants: [
            Text('${a['prenoms']} ${a['nom']}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            Text('${a['corps']} · ${fonctionnaire ? 'Fonctionnaire' : 'Contractuel (ACDPE)'}', style: const TextStyle(color: Color(0xFF5B6B7B))),
            const SizedBox(height: 10),
            Ligne('Matricule', '${a['matricule']}'),
            Ligne('Affectation', '${a['structure']}'),
            Ligne('Supérieur', '${a['superieur'] ?? '-'}'),
          ]),
          const SizedBox(height: 12),
          Carte(titre: 'Ma situation', enfants: [
            Ligne(fonctionnaire ? 'Échelle, échelon' : 'Catégorie, palier', '${a['libelle_echelle']}, ${fonctionnaire ? 'échelon' : 'palier'} ${a['echelon']}'),
            if (a['grade'] != null) Ligne('Grade', '${a['grade']}'),
            Ligne('Indice', '${a['indice']}'),
            Ligne('Prise de service', dateFr(a['date_prise_service'])),
            Ligne('Prochain avancement', a['prochain_echelon'] == null ? 'Échelon maximal atteint' : dateFr(a['prochain_echelon'])),
            Ligne('Départ à la retraite', '${dateFr(a['date_retraite'])} (${a['age_retraite']} ans)'),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(color: const Color(0xFFE6F4ED), borderRadius: BorderRadius.circular(8)),
              child: const Text('Vos avancements sont détectés d\'office : vous êtes prévenu, sans rien demander.',
                  style: TextStyle(color: vertFonce, fontSize: 13)),
            ),
          ]),
          const SizedBox(height: 12),
          Carte(titre: 'Mes actes', enfants: [
            if (actes.isEmpty) const Text('Aucun acte pour le moment.', style: TextStyle(color: Color(0xFF5B6B7B))),
            for (final t in actes)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.verified_outlined, color: vert),
                title: Text('${t['objet']}'),
                subtitle: Text('N° ${t['numero']} · ${dateFr(t['date_signature'])}'),
              ),
          ]),
          const SizedBox(height: 12),
          Carte(titre: 'Ma carrière', enfants: [
            for (final h in historique)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SizedBox(width: 92, child: Text(dateFr(h['date_effet']), style: const TextStyle(color: Color(0xFF5B6B7B)))),
                  Expanded(child: Text('${h['libelle']}')),
                ]),
              ),
          ]),
        ]);
      },
    );
  }
}
