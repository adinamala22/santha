// Copies design-system sources into the web app so there is exactly one source of truth
// (design/). Outputs are git-ignored; run automatically before dev/build/test.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const design = resolve(web, '../../design');

const copies = [
  ['tokens/tokens.css', 'src/app/styles/tokens.css'],
  ['brand/logo/santha-primary.svg', 'public/brand/santha-primary.svg'],
  ['brand/logo/santha-primary-reverse.svg', 'public/brand/santha-primary-reverse.svg'],
  ['brand/logo/santha-mark.svg', 'public/brand/santha-mark.svg'],
  ['brand/logo/santha-mark-reverse.svg', 'public/brand/santha-mark-reverse.svg'],
  ['brand/app-icon/santha-favicon.svg', 'src/app/icon.svg'],
];

for (const [from, to] of copies) {
  const dest = resolve(web, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(design, from), dest);
}
console.log(`sync-brand: copied ${copies.length} files from design/`);

// MapLibre 6 runs its worker as an ES module next to the library. Bundled by Next, it cannot find it, so the
// worker and the chunk it imports are served from /maplibre/ and the maps call setWorkerUrl (ADR-007).
const maplibre = resolve(web, 'node_modules/maplibre-gl/dist');
for (const f of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  const dest = resolve(web, 'public/maplibre', f);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(resolve(maplibre, f), dest);
}
console.log('sync-brand: copied the MapLibre worker to public/maplibre/');
