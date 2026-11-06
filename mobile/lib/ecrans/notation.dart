import 'package:flutter/material.dart';

import '../api.dart';
import '../attente.dart';
import '../main.dart';
import 'commun.dart';

const _statuts = {
  'OBJECTIFS_FIXES': ('Objectifs fixés', Color(0xFF5B6B7B), Color(0xFFEEF1F4)),
  'AUTO_EVALUEE': ('Auto-évaluée', Color(0xFF2457A6), Color(0xFFE8EEFA)),
  'EVALUEE': ('Notée', vertFonce, Color(0xFFE6F4ED)),
  'CONTESTEE': ('Recours (CAP)', Color(0xFFB42318), Color(0xFFFDECEA)),
  'CLOTUREE': ('Clôturée', Color(0xFF1D7A3E), Color(0xFFE5F4EA)),
};

Widget etiquetteStatut(String statut) {
  final s = _statuts[statut] ?? (statut, const Color(0xFF5B6B7B), const Color(0xFFEEF1F4));
  return Etiquette(s.$1, couleur: s.$2, fond: s.$3);
}

/// Notation de l'année : la fiche de l'agent et, pour un évaluateur, celles de son équipe.
class EcranNotation extends StatefulWidget {
  const EcranNotation({super.key, required this.api});
  final Api api;

  @override
  State<EcranNotation> createState() => _EcranNotationState();
}

class _EcranNotationState extends State<EcranNotation> {
  int _version = 0;

  @override
  Widget build(BuildContext context) {
    final moi = widget.api.agentId;
    return Chargement<List>(
      key: ValueKey(_version),
      charger: () async => await widget.api.get('/api/evaluations') as List,
      construire: (context, liste, _) {
        final mienne = liste.where((e) => e['agent_id'] == moi).toList();
        final equipe = liste.where((e) => e['agent_id'] != moi).toList();
        Widget tuile(Map e) => Card(
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: const BorderSide(color: Color(0xFFDDE3E9))),
              child: ListTile(
                title: Text('${e['prenoms']} ${e['nom']}', style: const TextStyle(fontWeight: FontWeight.w600)),
                subtitle: Text('${e['corps']} · ${e['note_finale'] == null ? 'non notée' : '${e['note_finale']}/20'}'),
                trailing: etiquetteStatut('${e['statut']}'),
                onTap: () async {
                  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => EcranFiche(api: widget.api, id: e['id'] as int)));
                  setState(() => _version++);
                },
              ),
            );
        return ListView(padding: const EdgeInsets.all(16), children: [
          Text('Notation ${liste.isEmpty ? '' : liste.first['annee']}', style: const TextStyle(fontSize: 13, color: Color(0xFF5B6B7B))),
          const SizedBox(height: 6),
          const Text('Ma fiche', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          for (final e in mienne) ...[tuile(e), const SizedBox(height: 8)],
          if (mienne.isEmpty) const Text('Pas de fiche de notation cette année.'),
          if (equipe.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text('Mon équipe (${equipe.length})', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            for (final e in equipe) ...[tuile(e), const SizedBox(height: 8)],
          ],
        ]);
      },
    );
  }
}

/// Fiche de notation : auto-évaluation de l'agent, notation par l'évaluateur, visa ou recours.
class EcranFiche extends StatefulWidget {
  const EcranFiche({super.key, required this.api, required this.id});
  final Api api;
  final int id;

  @override
  State<EcranFiche> createState() => _EcranFicheState();
}

class _EcranFicheState extends State<EcranFiche> {
  Map<String, dynamic>? _e;
  Object? _erreurChargement;
  String? _mode; // 'auto', 'evaluer' ou null (lecture)
  final Map<String, int> _notes = {};
  final _commentaire = TextEditingController();
  final Set<String> _manquants = {};
  String? _erreur;
  bool _envoi = false;
  bool _enAttente = false;

  @override
  void initState() {
    super.initState();
    _charger();
  }

  Future<void> _charger() async {
    try {
      final e = Map<String, dynamic>.from(await widget.api.get('/api/evaluations/${widget.id}') as Map);
      final moi = widget.api.agentId;
      final mode = e['agent_id'] == moi && e['statut'] == 'OBJECTIFS_FIXES'
          ? 'auto'
          : e['superieur_id'] == moi && e['statut'] == 'AUTO_EVALUEE'
              ? 'evaluer'
              : null;
      if (mode != null) {
        // Brouillon : les notes cochées avant une fermeture ou une coupure sont retrouvées.
        final b = await Attente.brouillon(widget.api.idUtilisateur, widget.id, mode);
        if (b != null) {
          _notes.addAll((b['notes'] as Map).map((k, v) => MapEntry('$k', v as int)));
          _commentaire.text = '${b['commentaire'] ?? ''}';
        }
        _enAttente = await Attente.enAttente(widget.api.idUtilisateur, widget.id);
      }
      setState(() {
        _e = e;
        _mode = mode;
      });
    } on Exception catch (err) {
      setState(() => _erreurChargement = err);
    }
  }

