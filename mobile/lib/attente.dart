import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

/// Notations saisies sans réseau : gardées sur le téléphone, envoyées au retour du réseau.
/// Seules les notes et le commentaire sont conservés, rattachés au compte qui les a saisis ;
/// les données du dossier ne sont jamais enregistrées sur le téléphone.
class Attente {
  static const _cleFile = 'mcbj-notations-en-attente';
  static String _cleBrouillon(String utilisateur, int evaluation, String action) =>
      'mcbj-brouillon-$utilisateur-$evaluation-$action';

  static Future<Map<String, dynamic>?> brouillon(String utilisateur, int evaluation, String action) async {
    final texte = (await SharedPreferences.getInstance()).getString(_cleBrouillon(utilisateur, evaluation, action));
    return texte == null ? null : Map<String, dynamic>.from(jsonDecode(texte) as Map);
  }

  static Future<void> garderBrouillon(
      String utilisateur, int evaluation, String action, Map<String, int> notes, String commentaire) async {
    await (await SharedPreferences.getInstance())
        .setString(_cleBrouillon(utilisateur, evaluation, action), jsonEncode({'notes': notes, 'commentaire': commentaire}));
  }

  static Future<void> effacerBrouillon(String utilisateur, int evaluation, String action) async {
    await (await SharedPreferences.getInstance()).remove(_cleBrouillon(utilisateur, evaluation, action));
  }

  static Future<List<Map<String, dynamic>>> file() async {
    final texte = (await SharedPreferences.getInstance()).getString(_cleFile);
    if (texte == null) return [];
    return (jsonDecode(texte) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  static Future<void> _ecrireFile(List<Map<String, dynamic>> file) async {
    final prefs = await SharedPreferences.getInstance();
    if (file.isEmpty) {
      await prefs.remove(_cleFile);
    } else {
      await prefs.setString(_cleFile, jsonEncode(file));
    }
  }

  static Future<bool> enAttente(String utilisateur, int evaluation) async =>
      (await file()).any((a) => a['utilisateur'] == utilisateur && a['evaluation'] == evaluation);

  static Future<void> ajouter(String utilisateur, int evaluation, String action, Map<String, dynamic> corps) async {
    final f = (await file()).where((a) => !(a['utilisateur'] == utilisateur && a['evaluation'] == evaluation)).toList()
      ..add({'utilisateur': utilisateur, 'evaluation': evaluation, 'action': action, 'corps': corps,
        'le': DateTime.now().toIso8601String()});
    await _ecrireFile(f);
  }

  /// Envoie les saisies en attente du compte connecté. Toujours sans réseau : elles restent.
  /// Refus du serveur : la saisie est retirée de la file mais reste en brouillon pour correction.
  static Future<({int envoyees, List<String> refus})> envoyer(Api api) async {
    if (api.jeton == null) return (envoyees: 0, refus: <String>[]);
    final f = await file();
    final reste = <Map<String, dynamic>>[];
    final refus = <String>[];
    var envoyees = 0;
    for (final a in f) {
      if (a['utilisateur'] != api.idUtilisateur) {
        reste.add(a);
        continue;
      }
      try {
        await api.post('/api/evaluations/${a['evaluation']}/${a['action']}', Map<String, dynamic>.from(a['corps'] as Map));
        await effacerBrouillon(a['utilisateur'] as String, a['evaluation'] as int, a['action'] as String);
        envoyees++;
      } on HorsLigne {
        reste.add(a);
      } on ErreurApi catch (e) {
        refus.add(e.message);
      }
    }
    await _ecrireFile(reste);
    return (envoyees: envoyees, refus: refus);
  }
}
