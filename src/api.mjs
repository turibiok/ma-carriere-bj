import { lireRegles, journaliser, initialiser } from './db.mjs';
import { REGLES_PAR_DEFAUT, indice, dateRetraite, moisEntre, gradeDe, libelleEchelle } from './regles.mjs';
import { ECHELLE_NOTATION, ETAPES, CALENDRIER } from './evaluation.mjs';
import { DEMARCHES, SOURCES, PIECES_RECRUTEMENT } from './pieces.mjs';
import {
  ErreurMetier, aujourdhui, agentComplet, executerMoteur, validerEvenement, rejeterEvenement,
  actionEvaluation, catalogueDemarches, deposerDemande, traiterDemande, verifierDiplome,
} from './services.mjs';
import {
  connecter, deconnecter, utilisateurDuJeton, profil, changerMotDePasse, demanderReinitialisation, reinitialiserMotDePasse, restaurerSession,
} from './auth.mjs';
import { MOT_DE_PASSE_DEMO } from './seed.mjs';
import { mesurerSimplification } from './impact.mjs';
import {
  deposerInscription, suivreInscription, detailInscription, lireJustificatif, validerInscription, rejeterInscription,
  JUSTIFICATIFS, STATUTS_AGENT, TAILLE_MAX,
} from './inscription.mjs';

// Taille maximale d'une requête : 1 Mo, sauf l'inscription qui transporte les justificatifs.
const LIMITE_CORPS = 1024 * 1024;
const LIMITE_INSCRIPTION = 4 * TAILLE_MAX * 1.4 + LIMITE_CORPS;

const GESTION = ['gestionnaire', 'drh', 'admin'];

