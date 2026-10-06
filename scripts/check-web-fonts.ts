// Run: node scripts/check-web-fonts.ts
// Offline check that the bundled fonts are intact and nothing asks a server for a font:
// the phone's embedded copy matches the woff2 files, and neither app references Google Fonts.
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { WEB_FONT_LOADS, WEB_FONTS_CSS } from '../phone-app/src/web-fonts-source.ts';

const dir = new URL('../pc-companion/src/fonts/', import.meta.url);
const files = readdirSync(dir).filter((name) => name.endsWith('.woff2'));
assert.ok(files.length >= 5, `expected the font files, found ${files.length}`);
for (const file of files) {
  const bytes = readFileSync(new URL(file, dir));
  assert.equal(bytes.subarray(0, 4).toString('latin1'), 'wOF2', `${file} is not woff2`);
  assert.ok(WEB_FONTS_CSS.includes(bytes.toString('base64')), `${file} is missing from the phone's embedded fonts`);
}
const embedded = WEB_FONTS_CSS.match(/data:font\/woff2;base64,/g)?.length ?? 0;
assert.equal(embedded, files.length, 'the phone embeds a different number of fonts than the desktop bundles');
assert.equal(WEB_FONT_LOADS.length, files.length, 'one load string per font file');
assert.ok(readFileSync(new URL('LICENSE.md', dir), 'utf8').includes('SIL OPEN FONT LICENSE'), 'font LICENSE.md is missing');

const css = readFileSync(new URL('fonts.css', dir), 'utf8');
for (const file of files) assert.ok(css.includes(`./${file}`), `fonts.css does not reference ${file}`);

for (const path of ['../pc-companion/index.html', '../pc-companion/src/main.tsx', '../phone-app/src/web-widgets.tsx', '../phone-app/src/web-widgets-page.ts']) {
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(readFileSync(new URL(path, import.meta.url), 'utf8')), `${path} still asks Google for fonts`);
}
console.log(`web fonts: ${files.length} fonts bundled for both apps, no font requests`);
