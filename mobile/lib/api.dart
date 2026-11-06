import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Pas de réseau (téléphone hors couverture, serveur injoignable).
class HorsLigne implements Exception {
  const HorsLigne();
  @override
  String toString() => 'Pas de connexion au réseau. Réessayez dès le retour du réseau.';
}

/// Refus du serveur, avec son message (identifiants incorrects, rapport spécial manquant...).
class ErreurApi implements Exception {
  ErreurApi(this.message, this.statut);
  final String message;
  final int statut;
  @override
  String toString() => message;
}

/// Accès à l'API de Ma Carrière BJ : la même que celle de la plateforme web.
/// Le jeton de session reste en mémoire : fermer l'application déconnecte.
class Api {
  Api(this.serveur, {http.Client? client}) : _client = client ?? http.Client();

  String serveur;
  final http.Client _client;
  String? jeton;
  Map<String, dynamic>? utilisateur;

  /// Appelé quand le serveur refuse le jeton (session expirée).
  void Function()? sessionExpiree;

  String get idUtilisateur => '${utilisateur?['id']}';
  int? get agentId => utilisateur?['agent_id'] as int?;

  Future<dynamic> get(String chemin) => _envoyer('GET', chemin);
  Future<dynamic> post(String chemin, [Map<String, dynamic>? corps]) => _envoyer('POST', chemin, corps);

  Future<dynamic> _envoyer(String methode, String chemin, [Map<String, dynamic>? corps]) async {
    final uri = Uri.parse('${serveur.replaceAll(RegExp(r'/+$'), '')}$chemin');
    final entetes = {
      'Content-Type': 'application/json',
      if (jeton != null) 'Authorization': 'Bearer $jeton',
    };
    http.Response res;
    try {
      final requete = methode == 'GET'
          ? _client.get(uri, headers: entetes)
          : _client.post(uri, headers: entetes, body: jsonEncode(corps ?? const {}));
      res = await requete.timeout(const Duration(seconds: 15));
    } on Exception {
      // Délai dépassé, serveur injoignable, pas de réseau : l'appelant peut garder la saisie.
      throw const HorsLigne();
    }
    final texte = utf8.decode(res.bodyBytes);
    final donnees = texte.isEmpty ? null : jsonDecode(texte);
    if (res.statusCode == 401 && jeton != null) {
      jeton = null;
      utilisateur = null;
      sessionExpiree?.call();
    }
    if (res.statusCode >= 400) {
      final message = donnees is Map ? donnees['erreur']?.toString() : null;
      throw ErreurApi(message ?? 'Erreur ${res.statusCode}', res.statusCode);
    }
    return donnees;
  }

  Future<void> connecter(String type, String identifiant, String motDePasse) async {
    final r = await post('/api/connexion', {'type': type, 'identifiant': identifiant, 'mot_de_passe': motDePasse});
    jeton = r['jeton'] as String;
    utilisateur = Map<String, dynamic>.from(r['utilisateur'] as Map);
  }

  Future<void> deconnecter() async {
    try {
      await post('/api/deconnexion');
    } on Exception {
      // Hors ligne : la session expirera d'elle-même côté serveur.
    }
    jeton = null;
    utilisateur = null;
  }
}
