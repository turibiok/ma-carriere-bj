import 'package:flutter/material.dart';

import '../api.dart';

/// Charge des données depuis l'API, avec chargement, erreur (hors ligne ou refus) et tirer pour actualiser.
class Chargement<T> extends StatefulWidget {
  const Chargement({super.key, required this.charger, required this.construire});
  final Future<T> Function() charger;
  final Widget Function(BuildContext context, T donnees, Future<void> Function() actualiser) construire;

  @override
  State<Chargement<T>> createState() => _ChargementState<T>();
}

class _ChargementState<T> extends State<Chargement<T>> {
  late Future<T> _futur = widget.charger();

  Future<void> _actualiser() async {
    final f = widget.charger();
    setState(() => _futur = f);
    try {
      await f;
    } on Exception {
      // L'erreur est affichée par le FutureBuilder.
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<T>(
      future: _futur,
      builder: (context, s) {
        if (s.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (s.hasError) {
          final horsLigne = s.error is HorsLigne;
          return RefreshIndicator(
            onRefresh: _actualiser,
            child: ListView(padding: const EdgeInsets.all(32), children: [
              Icon(horsLigne ? Icons.wifi_off : Icons.error_outline, size: 48, color: const Color(0xFF5B6B7B)),
              const SizedBox(height: 12),
              Text(horsLigne ? 'Vous êtes hors connexion.' : '${s.error}',
                  textAlign: TextAlign.center, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Text(horsLigne ? 'Tirez vers le bas pour réessayer dès le retour du réseau.' : 'Tirez vers le bas pour réessayer.',
                  textAlign: TextAlign.center),
            ]),
          );
        }
        return RefreshIndicator(onRefresh: _actualiser, child: widget.construire(context, s.data as T, _actualiser));
      },
    );
  }
}

/// Carte avec un titre, comme sur la plateforme web.
class Carte extends StatelessWidget {
  const Carte({super.key, this.titre, required this.enfants});
  final String? titre;
  final List<Widget> enfants;

  @override
  Widget build(BuildContext context) {
    return Card(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: Color(0xFFDDE3E9))),
      elevation: 0,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (titre != null) ...[Text(titre!, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)), const SizedBox(height: 10)],
          ...enfants,
        ]),
      ),
    );
  }
}

/// Ligne « libellé : valeur ».
class Ligne extends StatelessWidget {
  const Ligne(this.libelle, this.valeur, {super.key});
  final String libelle;
  final String valeur;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(width: 130, child: Text(libelle, style: const TextStyle(color: Color(0xFF5B6B7B)))),
        Expanded(child: Text(valeur, style: const TextStyle(fontWeight: FontWeight.w600))),
      ]),
    );
  }
}

/// Petite étiquette colorée.
class Etiquette extends StatelessWidget {
  const Etiquette(this.texte, {super.key, this.couleur = const Color(0xFF2457A6), this.fond = const Color(0xFFE8EEFA)});
  final String texte;
  final Color couleur;
  final Color fond;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(color: fond, borderRadius: BorderRadius.circular(99)),
      child: Text(texte, style: TextStyle(color: couleur, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}
