import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ouvrir } from './src/db.mjs';
import { creerApi } from './src/api.mjs';

const racine = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 3800;
const db = ouvrir(join(racine, 'data', 'carrieres.db'));
const api = creerApi(db);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=utf-8',
};

async function servirStatique(req, res) {
  const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const fichier = normalize(join(racine, 'public', chemin === '/' ? 'index.html' : chemin));
  if (!fichier.startsWith(join(racine, 'public'))) { res.writeHead(403).end(); return; }
  try {
    const contenu = await readFile(fichier);
    // Le service worker est relu à chaque visite, pour que les mises à jour arrivent sur les téléphones.
    const entetes = { 'Content-Type': TYPES[extname(fichier)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
    if (chemin === '/sw.js') entetes['Cache-Control'] = 'no-cache';
    res.writeHead(200, entetes).end(contenu);
  } catch {
    // Application monopage : toute route inconnue renvoie l'index.
    const index = await readFile(join(racine, 'public', 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES['.html'] }).end(index);
  }
}

createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) return api(req, res);
  return servirStatique(req, res);
}).listen(PORT, () => {
  console.log(`Ma Carrière BJ (prototype) : http://localhost:${PORT}`);
});
