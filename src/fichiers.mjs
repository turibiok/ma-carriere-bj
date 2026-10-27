// Contrôle des fichiers déposés (justificatifs, pièces jointes) : PDF, JPEG ou PNG,
// 2 Mo au plus. Le type réel est lu dans les premiers octets, jamais dans l'extension
// ni dans la déclaration du navigateur.

import { ErreurMetier } from './services.mjs';

export const TAILLE_MAX = 2 * 1024 * 1024;

function typeReel(octets) {
  if (octets.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (octets[0] === 0x89 && octets.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'image/jpeg';
  return null;
}

// f : { nom, contenu (base64) } → { nom, mime, octets }
export function lireFichier(f, libelle) {
  const octets = Buffer.from(String(f?.contenu ?? ''), 'base64');
  if (!octets.length) throw new ErreurMetier(`Fichier vide : ${libelle}.`);
  if (octets.length > TAILLE_MAX) throw new ErreurMetier(`Fichier trop volumineux (2 Mo au plus) : ${libelle}.`);
  const mime = typeReel(octets);
  if (!mime) throw new ErreurMetier(`Format non accepté (PDF, JPEG ou PNG) : ${libelle}.`);
  const nom = String(f.nom ?? '').replace(/\s+/g, ' ').trim().slice(0, 100).replace(/[^\w.\- ()À-ÿ]/g, '_') || 'document';
  return { nom, mime, octets };
}

// Range un document dans la table `documents` et renvoie son identifiant.
export function enregistrerDocument(db, { agent_id = null, demande_id = null, type_piece, fichier, depose_le }) {
  const r = db.prepare(`INSERT INTO documents (agent_id, demande_id, type_piece, nom_fichier, mime, taille, contenu, depose_le)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(agent_id, demande_id, type_piece, fichier.nom, fichier.mime, fichier.octets.length, fichier.octets, depose_le);
  return Number(r.lastInsertRowid);
}
