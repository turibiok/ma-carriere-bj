import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'ecrans/accueil.dart';
import 'ecrans/connexion.dart';

/// Couleurs nationales : vert, jaune, rouge du drapeau.
const vert = Color(0xFF008751);
const vertFonce = Color(0xFF006B40);
const jaune = Color(0xFFFCD116);
const rouge = Color(0xFFE8112D);

/// Adresse du serveur par défaut : celle de l'ordinateur hôte vu depuis l'émulateur Android.
/// À la construction : --dart-define=MCBJ_SERVEUR=https://macarriere.bj
const serveurParDefaut = String.fromEnvironment('MCBJ_SERVEUR', defaultValue: 'http://10.0.2.2:3800');

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final prefs = await SharedPreferences.getInstance();
  runApp(MaCarriereApp(api: Api(prefs.getString('serveur') ?? serveurParDefaut)));
}

class MaCarriereApp extends StatefulWidget {
  const MaCarriereApp({super.key, required this.api});
  final Api api;

  @override
  State<MaCarriereApp> createState() => _MaCarriereAppState();
}

class _MaCarriereAppState extends State<MaCarriereApp> {
  final _messager = GlobalKey<ScaffoldMessengerState>();

  @override
  void initState() {
    super.initState();
    widget.api.sessionExpiree = () {
      setState(() {});
      _messager.currentState?.showSnackBar(const SnackBar(content: Text('Session expirée : reconnectez-vous.')));
    };
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Ma Carrière BJ',
      debugShowCheckedModeBanner: false,
      scaffoldMessengerKey: _messager,
      locale: const Locale('fr'),
      supportedLocales: const [Locale('fr')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: vert, primary: vert),
        scaffoldBackgroundColor: const Color(0xFFF4F6F8),
        appBarTheme: const AppBarTheme(backgroundColor: Colors.white, surfaceTintColor: Colors.white),
        cardTheme: const CardThemeData(color: Colors.white, surfaceTintColor: Colors.white, margin: EdgeInsets.zero),
      ),
      home: widget.api.jeton == null
          ? EcranConnexion(api: widget.api, connecte: () => setState(() {}))
          : EcranAccueil(api: widget.api, deconnecte: () => setState(() {})),
    );
  }
}

/// Bandeau aux couleurs du drapeau et mention du prototype, en tête de chaque écran.
class Drapeau extends StatelessWidget {
  const Drapeau({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(mainAxisSize: MainAxisSize.min, children: [
      const Row(children: [
        Expanded(child: SizedBox(height: 4, child: ColoredBox(color: vert))),
        Expanded(child: SizedBox(height: 4, child: ColoredBox(color: jaune))),
        Expanded(child: SizedBox(height: 4, child: ColoredBox(color: rouge))),
      ]),
      Container(
        width: double.infinity,
        color: const Color(0xFF263646),
        padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 8),
        child: const Text('Prototype : données fictives, documents sans valeur juridique',
            textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 11)),
      ),
    ]);
  }
}

/// Logo « MC » de la plateforme.
class Logo extends StatelessWidget {
  const Logo({super.key, this.taille = 40});
  final double taille;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: taille,
      height: taille,
      decoration: BoxDecoration(color: vert, borderRadius: BorderRadius.circular(taille * .22)),
      alignment: Alignment.center,
      child: Text('MC', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: taille * .38)),
    );
  }
}

/// Date ISO (2026-10-31) au format français (31/10/2026).
String dateFr(Object? iso) {
  final t = iso?.toString() ?? '';
  if (t.length < 10) return '-';
  final p = t.substring(0, 10).split('-');
  return '${p[2]}/${p[1]}/${p[0]}';
}
