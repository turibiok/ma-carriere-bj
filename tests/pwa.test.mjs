// Application mobile installable : manifeste, icônes et fichiers mis en cache par le service worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const publicDir = new URL('../public/', import.meta.url);
const lire = (chemin) => readFileSync(new URL(chemin.replace(/^\//, ''), publicDir));

test('manifeste : les champs exigés pour installer l\'application sont présents', () => {
  const m = JSON.parse(lire('manifest.webmanifest'));
  assert.equal(m.name, 'Ma Carrière BJ');
  assert.ok(m.short_name.length <= 12, 'nom court lisible sous l\'icône');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.equal(m.lang, 'fr');
  for (const taille of ['192x192', '512x512']) assert.ok(m.icons.some((i) => i.sizes === taille && i.purpose === 'any'), `icône ${taille}`);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'icône adaptable (Android)');
});

test('icônes : de vrais PNG aux dimensions annoncées', () => {
  const m = JSON.parse(lire('manifest.webmanifest'));
  for (const icone of [...m.icons, { src: '/icones/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = lire(icone.src);
    assert.equal(png.subarray(1, 4).toString(), 'PNG', icone.src);
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icone.sizes, icone.src);
  }
});

test('service worker : chaque fichier mis en cache existe, l\'API n\'est jamais mise en cache', () => {
  const sw = lire('sw.js').toString();
  const coquille = JSON.parse(sw.match(/const COQUILLE = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"').replace(/,\s*\]/, ']'));
  for (const f of coquille) assert.ok(f === '/' || existsSync(new URL(f.slice(1), publicDir)), f);
  assert.match(sw, /startsWith\('\/api\/'\)\) return;/);
});
