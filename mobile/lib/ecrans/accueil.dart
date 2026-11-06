import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../attente.dart';
import '../main.dart';
import 'demarches.dart';
import 'dossier.dart';
import 'notation.dart';
import 'notifications.dart';

/// Espace connecté : quatre onglets pour l'agent et l'évaluateur.
class EcranAccueil extends StatefulWidget {
  const EcranAccueil({super.key, required this.api, required this.deconnecte});
  final Api api;
  final VoidCallback deconnecte;

  @override
  State<EcranAccueil> createState() => _EcranAccueilState();
}

class _EcranAccueilState extends State<EcranAccueil> with WidgetsBindingObserver {
  int _onglet = 0;
  int _nonLues = 0;
  final Set<int> _visites = {0};
  Timer? _minuterie;

  static const _titres = ['Mon dossier', 'Notifications', 'Notation', 'Démarches'];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Saisies hors connexion : envoyées à l'ouverture, au retour dans l'application et régulièrement.
    _envoyerEnAttente();
    _minuterie = Timer.periodic(const Duration(seconds: 30), (_) => _envoyerEnAttente());
    _compterNonLues();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _minuterie?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState etat) {
    if (etat == AppLifecycleState.resumed) _envoyerEnAttente();
  }

  Future<void> _envoyerEnAttente() async {
    final r = await Attente.envoyer(widget.api);
    if (!mounted) return;
    final messager = ScaffoldMessenger.of(context);
    if (r.envoyees > 0) {
      messager.showSnackBar(SnackBar(content: Text('${r.envoyees} notation(s) saisie(s) hors connexion transmise(s).')));
      setState(() {});
    }
    for (final m in r.refus) {
      messager.showSnackBar(SnackBar(content: Text('Notation non transmise : $m'), backgroundColor: Theme.of(context).colorScheme.error));
    }
  }

  Future<void> _compterNonLues() async {
    try {
      final liste = await widget.api.get('/api/notifications') as List;
      if (mounted) setState(() => _nonLues = liste.where((n) => n['lu'] == 0).length);
    } on Exception {
      // Hors ligne : la pastille attendra.
    }
  }

  Future<void> _deconnecter() async {
    await widget.api.deconnecter();
    widget.deconnecte();
  }

  @override
  Widget build(BuildContext context) {
    final u = widget.api.utilisateur!;
    if (widget.api.agentId == null) return _ProfilWeb(nom: '${u['nom']}', deconnecter: _deconnecter);
    final ecrans = [
      EcranDossier(api: widget.api),
      EcranNotifications(api: widget.api, lues: () => setState(() => _nonLues = 0)),
      EcranNotation(api: widget.api),
      EcranDemarches(api: widget.api),
    ];
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 16,
        title: Row(children: [
          const Logo(taille: 32),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(_titres[_onglet], style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              Text('${u['nom']}', style: const TextStyle(fontSize: 12, color: Color(0xFF5B6B7B)), overflow: TextOverflow.ellipsis),
            ]),
          ),
        ]),
        actions: [IconButton(tooltip: 'Se déconnecter', icon: const Icon(Icons.logout), onPressed: _deconnecter)],
        bottom: const PreferredSize(preferredSize: Size.fromHeight(4), child: Drapeau()),
      ),
      // Un onglet n'est chargé qu'à sa première ouverture (les notifications ne sont pas lues à l'insu de l'agent).
      body: IndexedStack(index: _onglet, children: [for (var i = 0; i < ecrans.length; i++) _visites.contains(i) ? ecrans[i] : const SizedBox()]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _onglet,
        onDestinationSelected: (i) => setState(() {
          _onglet = i;
          _visites.add(i);
        }),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.badge_outlined), selectedIcon: Icon(Icons.badge), label: 'Dossier'),
          NavigationDestination(
            icon: Badge(isLabelVisible: _nonLues > 0, label: Text('$_nonLues'), child: const Icon(Icons.notifications_outlined)),
            selectedIcon: const Icon(Icons.notifications),
            label: 'Notifications',
          ),
          const NavigationDestination(icon: Icon(Icons.fact_check_outlined), selectedIcon: Icon(Icons.fact_check), label: 'Notation'),
          const NavigationDestination(icon: Icon(Icons.description_outlined), selectedIcon: Icon(Icons.description), label: 'Démarches'),
        ],
      ),
    );
  }
}

/// Gestionnaire RH, DRH, administrateur : leurs écrans restent sur la plateforme web.
class _ProfilWeb extends StatelessWidget {
  const _ProfilWeb({required this.nom, required this.deconnecter});
  final String nom;
  final VoidCallback deconnecter;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(children: [
          const Drapeau(),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                const Logo(taille: 56),
                const SizedBox(height: 16),
                Text('Bonjour, $nom', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700), textAlign: TextAlign.center),
                const SizedBox(height: 8),
                const Text(
                  'L\'application mobile est destinée aux agents et aux évaluateurs. '
                  'L\'instruction des propositions, la signature des actes et les règles se font sur la plateforme web macarriere.bj.',
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 20),
                OutlinedButton(onPressed: deconnecter, child: const Text('Se déconnecter')),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
