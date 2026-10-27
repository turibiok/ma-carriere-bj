// Hachage des mots de passe : scrypt avec un sel aléatoire par compte.
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hacher(motDePasse, sel = randomBytes(16).toString('hex')) {
  return `${sel}:${scryptSync(motDePasse, sel, 32).toString('hex')}`;
}

export function motDePasseValide(motDePasse, stocke) {
  const [sel, empreinte] = stocke.split(':');
  return timingSafeEqual(scryptSync(motDePasse, sel, 32), Buffer.from(empreinte, 'hex'));
}
