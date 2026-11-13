// Démonstration en ligne : l'hébergeur lance plusieurs instances de l'API en parallèle, chacune
// avec sa base SQLite en mémoire. Pour qu'elles partagent un même état, la base entière est gardée
// dans un stockage commun (Postgres chez Neon) sous forme d'instantané versionné :
//  - avant chaque requête, l'instance recharge l'instantané si sa version a changé ;
//  - après une requête qui a modifié la base, elle enregistre le nouvel instantané à condition que
//    personne ne l'ait modifié entre-temps ; sinon elle reprend l'état le plus récent et rejoue la
//    requête, comme une transaction optimiste.
// Les valeurs volumineuses (fichiers, images de signature) sont rangées une seule fois à part,
// sous leur empreinte : l'instantané ne contient que des références, et reste léger.

import { DatabaseSync } from 'node:sqlite';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { creerSchema, initialiser, VERSION_SCHEMA } from './db.mjs';
import { creerApi } from './api.mjs';

const SEUIL_BLOC = 2048; // au-delà, une valeur est rangée à part
const CORPS_MAX = 13 * 1024 * 1024; // l'API applique ensuite ses propres limites
const ESSAIS_MAX = 12; // tentatives d'une écriture en conflit avant d'abandonner (environ 8 s au plus)
const empreinte = (octets) => createHash('sha256').update(octets).digest('hex').slice(0, 32);
const jour = () => new Date().toISOString().slice(0, 10);

// --- Instantané ---

// Renvoie { donnees (texte), blocs : Map(empreinte → base64) }.
export function instantane(db) {
  const blocs = new Map();
  const ranger = (octets, type) => {
    const h = empreinte(octets);
    if (!blocs.has(h)) blocs.set(h, octets.toString('base64'));
    return { [type]: h };
  };
  const valeur = (v) => {
    if (v instanceof Uint8Array) return ranger(Buffer.from(v), '$b');
    if (typeof v === 'string' && v.length > SEUIL_BLOC) return ranger(Buffer.from(v, 'utf8'), '$s');
    return v;
  };
  const tables = {};
  const noms = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  for (const t of noms) {
    const colonnes = db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    const lignes = db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all().map((l) => colonnes.map((c) => valeur(l[c])));
    tables[t] = { colonnes, lignes };
  }
  const donnees = gzipSync(JSON.stringify({ schema: VERSION_SCHEMA, tables })).toString('base64');
  return { donnees, blocs };
}

// Empreintes des blocs auxquels un instantané fait référence.
export function references(donnees) {
  const { tables } = JSON.parse(gunzipSync(Buffer.from(donnees, 'base64')));
  const refs = new Set();
  for (const { lignes } of Object.values(tables)) {
    for (const l of lignes) for (const v of l) if (v && typeof v === 'object') refs.add(v.$b ?? v.$s);
  }
  return refs;
}

