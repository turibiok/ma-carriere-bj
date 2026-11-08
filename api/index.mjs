// Démonstration en ligne (Vercel) : la même API que server.mjs, dans une fonction.
// L'hébergeur peut lancer plusieurs instances en parallèle. Avec DATABASE_URL (base Neon),
// elles partagent un même état (src/persistance.mjs) ; sans elle, chaque instance garde
// ses propres données en mémoire. Les fichiers de public/ sont servis directement par l'hébergeur.
import { ouvrir } from '../src/db.mjs';
import { creerApi } from '../src/api.mjs';
import { creerApiPartagee, stockageNeon } from '../src/persistance.mjs';

const api = process.env.DATABASE_URL
  ? creerApiPartagee(stockageNeon(process.env.DATABASE_URL), { dureeJours: Number(process.env.DUREE_DEMO_JOURS) || 7 })
  : creerApi(ouvrir(':memory:'));

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