  List<Map> get _criteres => [for (final r in _e!['fiche']['rubriques'] as List) ...(r['criteres'] as List).cast<Map>()];

  void _noter(String code, int note) {
    setState(() {
      _notes[code] = note;
      _manquants.remove(code);
      if (_manquants.isEmpty) _erreur = null;
    });
    Attente.garderBrouillon(widget.api.idUtilisateur, widget.id, _mode!, _notes, _commentaire.text);
  }

  /// Aperçu de la note sur 20 (même formule que le serveur).
  String _apercu() {
    final ponderation = _e!['ponderation'] as Map;
    var total = 0.0, poids = 0.0;
    for (final r in _e!['fiche']['rubriques'] as List) {
      final n = [for (final c in r['criteres'] as List) if (_notes[c['code']] != null) _notes[c['code']]!];
      if (n.isEmpty) continue;
      final p = (ponderation[r['code']] as num).toDouble();
      total += n.reduce((a, b) => a + b) / n.length / 5 * p;
      poids += p;
    }
    return poids == 100 ? '${(total / poids * 2000).round() / 100}/20' : 'à compléter';
  }

  Future<void> _envoyer() async {
    final manquants = _criteres.where((c) => _notes[c['code']] == null).map((c) => '${c['code']}').toSet();
    if (manquants.isNotEmpty) {
      return setState(() {
        _manquants
          ..clear()
          ..addAll(manquants);
        _erreur = '${manquants.length} élément(s) à noter avant l\'envoi (en rouge).';
      });
    }
    final corps = {'notes': _notes, 'commentaire': _commentaire.text};
    setState(() => _envoi = true);
    final messager = ScaffoldMessenger.of(context);
    try {
      final r = await widget.api.post('/api/evaluations/${widget.id}/$_mode', corps);
      await Attente.effacerBrouillon(widget.api.idUtilisateur, widget.id, _mode!);
      messager.showSnackBar(SnackBar(
          content: Text(r['note_finale'] != null
              ? 'Notation validée : ${r['note_finale']}/20 (${r['mention']}).'
              : 'Auto-évaluation transmise à votre supérieur.')));
      if (mounted) Navigator.of(context).pop();
    } on HorsLigne {
      // Sans réseau : la saisie attend sur le téléphone et part seule au retour du réseau.
      await Attente.ajouter(widget.api.idUtilisateur, widget.id, _mode!, corps);
      setState(() {
        _enAttente = true;
        _envoi = false;
      });
      messager.showSnackBar(const SnackBar(content: Text('Pas de réseau : votre saisie est enregistrée sur ce téléphone et partira automatiquement.')));
    } on ErreurApi catch (err) {
      setState(() {
        _erreur = err.message;
        _envoi = false;
      });
    }
  }

