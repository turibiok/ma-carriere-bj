import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ouvrir, initialiser } from '../src/db.mjs';

const db = ouvrir(join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'carrieres.db'));
initialiser(db);
console.log('Base de démonstration réinitialisée.');