// Reconstruit une base en mémoire ; blocs : Map(empreinte → base64).
export function restaurer(donnees, blocs) {
  const { tables } = JSON.parse(gunzipSync(Buffer.from(donnees, 'base64')));
  const db = new DatabaseSync(':memory:');
  creerSchema(db);
  const valeur = (v) => {
    if (!v || typeof v !== 'object') return v;
    const h = v.$b ?? v.$s;
    const b64 = blocs.get(h);
    if (b64 === undefined) throw new Error(`Bloc manquant : ${h}`);
    return v.$b ? Buffer.from(b64, 'base64') : Buffer.from(b64, 'base64').toString('utf8');
  };
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  for (const [t, { colonnes, lignes }] of Object.entries(tables)) {
    if (!lignes.length) continue;
    const ins = db.prepare(`INSERT INTO "${t}" (${colonnes.map((c) => `"${c}"`).join(', ')}) VALUES (${colonnes.map(() => '?').join(', ')})`);
    for (const l of lignes) ins.run(...l.map(valeur));
  }
  db.exec('COMMIT');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

// --- Stockage chez Neon, par son interface HTTP (aucune dépendance) ---

export function stockageNeon(chaine) {
  const { hostname } = new URL(chaine);
  const sql = async (query, params = []) => {
    const r = await fetch(`https://${hostname}/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': chaine, 'Neon-Raw-Text-Output': 'true' },
      body: JSON.stringify({ query, params }),
    });
    if (!r.ok) throw new Error(`Neon ${r.status} : ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).rows;
  };
  const tableau = (liste) => `{${liste.map((x) => `"${x}"`).join(',')}}`; // empreintes hexadécimales et base64 : rien à échapper
  let pret = null;
  const preparer = () => (pret ??= Promise.all([
    sql(`CREATE TABLE IF NOT EXISTS etat (id integer PRIMARY KEY CHECK (id = 1), version bigint NOT NULL, schema integer NOT NULL,
      seme_le date NOT NULL, maj_le timestamptz NOT NULL DEFAULT now(), donnees text NOT NULL)`),
    sql('CREATE TABLE IF NOT EXISTS blocs (hash text PRIMARY KEY, contenu text NOT NULL)'),
  ]).catch((e) => { pret = null; throw e; }));
  return {
    async version() {
      await preparer();
      const [l] = await sql('SELECT version FROM etat WHERE id = 1');
      return l ? Number(l.version) : 0;
    },
    async lire() {
      await preparer();
      const [l] = await sql('SELECT version, schema, seme_le::text AS seme_le, donnees FROM etat WHERE id = 1');
      return l ? { version: Number(l.version), schema: Number(l.schema), seme_le: l.seme_le, donnees: l.donnees } : null;
    },
    async lireBlocs(empreintes) {
      if (!empreintes.length) return new Map();
      const lignes = await sql('SELECT hash, contenu FROM blocs WHERE hash = ANY($1::text[])', [tableau(empreintes)]);
      return new Map(lignes.map((l) => [l.hash, l.contenu]));
    },
    async ecrireBlocs(blocs) {
      if (!blocs.size) return;
      await sql('INSERT INTO blocs (hash, contenu) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT (hash) DO NOTHING',
        [tableau([...blocs.keys()]), tableau([...blocs.values()])]);
    },
    // Écrit si la version stockée est toujours `attendue` ; renvoie la nouvelle version, ou null en cas de conflit.
    async ecrire(attendue, { schema, seme_le, donnees }) {
      await preparer();
      const lignes = attendue === 0
        ? await sql(`INSERT INTO etat (id, version, schema, seme_le, donnees) VALUES (1, 1, $1, $2, $3)
            ON CONFLICT (id) DO NOTHING RETURNING version`, [schema, seme_le, donnees])
        : await sql(`UPDATE etat SET version = version + 1, schema = $1, seme_le = $2, donnees = $3, maj_le = now()
            WHERE id = 1 AND version = $4 RETURNING version`, [schema, seme_le, donnees, attendue]);
      return lignes.length ? Number(lignes[0].version) : null;
    },
  };
}

// Stockage en mémoire, partagé entre plusieurs « instances » : pour les tests.
export function stockageMemoire() {
  let etat = null;
  const blocs = new Map();
  return {
    ecritures: 0,
    async version() { return etat?.version ?? 0; },
    async lire() { return etat && { ...etat }; },
    async lireBlocs(empreintes) { return new Map(empreintes.filter((h) => blocs.has(h)).map((h) => [h, blocs.get(h)])); },
    async ecrireBlocs(nouveaux) { for (const [h, v] of nouveaux) blocs.set(h, v); },
    async ecrire(attendue, e) {
      if ((etat?.version ?? 0) !== attendue) return null;
      this.ecritures++;
      etat = { ...e, version: attendue + 1 };
      return etat.version;
    },
    vieillir(seme_le) { etat.seme_le = seme_le; },
  };
}

// --- Serveur partagé ---

// dureeJours : au-delà, les données de démonstration sont semées à nouveau (dates relatives à
// « aujourd'hui »), comme le faisait chaque instance neuve auparavant.
export function creerApiPartagee(stockage, { dureeJours = 7, aujourdhui = jour } = {}) {
  let db = null, api = null, version = -1, semeLe = null;
  const cache = new Map(); // blocs déjà connus de cette instance
  let file = Promise.resolve();

  const installer = (nouvelle, v, s) => { db = nouvelle; api = creerApi(db); version = v; semeLe = s; };
  const ageJours = (iso) => (Date.parse(aujourdhui()) - Date.parse(iso)) / 86400000;

  async function publier(base, attendue, seme) {
    const { donnees, blocs } = instantane(base);
    const nouveaux = new Map([...blocs].filter(([h]) => !cache.has(h)));
    await stockage.ecrireBlocs(nouveaux);
    for (const [h, v] of nouveaux) cache.set(h, v);
    return stockage.ecrire(attendue, { schema: VERSION_SCHEMA, seme_le: seme, donnees });
  }

  async function charger(forcer = false) {
    const v = await stockage.version();
    if (!forcer && db && v === version) return;
    const e = v ? await stockage.lire() : null;
    if (e && e.schema === VERSION_SCHEMA && ageJours(e.seme_le) < dureeJours) {
      const manquants = [...references(e.donnees)].filter((h) => !cache.has(h));
      for (const [h, b] of await stockage.lireBlocs(manquants)) cache.set(h, b);
      return installer(restaurer(e.donnees, cache), e.version, e.seme_le);
    }
    // Pas d'état, schéma changé ou données trop anciennes : on sème, puis on publie,
    // sauf si une autre instance l'a fait entre-temps (on reprend alors la sienne).
    const neuve = new DatabaseSync(':memory:');
    initialiser(neuve, aujourdhui());
    const nv = await publier(neuve, e?.version ?? 0, aujourdhui());
    if (nv === null) return charger(true);
    installer(neuve, nv, aujourdhui());
  }

  const changements = () => db.prepare('SELECT total_changes() AS n').get().n;

  // Fait traiter la requête par l'API et capture la réponse au lieu de l'envoyer.
  async function appeler(req, corps) {
    const faux = Readable.from(corps.length ? [corps] : []);
    Object.assign(faux, { method: req.method, url: req.url, headers: req.headers });
    const r = { statut: 200, entetes: {}, corps: Buffer.alloc(0) };
    const res = {
      setHeader(k, v) { r.entetes[k] = v; return res; },
      writeHead(code, entetes = {}) { r.statut = code; Object.assign(r.entetes, entetes); return res; },
      end(c) { if (c !== undefined) r.corps = Buffer.isBuffer(c) ? c : Buffer.from(String(c)); return res; },
    };
    await api(faux, res);
    return r;
  }

  const erreur = (statut, message) => ({
    statut, entetes: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    corps: Buffer.from(JSON.stringify({ erreur: message })),
  });

  async function executer(req, corps) {
    const lecture = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    for (let essai = 0; essai < ESSAIS_MAX; essai++) {
      // Après un conflit, attente aléatoire croissante : des écritures simultanées se départagent
      // au lieu de se gêner indéfiniment (une rafale de connexions, par exemple).
      if (essai > 0) await new Promise((r) => setTimeout(r, Math.min(1500, (40 + Math.random() * 120) * essai)));
      try { await charger(essai > 0); } catch (e) {
        console.error('Stockage partagé indisponible :', e.message);
        // Jamais de réponse tirée d'un état local peut-être périmé : un compte ou une session
        // absents y vaudraient un refus (401) qui déconnecte l'utilisateur à tort.
        version = -1;
        return erreur(503, 'La plateforme est momentanément indisponible : réessayez dans un instant.');
      }
      const avant = changements();
      const r = await appeler(req, corps);
      if (lecture || changements() === avant) return r;
      const seme = new URL(req.url, 'http://x').pathname === '/api/reinitialiser' ? aujourdhui() : semeLe;
      try {
        const nv = await publier(db, version, seme);
        if (nv !== null) { version = nv; semeLe = seme; return r; }
      } catch (e) {
        console.error('Enregistrement impossible :', e.message);
        version = -1; // l'état local n'est plus sûr : il sera rechargé
        return erreur(503, "L'enregistrement a échoué : réessayez dans un instant.");
      }
      // Conflit : une autre instance a écrit entre-temps ; on reprend son état et on rejoue la requête.
    }
    version = -1;
    return erreur(503, 'La plateforme est très sollicitée : réessayez dans un instant.');
  }

  return async function traiter(req, res) {
    const morceaux = [];
    let taille = 0;
    for await (const m of req) {
      taille += m.length;
      if (taille > CORPS_MAX) { const r = erreur(413, 'Envoi trop volumineux.'); return res.writeHead(r.statut, r.entetes).end(r.corps); }
      morceaux.push(m);
    }
    const corps = Buffer.concat(morceaux);
    // Une requête à la fois par instance : la base locale ne change pas sous une requête en cours.
    const tache = file.then(() => executer(req, corps));
    file = tache.catch(() => {});
    const r = await tache;
    res.writeHead(r.statut, r.entetes).end(r.corps);
  };
}
