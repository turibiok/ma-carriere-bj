// Démonstration en ligne (Vercel) : la même API que server.mjs, dans une fonction.
// Chaque instance recrée en mémoire les données de démonstration à son démarrage ;
// les fichiers de public/ sont servis directement par l'hébergeur.
import { ouvrir } from '../src/db.mjs';
import { creerApi } from '../src/api.mjs';

const api = creerApi(ouvrir(':memory:'));

export default function traiter(req, res) {
  // vercel.json réécrit /api/<chemin> vers cette fonction en passant le chemin d'origine.
  const url = new URL(req.url, 'http://x');
  const chemin = url.searchParams.get('__chemin');
  if (chemin !== null) {
    url.searchParams.delete('__chemin');
    req.url = `/api/${chemin}${url.search}`;
  }
  return api(req, res);
}