  Future<void> _viser(bool accord) async {
    String? motif;
    if (!accord) {
      final saisie = TextEditingController();
      motif = await showDialog<String>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Former un recours'),
          content: TextField(controller: saisie, maxLines: 4, decoration: const InputDecoration(labelText: 'Motif du recours', border: OutlineInputBorder())),
          actions: [
            TextButton(onPressed: () => Navigator.pop(c), child: const Text('Annuler')),
            FilledButton(onPressed: () => Navigator.pop(c, saisie.text.trim()), child: const Text('Envoyer')),
          ],
        ),
      );
      if (motif == null || motif.isEmpty || !mounted) return;
    }
    final messager = ScaffoldMessenger.of(context);
    try {
      await widget.api.post('/api/evaluations/${widget.id}/viser', {'accord': accord, 'motif': ?motif});
      messager.showSnackBar(SnackBar(content: Text(accord ? 'Fiche visée.' : 'Recours transmis à la commission administrative paritaire.')));
      if (mounted) Navigator.of(context).pop();
    } on Exception catch (err) {
      messager.showSnackBar(SnackBar(content: Text('$err')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final e = _e;
    return Scaffold(
      appBar: AppBar(title: const Text('Fiche de notation'), bottom: const PreferredSize(preferredSize: Size.fromHeight(4), child: Drapeau())),
      body: e == null
          ? Center(
              child: _erreurChargement == null
                  ? const CircularProgressIndicator()
                  : Padding(padding: const EdgeInsets.all(24), child: Text('$_erreurChargement', textAlign: TextAlign.center)))
          : _contenu(e),
    );
  }

  Widget _contenu(Map<String, dynamic> e) {
    final echelle = const ['Insuffisant', 'À améliorer', 'Conforme', 'Au-delà', 'Exceptionnel'];
    final estAgent = e['agent_id'] == widget.api.agentId;
    final notes = _criteres.where((c) => _notes[c['code']] != null).length;
    return ListView(padding: const EdgeInsets.all(16), children: [
      Text('${e['prenoms']} ${e['nom']}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
      Text('${e['corps']} · ${e['structure']}', style: const TextStyle(color: Color(0xFF5B6B7B))),
      const SizedBox(height: 8),
      Row(children: [etiquetteStatut('${e['statut']}'), const SizedBox(width: 8), Text('Notation ${e['annee']}')]),
      const SizedBox(height: 12),
      if (_mode != null)
        Text(
            '${_mode == 'auto' ? 'Notez-vous' : 'Notez l\'agent'} sur chaque élément : 1 insuffisant, 3 conforme aux attentes, 5 exceptionnel. '
            '$notes/${_criteres.length} éléments notés.',
            style: const TextStyle(color: Color(0xFF5B6B7B))),
      const SizedBox(height: 8),
      for (final r in e['fiche']['rubriques'] as List) ...[
        Container(
          margin: const EdgeInsets.only(top: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(color: const Color(0xFFE6F4ED), borderRadius: BorderRadius.circular(6)),
          child: Text('${r['libelle']} · poids ${e['ponderation'][r['code']]} %', style: const TextStyle(color: vertFonce, fontWeight: FontWeight.w600)),
        ),
        for (final c in (r['criteres'] as List).cast<Map>())
          Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              border: const Border(bottom: BorderSide(color: Color(0xFFDDE3E9))),
              color: _manquants.contains(c['code']) ? const Color(0xFFFDECEA) : null,
            ),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${c['libelle']}', style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              if (_mode != null)
                Wrap(spacing: 6, children: [
                  for (var n = 1; n <= 5; n++)
                    ChoiceChip(
                      key: Key('note-${c['code']}-$n'),
                      label: Text('$n'),
                      tooltip: echelle[n - 1],
                      selected: _notes[c['code']] == n,
                      showCheckmark: false,
                      onSelected: _enAttente ? null : (_) => _noter('${c['code']}', n),
                    ),
                ]),
              if (_mode != 'auto') Text('Auto-évaluation : ${c['auto'] ?? '-'}', style: const TextStyle(color: Color(0xFF5B6B7B))),
              if (_mode == null) Text('Évaluateur : ${c['note'] ?? '-'}', style: const TextStyle(color: Color(0xFF5B6B7B))),
            ]),
          ),
      ],
      if (_mode != null) ...[
        const SizedBox(height: 12),
        TextField(
          controller: _commentaire,
          maxLines: 3,
          enabled: !_enAttente,
          onChanged: (_) => Attente.garderBrouillon(widget.api.idUtilisateur, widget.id, _mode!, _notes, _commentaire.text),
          decoration: InputDecoration(
            border: const OutlineInputBorder(),
            labelText: _mode == 'auto' ? 'Commentaire (facultatif)' : 'Appréciation de l\'évaluateur',
            helperText: _mode == 'evaluer'
                ? 'Rapport spécial obligatoire si la note est inférieure à ${e['rapport_special']['sous']} ou d\'au moins ${e['rapport_special']['des']}.'
                : null,
            helperMaxLines: 3,
          ),
        ),
        if (_mode == 'evaluer') Padding(padding: const EdgeInsets.only(top: 10), child: Text('Note calculée : ${_apercu()}', style: const TextStyle(fontWeight: FontWeight.w700))),
        if (_erreur != null) Padding(padding: const EdgeInsets.only(top: 10), child: Text(_erreur!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
        if (_enAttente)
          Container(
            key: const Key('en-attente'),
            margin: const EdgeInsets.only(top: 12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFFE8EEFA), borderRadius: BorderRadius.circular(8)),
            child: const Text('Enregistrée sur ce téléphone : envoi automatique au retour du réseau.',
                style: TextStyle(color: Color(0xFF2457A6), fontWeight: FontWeight.w600)),
          ),
        const SizedBox(height: 12),
        FilledButton(
          key: const Key('envoyer'),
          onPressed: _envoi || _enAttente ? null : _envoyer,
          style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
          child: Text(_mode == 'auto' ? 'Transmettre mon auto-évaluation' : 'Valider la notation'),
        ),
      ],
      if (_mode == null) ...[
        const SizedBox(height: 16),
        Carte(titre: 'Résultat', enfants: [
          Text(e['note_finale'] == null ? '-' : '${e['note_finale']}/20', style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
          Text('${e['mention'] ?? 'Non notée'}'),
          if (e['commentaire_evaluateur'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Évaluateur : ${e['commentaire_evaluateur']}')),
          if (e['decision_commission'] != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('Avis de la CAP : ${e['decision_commission']}')),
        ]),
        if (estAgent && e['statut'] == 'EVALUEE') ...[
          const SizedBox(height: 12),
          const Text('Prenez connaissance de votre note : vous pouvez la viser ou former un recours (avis de la CAP sous 8 jours).'),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: FilledButton(onPressed: () => _viser(true), child: const Text('Viser la fiche'))),
            const SizedBox(width: 8),
            Expanded(child: OutlinedButton(onPressed: () => _viser(false), child: const Text('Former un recours'))),
          ]),
        ],
      ],
      const SizedBox(height: 24),
    ]);
  }
}
