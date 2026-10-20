// Renders assets/icon.svg to the PNG sizes the manifest uses (public/icon/*.png).
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const svg = readFileSync(new URL('assets/icon.svg', root), 'utf8');
mkdirSync(new URL('public/icon/', root), { recursive: true });

for (const size of [16, 32, 48, 96, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(new URL(`public/icon/${size}.png`, root), png);
}
console.log('icons written to public/icon/');
