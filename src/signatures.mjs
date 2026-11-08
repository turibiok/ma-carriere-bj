// Signature manuscrite et cachet importés par les signataires (DRH, gestionnaire RH).
// Ils sont apposés sur chaque acte au moment où il est signé, puis figés dans l'acte :
// changer ou retirer son image ensuite ne modifie aucun acte déjà signé.

import { journaliser } from './db.mjs';
import { lireFichier } from './fichiers.mjs';
import { ErreurMetier, aujourdhui } from './services.mjs';

export const ROLES_SIGNATAIRES = ['drh', 'gestionnaire'];
export const TYPES_IMAGE = { signature: 'SIGNATURE', cachet: 'CACHET' };
export const TAILLE_MAX_IMAGE = 500 * 1024;
const LIBELLES = { SIGNATURE: 'signature', CACHET: 'cachet' };

const dataUri = (ligne) => (ligne ? `data:${ligne.mime};base64,${Buffer.from(ligne.contenu).toString('base64')}` : null);

function typeImage(type) {
  const t = TYPES_IMAGE[type];
  if (!t) throw new ErreurMetier('Type attendu : signature ou cachet');
  return t;
}

function verifierSignataire(user) {
  if (!ROLES_SIGNATAIRES.includes(user.role)) throw new ErreurMetier('Réservé aux signataires des actes', 403);
}

// Signature et cachet du signataire, prêts à afficher ou à apposer (null s'il n'en a pas importé).
export function imagesDuSignataire(db, utilisateurId) {
  const lire = db.prepare('SELECT nom_fichier, mime, contenu, depose_le FROM signatures WHERE utilisateur_id = ? AND type = ?');
  const s = lire.get(utilisateurId, 'SIGNATURE'), c = lire.get(utilisateurId, 'CACHET');
  return {
    signature: dataUri(s), cachet: dataUri(c),
    fichiers: { signature: s ? { nom: s.nom_fichier, depose_le: s.depose_le } : null, cachet: c ? { nom: c.nom_fichier, depose_le: c.depose_le } : null },
  };
}

// f : { nom, contenu (base64) }. Image PNG ou JPEG uniquement, type lu dans les octets.
export function enregistrerImage(db, user, type, f) {
  verifierSignataire(user);
  const t = typeImage(type);
  const libelle = LIBELLES[t];
  const fichier = lireFichier(f, libelle);
  if (!fichier.mime.startsWith('image/')) throw new ErreurMetier(`Format non accepté (PNG ou JPEG) : ${libelle}.`);
  if (fichier.octets.length > TAILLE_MAX_IMAGE) throw new ErreurMetier(`Image trop volumineuse (500 Ko au plus) : ${libelle}.`);
  db.prepare(`INSERT INTO signatures (utilisateur_id, type, nom_fichier, mime, contenu, depose_le) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (utilisateur_id, type) DO UPDATE SET nom_fichier = excluded.nom_fichier, mime = excluded.mime,
    contenu = excluded.contenu, depose_le = excluded.depose_le`)
    .run(user.id, t, fichier.nom, fichier.mime, fichier.octets, aujourdhui());
  journaliser(db, user.nom, libelle === 'signature' ? 'Signature importée' : 'Cachet importé', fichier.nom);
  return imagesDuSignataire(db, user.id);
}

export function retirerImage(db, user, type) {
  verifierSignataire(user);
  const t = typeImage(type);
  const r = db.prepare('DELETE FROM signatures WHERE utilisateur_id = ? AND type = ?').run(user.id, t);
  if (r.changes) journaliser(db, user.nom, t === 'SIGNATURE' ? 'Signature retirée' : 'Cachet retiré');
  return imagesDuSignataire(db, user.id);
}