export function creerApi(db) {
  const routes = [];
  const route = (methode, motif, roles, gestionnaire) => {
    const cles = [];
    const re = new RegExp('^' + motif.replace(/:(\w+)/g, (_, k) => { cles.push(k); return '([^/]+)'; }) + '$');
    routes.push({ methode, re, cles, roles, gestionnaire });
  };

  // Périmètre de visibilité : l'agent voit son dossier, l'évaluateur son équipe, la RH tout.
  const perimetre = (user) => {
    if (GESTION.includes(user.role)) return { sql: '1 = 1', params: [] };
    if (user.role === 'evaluateur') return { sql: '(a.id = ? OR a.superieur_id = ?)', params: [user.agent_id, user.agent_id] };
    return { sql: 'a.id = ?', params: [user.agent_id] };
  };
  const peutVoirAgent = (user, id) => {
    const p = perimetre(user);
    return Boolean(db.prepare(`SELECT 1 FROM agents a WHERE a.id = ? AND ${p.sql}`).get(id, ...p.params));
  };
  // Démarche telle qu'affichée : pièces résolues, libellé, documents joints (sans leur contenu).
  const documentsDemande = db.prepare('SELECT id, type_piece, nom_fichier, mime, taille FROM documents WHERE demande_id = ?');
  const enrichirDemandes = (liste) => liste.map((d) => ({
    ...d, pieces: JSON.parse(d.pieces), libelle: DEMARCHES[d.type]?.libelle, documents: documentsDemande.all(d.id),
  }));

  // --- Connexion ---
  route('POST', '/api/connexion', 'public', (_u, _p, _q, corps) => connecter(db, corps));
  route('POST', '/api/deconnexion', null, (user, _p, _q, _c, jeton) => {
    deconnecter(db, jeton);
    journaliser(db, user.nom, 'Déconnexion');
    return { ok: true };
  });
  route('GET', '/api/moi', null, (user) => profil(user));

  // Mesure de la simplification : indicateurs publics et agrégés.
  route('GET', '/api/impact', 'public', () => mesurerSimplification(db));

  // Notifications proactives de l'agent connecté.
  route('GET', '/api/notifications', null, (user) => (user.agent_id
    ? db.prepare('SELECT id, horodatage, titre, message, lu FROM notifications WHERE agent_id = ? ORDER BY id DESC LIMIT 50').all(user.agent_id)
    : []));
  route('POST', '/api/notifications/lues', null, (user) => {
    if (user.agent_id) db.prepare('UPDATE notifications SET lu = 1 WHERE agent_id = ?').run(user.agent_id);
    return { ok: true };
  });
  route('POST', '/api/mot-de-passe/changer', null, (user, _p, _q, corps, jeton) => changerMotDePasse(db, user, corps, jeton));
  route('POST', '/api/mot-de-passe/oublie', 'public', (_u, _p, _q, corps) =>
    demanderReinitialisation(db, corps, { demo: process.env.MODE_DEMO !== '0' }));
  route('POST', '/api/mot-de-passe/reinitialiser', 'public', (_u, _p, _q, corps) => reinitialiserMotDePasse(db, corps));

  // Documents déposés (coffre-fort, pièces jointes aux démarches) : visibles par l'agent et la RH.
  route('GET', '/api/documents/:id', null, (user, { id }) => {
    const d = db.prepare('SELECT * FROM documents WHERE id = ?').get(Number(id));
    if (!d || !d.agent_id || !peutVoirAgent(user, d.agent_id)) throw new ErreurMetier('Document introuvable', 404);
    journaliser(db, user.nom, 'Document consulté', `document ${id} (${d.type_piece})`);
    return { fichier: d };
  });
  // Comptes de démonstration proposés sur la page de connexion (désactivable : MODE_DEMO=0).
  route('GET', '/api/comptes-demo', 'public', () => {
    if (process.env.MODE_DEMO === '0') return { comptes: [] };
    const comptes = db.prepare(`SELECT id, nom, role, description, matricule, npi, telephone FROM utilisateurs
      WHERE id IN ('agent', 'evaluateur', 'gestionnaire', 'drh', 'admin')
      ORDER BY CASE id WHEN 'agent' THEN 1 WHEN 'evaluateur' THEN 2 WHEN 'gestionnaire' THEN 3 WHEN 'drh' THEN 4 ELSE 5 END`).all();
    return { comptes, mot_de_passe: MOT_DE_PASSE_DEMO };
  });

  // --- Inscription en ligne (publique) et vérification par le service du personnel ---
  route('GET', '/api/inscription/parametres', 'public', () => ({
    secteurs: db.prepare('SELECT code, libelle FROM secteurs ORDER BY ordre').all(),
    statuts: STATUTS_AGENT, justificatifs: JUSTIFICATIFS, taille_max: TAILLE_MAX,
  }));
  route('POST', '/api/inscriptions', 'public', (_u, _p, _q, corps) => deposerInscription(db, corps));
  route('GET', '/api/inscriptions/suivi', 'public', (_u, _p, q) => suivreInscription(db, q.get('numero'), q.get('npi')));
  route('GET', '/api/inscriptions', GESTION, (_u, _p, q) => {
    const statut = q.get('statut') || 'EN_ATTENTE';
    return db.prepare(`SELECT i.id, i.numero, i.nom, i.prenoms, i.matricule, i.ministere, i.structure, i.emploi, i.statut, i.depose_le,
        i.traite_le, i.motif, s.libelle AS secteur, (SELECT COUNT(*) FROM justificatifs j WHERE j.inscription_id = i.id) AS nb_justificatifs
      FROM inscriptions i JOIN secteurs s ON s.code = i.secteur
      WHERE ${statut === 'TOUS' ? '1 = 1' : 'i.statut = ?'} ORDER BY i.id DESC`).all(...(statut === 'TOUS' ? [] : [statut]));
  });
  route('GET', '/api/inscriptions/:id', GESTION, (_u, { id }) => detailInscription(db, Number(id)));
  route('GET', '/api/inscriptions/:id/justificatifs/:jid', GESTION, (user, { id, jid }) => {
    const j = lireJustificatif(db, Number(id), Number(jid));
    journaliser(db, user.nom, 'Justificatif consulté', `inscription ${id}, pièce ${jid}`);
    return { fichier: j };
  });
  route('POST', '/api/inscriptions/:id/valider', ['gestionnaire', 'drh'], (user, { id }) => validerInscription(db, Number(id), user));
  route('POST', '/api/inscriptions/:id/rejeter', ['gestionnaire', 'drh'], (user, { id }, _q, corps) => rejeterInscription(db, Number(id), corps.motif, user));

  // --- Référentiels ---
  route('GET', '/api/referentiels', null, () => ({
    secteurs: db.prepare('SELECT code, libelle FROM secteurs ORDER BY ordre').all(),
    structures: db.prepare('SELECT * FROM structures ORDER BY secteur, nom').all(),
    corps: db.prepare('SELECT * FROM corps ORDER BY secteur, libelle').all(),
    etapes_evaluation: ETAPES, echelle_notation: ECHELLE_NOTATION, calendrier: CALENDRIER, sources: SOURCES, pieces_recrutement: PIECES_RECRUTEMENT,
    demarches: Object.fromEntries(Object.entries(DEMARCHES).map(([k, v]) => [k, v.libelle])),
    annee: Number(aujourdhui().slice(0, 4)),
  }));

  // --- Tableau de bord ---
  route('GET', '/api/tableau-de-bord', ['gestionnaire', 'drh', 'admin', 'evaluateur'], (user) => {
    const p = perimetre(user);
    const regles = lireRegles(db);
    const agents = db.prepare(`SELECT a.*, c.secteur, c.libelle AS corps, s.nom AS structure FROM agents a
      JOIN corps c ON c.code = a.corps_code JOIN structures s ON s.id = a.structure_id WHERE ${p.sql}`).all(...p.params);
    const ids = new Set(agents.map((a) => a.id));
    const effectifs = {};
    for (const a of agents) {
      const k = `${a.secteur}|${a.statut}`;
      effectifs[k] = (effectifs[k] ?? 0) + 1;
    }
    const evenements = db.prepare("SELECT type, statut, details FROM evenements WHERE statut IN ('PROPOSE','VALIDE_RH')").all();
    const parType = {};
    let retards = 0, rappel = 0;
    for (const e of evenements) {
      parType[e.type] = (parType[e.type] ?? 0) + 1;
      const d = JSON.parse(e.details);
      if (['AVANCEMENT_ECHELON', 'AVENANT'].includes(e.type) && d.retard_mois > 0) { retards++; rappel += d.rappel_estime ?? 0; }
    }
    const annee = Number(aujourdhui().slice(0, 4));
    const campagne = {};
    for (const r of db.prepare('SELECT agent_id, statut FROM evaluations WHERE annee = ?').all(annee)) {
      if (ids.has(r.agent_id)) campagne[r.statut] = (campagne[r.statut] ?? 0) + 1;
    }
    const retraites = agents
      .filter((a) => a.position === 'ACTIVITE')
      .map((a) => ({ id: a.id, nom: `${a.prenoms} ${a.nom}`, corps: a.corps, structure: a.structure, date: dateRetraite(a, regles) }))
      .map((r) => ({ ...r, mois: moisEntre(aujourdhui(), r.date) }))
      .filter((r) => r.mois <= 36)
      .sort((x, y) => x.date.localeCompare(y.date));
    const demandes = db.prepare('SELECT pieces FROM demandes').all().map((d) => JSON.parse(d.pieces));
    return {
      inscriptions: GESTION.includes(user.role) ? db.prepare("SELECT COUNT(*) AS n FROM inscriptions WHERE statut = 'EN_ATTENTE'").get().n : null,
      total: agents.length, effectifs, propositions: parType, retards, rappel_estime: rappel, campagne, retraites,
      pieces: { demandes: demandes.length, evitees: demandes.reduce((s, d) => s + d.evitees, 0), total: demandes.reduce((s, d) => s + d.total, 0) },
      derniere_execution: db.prepare("SELECT horodatage FROM audit WHERE action = 'Exécution du moteur de règles' ORDER BY id DESC LIMIT 1").get()?.horodatage ?? null,
    };
  });

  // --- Agents ---
  route('GET', '/api/agents', null, (user, _c, q) => {
    const p = perimetre(user);
    const where = [p.sql], params = [...p.params];
    if (q.get('secteur')) { where.push('c.secteur = ?'); params.push(q.get('secteur')); }
    if (q.get('statut')) { where.push('a.statut = ?'); params.push(q.get('statut')); }
    if (q.get('structure')) { where.push('a.structure_id = ?'); params.push(Number(q.get('structure'))); }
    if (q.get('q')) {
      where.push("(a.nom LIKE ? OR a.prenoms LIKE ? OR a.matricule LIKE ? OR a.npi LIKE ?)");
      const t = `%${q.get('q')}%`; params.push(t, t, t, t);
    }
    const regles = lireRegles(db);
    return db.prepare(`SELECT a.id, a.matricule, a.nom, a.prenoms, a.statut, a.echelle, a.echelon, a.position, a.stagiaire, a.date_naissance,
        a.corps_code, c.libelle AS corps, c.secteur, s.nom AS structure,
        (SELECT COUNT(*) FROM evenements e WHERE e.agent_id = a.id AND e.statut IN ('PROPOSE','VALIDE_RH')) AS en_cours
      FROM agents a JOIN corps c ON c.code = a.corps_code JOIN structures s ON s.id = a.structure_id
      WHERE ${where.join(' AND ')} ORDER BY a.nom, a.prenoms`).all(...params)
      .map((a) => ({ ...a, indice: indice(a.echelle, a.echelon), date_retraite: dateRetraite(a, regles), libelle_echelle: libelleEchelle(a), grade: a.statut === 'APE' ? gradeDe(a.echelon, regles) : null }));
  });

  route('GET', '/api/agents/:id', null, (user, { id }) => {
    id = Number(id);
    if (!peutVoirAgent(user, id)) throw new ErreurMetier('Accès refusé à ce dossier', 403);
    return {
      agent: agentComplet(db, id),
      historique: db.prepare('SELECT * FROM historique WHERE agent_id = ? ORDER BY date_effet DESC, id DESC').all(id),
      evaluations: db.prepare('SELECT id, annee, statut, note_finale, mention FROM evaluations WHERE agent_id = ? ORDER BY annee DESC').all(id),
      diplomes: db.prepare('SELECT * FROM diplomes WHERE agent_id = ? ORDER BY date_obtention DESC').all(id),
      coffre: db.prepare('SELECT * FROM coffre WHERE agent_id = ? ORDER BY date_depot DESC').all(id),
      evenements: db.prepare('SELECT * FROM evenements WHERE agent_id = ? ORDER BY id DESC').all(id),
      demandes: enrichirDemandes(db.prepare('SELECT * FROM demandes WHERE agent_id = ? ORDER BY id DESC').all(id)),
      actes: db.prepare('SELECT id, numero, type, objet, date_signature FROM actes WHERE agent_id = ? ORDER BY id DESC').all(id),
    };
  });

  route('POST', '/api/diplomes/:id/verifier', ['gestionnaire', 'drh'], (user, { id }) => {
    verifierDiplome(db, Number(id), user);
    return { ok: true };
  });

  // --- Moteur de règles et propositions ---
  route('POST', '/api/moteur/executer', ['gestionnaire', 'drh', 'admin'], (user) => executerMoteur(db, user.nom));

  route('GET', '/api/evenements', ['gestionnaire', 'drh', 'admin'], (_u, _c, q) => {
    const statut = q.get('statut') || 'PROPOSE';
    const params = [];
    let where = '1 = 1';
    if (statut !== 'TOUS') { where = 'e.statut = ?'; params.push(statut); }
    if (q.get('type')) { where += ' AND e.type = ?'; params.push(q.get('type')); }
    return db.prepare(`SELECT e.*, a.nom, a.prenoms, a.matricule, a.statut AS statut_agent, c.libelle AS corps, s.nom AS structure
      FROM evenements e JOIN agents a ON a.id = e.agent_id JOIN corps c ON c.code = a.corps_code JOIN structures s ON s.id = a.structure_id
      WHERE ${where} ORDER BY e.date_effet`).all(...params).map((e) => ({ ...e, details: JSON.parse(e.details) }));
  });
  route('POST', '/api/evenements/:id/valider', ['gestionnaire', 'drh'], (user, { id }) => validerEvenement(db, Number(id), user));
  route('POST', '/api/evenements/:id/rejeter', ['gestionnaire', 'drh'], (user, { id }, _q, corps) => {
    rejeterEvenement(db, Number(id), corps.motif, user);
    return { ok: true };
  });

  // --- Évaluations ---
  route('GET', '/api/evaluations', null, (user, _c, q) => {
    const p = perimetre(user);
    const annee = Number(q.get('annee')) || Number(aujourdhui().slice(0, 4));
    return db.prepare(`SELECT e.id, e.annee, e.statut, e.note_finale, e.mention, e.agent_id, a.nom, a.prenoms, a.statut AS statut_agent,
        a.superieur_id, c.libelle AS corps, c.secteur, s.nom AS structure
      FROM evaluations e JOIN agents a ON a.id = e.agent_id JOIN corps c ON c.code = a.corps_code JOIN structures s ON s.id = a.structure_id
      WHERE e.annee = ? AND ${p.sql} ORDER BY s.nom, a.nom`).all(annee, ...p.params);
  });
  route('GET', '/api/evaluations/:id', null, (user, { id }) => {
    const ev = db.prepare(`SELECT e.*, a.nom, a.prenoms, a.superieur_id, a.statut AS statut_agent, c.libelle AS corps, c.secteur, s.nom AS structure,
        (SELECT prenoms || ' ' || nom FROM agents x WHERE x.id = e.evaluateur_id) AS evaluateur
      FROM evaluations e JOIN agents a ON a.id = e.agent_id JOIN corps c ON c.code = a.corps_code JOIN structures s ON s.id = a.structure_id
      WHERE e.id = ?`).get(Number(id));
    if (!ev) throw new ErreurMetier('Fiche introuvable', 404);
    if (!peutVoirAgent(user, ev.agent_id)) throw new ErreurMetier('Accès refusé', 403);
    const regles = lireRegles(db);
    return { ...ev, fiche: JSON.parse(ev.fiche), ponderation: regles.ponderation_evaluation, rapport_special: regles.rapport_special };
  });
  route('POST', '/api/evaluations/:id/:action', null, (user, { id, action }, _q, corps) => actionEvaluation(db, Number(id), action, corps, user));

  // --- Démarches et demandes ---
  route('GET', '/api/demarches', null, (user, _c, q) => {
    const agentId = user.role === 'agent' ? user.agent_id : Number(q.get('agent'));
    if (!agentId) throw new ErreurMetier('Agent non précisé');
    if (!peutVoirAgent(user, agentId)) throw new ErreurMetier('Accès refusé', 403);
    return catalogueDemarches(db, agentId);
  });
  route('POST', '/api/demandes', null, (user, _c, _q, corps) => {
    const agentId = user.role === 'agent' || user.role === 'evaluateur' ? user.agent_id : Number(corps.agent_id);
    if (!peutVoirAgent(user, agentId)) throw new ErreurMetier('Accès refusé', 403);
    return deposerDemande(db, agentId, corps, user);
  });
  route('GET', '/api/demandes', null, (user) => {
    const p = perimetre(user);
    return enrichirDemandes(db.prepare(`SELECT d.*, a.nom, a.prenoms, s.nom AS structure FROM demandes d JOIN agents a ON a.id = d.agent_id
      JOIN structures s ON s.id = a.structure_id WHERE ${p.sql} ORDER BY d.id DESC`).all(...p.params));
  });
  route('POST', '/api/demandes/:id/traiter', ['gestionnaire', 'drh'], (user, { id }, _q, corps) => {
    traiterDemande(db, Number(id), corps, user);
    return { ok: true };
  });

  // --- Actes ---
  route('GET', '/api/actes', null, (user) => {
    const p = perimetre(user);
    return db.prepare(`SELECT t.id, t.numero, t.type, t.objet, t.date_signature, t.signataire, a.nom, a.prenoms
      FROM actes t JOIN agents a ON a.id = t.agent_id WHERE ${p.sql} ORDER BY t.id DESC`).all(...p.params);
  });
  route('GET', '/api/actes/:id', null, (user, { id }) => {
    const t = db.prepare('SELECT * FROM actes WHERE id = ?').get(Number(id));
    if (!t || !peutVoirAgent(user, t.agent_id)) throw new ErreurMetier('Acte introuvable', 404);
    return { ...t, contenu: JSON.parse(t.contenu), agent: agentComplet(db, t.agent_id) };
  });
  // Vérification publique de l'authenticité d'un acte (aucune authentification).
  route('GET', '/api/verifier/:code', 'public', (_u, { code }) => {
    const t = db.prepare(`SELECT t.numero, t.type, t.objet, t.date_signature, t.signataire, a.prenoms || ' ' || a.nom AS agent, a.matricule
      FROM actes t JOIN agents a ON a.id = t.agent_id WHERE t.code_verification = ?`).get(code.toUpperCase());
    return t ? { authentique: true, ...t } : { authentique: false };
  });

  // --- Paramétrage et journal ---
  route('GET', '/api/regles', null, () => db.prepare('SELECT * FROM regles ORDER BY groupe, cle').all().map((r) => ({ ...r, valeur: JSON.parse(r.valeur) })));
  route('PUT', '/api/regles/:cle', ['admin'], (user, { cle }, _q, corps) => {
    const defaut = REGLES_PAR_DEFAUT[cle];
    if (!defaut) throw new ErreurMetier('Règle inconnue', 404);
    if (typeof corps.valeur !== typeof defaut.valeur || Array.isArray(corps.valeur) !== Array.isArray(defaut.valeur)) {
      throw new ErreurMetier('Format de valeur incorrect');
    }
    if (typeof corps.valeur === 'number' && !(corps.valeur >= 0)) throw new ErreurMetier('Valeur positive attendue');
    db.prepare('UPDATE regles SET valeur = ? WHERE cle = ?').run(JSON.stringify(corps.valeur), cle);
    journaliser(db, user.nom, 'Règle modifiée', `${cle} = ${JSON.stringify(corps.valeur)}`);
    return { ok: true };
  });
  route('GET', '/api/audit', ['drh', 'admin'], () => db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all());
  route('POST', '/api/reinitialiser', ['admin'], (user, _p, _q, _c, jeton) => {
    initialiser(db);
    // L'administrateur reste connecté après le rechargement des données.
    restaurerSession(db, jeton, user.id);
    journaliser(db, user.nom, 'Données de démonstration réinitialisées');
    return { ok: true };
  });

  return async function traiter(req, res) {
    const url = new URL(req.url, 'http://x');
    const envoyer = (code, corps) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(corps));
    };
    try {
      const r = routes.find((x) => x.methode === req.method && x.re.test(url.pathname));
      if (!r) return envoyer(404, { erreur: 'Route inconnue' });
      const m = url.pathname.match(r.re);
      const params = Object.fromEntries(r.cles.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const jeton = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || null;
      let user = null;
      if (r.roles !== 'public') {
        user = utilisateurDuJeton(db, jeton);
        if (!user) return envoyer(401, { erreur: 'Session expirée ou absente : veuillez vous reconnecter.' });
        if (r.roles && !r.roles.includes(user.role)) return envoyer(403, { erreur: 'Action non autorisée pour ce profil' });
      }
      let corps = {};
      if (req.method === 'POST' || req.method === 'PUT') {
        const limite = ['/api/inscriptions', '/api/demandes'].includes(url.pathname) ? LIMITE_INSCRIPTION : LIMITE_CORPS;
        const morceaux = [];
        let taille = 0;
        for await (const morceau of req) {
          taille += morceau.length;
          if (taille > limite) {
            res.setHeader('Connection', 'close');
            return envoyer(413, { erreur: 'Envoi trop volumineux : 2 Mo au plus par justificatif.' });
          }
          morceaux.push(morceau);
        }
        const brut = Buffer.concat(morceaux).toString('utf8');
        try { corps = brut ? JSON.parse(brut) : {}; } catch { return envoyer(400, { erreur: 'Requête mal formée' }); }
      }
      const resultat = await r.gestionnaire(user, params, url.searchParams, corps, jeton) ?? {};
      if (resultat.fichier) {
        // Fichier binaire (justificatif) : affiché dans le navigateur, jamais interprété comme une page.
        const f = resultat.fichier;
        res.writeHead(200, {
          'Content-Type': f.mime, 'Content-Disposition': `inline; filename="${encodeURIComponent(f.nom_fichier)}"`,
          'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        }).end(Buffer.from(f.contenu));
        return;
      }
      envoyer(200, resultat);
    } catch (e) {
      if (e instanceof ErreurMetier) return envoyer(e.statut, { erreur: e.message });
      console.error(e);
      envoyer(500, { erreur: 'Erreur interne' });
    }
  };
}
