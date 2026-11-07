import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api.dart';
import '../main.dart';

/// Connexion par NPI, matricule ou téléphone, avec mot de passe (comme la plateforme web).
class EcranConnexion extends StatefulWidget {
  const EcranConnexion({super.key, required this.api, required this.connecte});
  final Api api;
  final VoidCallback connecte;

  @override
  State<EcranConnexion> createState() => _EcranConnexionState();
}

class _EcranConnexionState extends State<EcranConnexion> {
  static const _types = {
    'npi': ('NPI', 'Numéro personnel d\'identification (NPI)', '10 chiffres'),
    'matricule': ('Matricule', 'Matricule', 'Votre matricule'),
    'telephone': ('Téléphone', 'Numéro de téléphone', '01 XX XX XX XX'),
  };
  String _type = 'npi';
  final _identifiant = TextEditingController();
  final _motDePasse = TextEditingController();
  late final _serveur = TextEditingController(text: widget.api.serveur);
  bool _masquer = true;
  bool _envoi = false;
  String? _erreur;

  String? _probleme() {
    final id = _identifiant.text.trim();
    final chiffres = id.replaceAll(RegExp(r'\D'), '');
    if (id.isEmpty) return 'Saisissez votre ${_types[_type]!.$1 == 'NPI' ? 'NPI' : _types[_type]!.$2.toLowerCase()}.';
    if (_type == 'npi' && !RegExp(r'^\d{10}$').hasMatch(id)) return 'Le NPI comporte 10 chiffres.';
    if (_type == 'telephone' && chiffres.length != 10) return 'Le numéro comporte 10 chiffres : 01 XX XX XX XX.';
    if (_motDePasse.text.isEmpty) return 'Saisissez votre mot de passe.';
    return null;
  }

  Future<void> _connecter() async {
    final probleme = _probleme();
    if (probleme != null) return setState(() => _erreur = probleme);
    setState(() {
      _envoi = true;
      _erreur = null;
    });
    try {
      await widget.api.connecter(_type, _identifiant.text.trim(), _motDePasse.text);
      widget.connecte();
    } on Exception catch (e) {
      _motDePasse.clear();
      setState(() {
        _erreur = e.toString();
        _envoi = false;
      });
    }
  }

  void _demo(String npi) {
    setState(() {
      _type = 'npi';
      _identifiant.text = npi;
      _motDePasse.text = 'MaCarriere@2026';
    });
    _connecter();
  }

  Future<void> _enregistrerServeur() async {
    final adresse = _serveur.text.trim();
    if (!adresse.startsWith('http')) return setState(() => _erreur = 'Adresse du serveur : commencez par http:// ou https://');
    widget.api.serveur = adresse;
    await (await SharedPreferences.getInstance()).setString('serveur', adresse);
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Adresse du serveur enregistrée.')));
  }

  @override
  Widget build(BuildContext context) {
    final t = _types[_type]!;
    return Scaffold(
      body: SafeArea(
        child: ListView(children: [
          const Drapeau(),
          Container(
            color: vert,
            padding: const EdgeInsets.fromLTRB(24, 28, 24, 28),
            child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                _LogoBlanc(),
                SizedBox(width: 12),
                Text('Ma Carrière BJ', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
              ]),
              SizedBox(height: 20),
              Text('TOUS LES AGENTS DE L\'ÉTAT', style: TextStyle(color: jaune, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 1)),
              SizedBox(height: 6),
              Text('Votre carrière, suivie sans déplacement',
                  style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w700, height: 1.2)),
            ]),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              const Text('Connexion à votre espace', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: 16),
              SegmentedButton<String>(
                segments: [for (final e in _types.entries) ButtonSegment(value: e.key, label: Text(e.value.$1))],
                selected: {_type},
                showSelectedIcon: false,
                onSelectionChanged: (s) => setState(() {
                  _type = s.first;
                  _identifiant.clear();
                  _erreur = null;
                }),
              ),
              const SizedBox(height: 16),
              TextField(
                key: const Key('identifiant'),
                controller: _identifiant,
                keyboardType: _type == 'matricule' ? TextInputType.text : TextInputType.number,
                inputFormatters: _type == 'npi' ? [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)] : null,
                decoration: InputDecoration(labelText: t.$2, hintText: t.$3, border: const OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('mot-de-passe'),
                controller: _motDePasse,
                obscureText: _masquer,
                onSubmitted: (_) => _connecter(),
                decoration: InputDecoration(
                  labelText: 'Mot de passe',
                  border: const OutlineInputBorder(),
                  suffixIcon: TextButton(onPressed: () => setState(() => _masquer = !_masquer), child: Text(_masquer ? 'Afficher' : 'Masquer')),
                ),
              ),
              if (_erreur != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(_erreur!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _envoi ? null : _connecter,
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
                child: Text(_envoi ? 'Connexion…' : 'Se connecter'),
              ),
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: const Color(0xFFFFF8E1), border: Border(left: BorderSide(color: jaune, width: 4))),
                child: const Text('Ne communiquez jamais votre mot de passe, même à un agent de l\'administration.', style: TextStyle(fontSize: 13)),
              ),
              const SizedBox(height: 8),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('Comptes de démonstration'),
                children: [
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Agent : Afiavi HOUNKPATIN'),
                    subtitle: const Text('Institutrice adjointe (ACDPE)'),
                    trailing: const Icon(Icons.login),
                    onTap: () => _demo('2087345611'),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Évaluateur : Comlan DOSSOU'),
                    subtitle: const Text('Directeur d\'école'),
                    trailing: const Icon(Icons.login),
                    onTap: () => _demo('1984221307'),
                  ),
                ],
              ),
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('Adresse du serveur'),
                children: [
                  TextField(
                    controller: _serveur,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(border: OutlineInputBorder(), helperText: 'Démo en ligne : https://ma-carriere-bj.vercel.app\nÉmulateur et npm start : http://10.0.2.2:3800', helperMaxLines: 2),
                  ),
                  const SizedBox(height: 8),
                  Align(alignment: Alignment.centerRight, child: OutlinedButton(onPressed: _enregistrerServeur, child: const Text('Enregistrer'))),
                ],
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _LogoBlanc extends StatelessWidget {
  const _LogoBlanc();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 40,
      height: 40,
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(9)),
      alignment: Alignment.center,
      child: const Text('MC', style: TextStyle(color: vert, fontWeight: FontWeight.w800, fontSize: 15)),
    );
  }
}
