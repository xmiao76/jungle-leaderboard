// Rasterize the game's artwork into one RGBA sprite atlas, deflated and embedded in
// the Rust core with include_bytes!. Run after changing any art; the output is
// committed so `cargo build` and `cargo test` never need Node.
//
// Animals: Twemoji (CC-BY 4.0). Tiles: original SVG drawn here. Text: IBM Plex Sans
// Bold (OFL), rasterized at build time only — the font itself is not shipped.
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = join(ROOT, 'assets', 'fonts', 'IBMPlexSans-Bold.ttf');
const OUT = join(ROOT, 'crates', 'jungle-core', 'assets', 'atlas.bin');

export const ANIMALS = ['rat', 'cat', 'dog', 'wolf', 'leopard', 'tiger', 'lion', 'elephant'];
const LABELS = ['Rat', 'Cat', 'Dog', 'Wolf', 'Leopard', 'Tiger', 'Lion', 'Elephant'];
const SIDE = { red: '#c8452f', blue: '#2e5fbf' };

function render(svg) {
  const image = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'IBM Plex Sans' },
    shapeRendering: 2,
    textRendering: 1,
  }).render();
  return { width: image.width, height: image.height, rgba: Buffer.from(image.pixels) };
}

/** Crop fully transparent margins (text is rendered on a generous canvas first). */
function trim(sprite, pad = 1) {
  const { width, height, rgba } = sprite;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] > 0) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) return sprite;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) rgba.copy(out, y * w * 4, ((y + y0) * width + x0) * 4, ((y + y0) * width + x0 + w) * 4);
  return { width: w, height: h, rgba: out };
}

function textSprite(text, size, { fill = '#ffffff', stroke = '#1b2016', strokeWidth = 3, weight = 700 } = {}) {
  const w = Math.ceil(text.length * size * 0.75 + 20);
  const h = Math.ceil(size * 1.6 + 10);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <text x="${w / 2}" y="${size * 1.15 + 4}" text-anchor="middle" font-family="IBM Plex Sans" font-weight="${weight}" font-size="${size}"
      fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" paint-order="stroke">${text}</text></svg>`;
  return trim(render(svg));
}

function animalSprite(kind, size) {
  const src = readFileSync(join(ROOT, 'assets', 'animals', `${kind}.svg`), 'utf8');
  // Twemoji uses viewBox 0 0 36 36; set an explicit pixel size.
  return render(src.replace('<svg ', `<svg width="${size}" height="${size}" `));
}

// ---- Original tile art (64 × 64) ---------------------------------------------------------

const tile = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${body}</svg>`;
const grass = (seed) =>
  Array.from({ length: 7 }, (_, i) => {
    const x = (seed * 13 + i * 23) % 56 + 4;
    const y = (seed * 29 + i * 17) % 52 + 8;
    return `<path d="M${x} ${y} l-2 -5 M${x} ${y} l1 -6 M${x} ${y} l3 -4" stroke="#6f9a4f" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/>`;
  }).join('');
const land = (base, seed) => `<rect width="64" height="64" fill="${base}"/>${grass(seed)}`;

const TILES = {
  'tile-land-a': tile(land('#a9cd84', 1)),
  'tile-land-b': tile(land('#a0c57b', 2)),
  'tile-water': tile(`<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa9d6"/><stop offset="1" stop-color="#3f8cc0"/></linearGradient></defs>
    <rect width="64" height="64" fill="url(#w)"/>
    <path d="M6 18 q6 -5 12 0 t12 0 t12 0 t12 0" fill="none" stroke="#bfe3f5" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
    <path d="M0 36 q6 -5 12 0 t12 0 t12 0 t12 0 t12 0" fill="none" stroke="#bfe3f5" stroke-width="2" stroke-linecap="round" opacity="0.65"/>
    <path d="M8 52 q6 -5 12 0 t12 0 t12 0" fill="none" stroke="#bfe3f5" stroke-width="2" stroke-linecap="round" opacity="0.5"/>`),
};
for (const [side, color] of Object.entries(SIDE)) {
  TILES[`tile-trap-${side}`] = tile(`${land('#a9cd84', 3)}
    <rect x="9" y="9" width="46" height="46" rx="6" fill="#8b6a3e" opacity="0.18"/>
    <g stroke="#7a5a32" stroke-width="2.2" stroke-linecap="round" opacity="0.9">
      <path d="M12 20 L52 20 M12 32 L52 32 M12 44 L52 44 M20 12 L20 52 M32 12 L32 52 M44 12 L44 52"/></g>
    <rect x="9" y="9" width="46" height="46" rx="6" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="5 4"/>`);
  TILES[`tile-den-${side}`] = tile(`${land('#a0c57b', 4)}
    <ellipse cx="32" cy="44" rx="24" ry="9" fill="#5e4a35" opacity="0.35"/>
    <path d="M10 46 Q10 14 32 14 Q54 14 54 46 Z" fill="#8a7a66" stroke="#4d3f30" stroke-width="2"/>
    <path d="M20 46 Q20 26 32 26 Q44 26 44 46 Z" fill="#2c241b"/>
    <path d="M10 46 Q10 14 32 14 Q54 14 54 46" fill="none" stroke="${color}" stroke-width="3"/>`);
}

// ---- Sprite list ----------------------------------------------------------------------------

const sprites = [];
for (const [name, svg] of Object.entries(TILES)) sprites.push([name, render(svg)]);
for (const kind of ANIMALS) sprites.push([`animal-${kind}`, animalSprite(kind, 34)]);
ANIMALS.forEach((kind, i) => sprites.push([`label-${kind}`, textSprite(LABELS[i], 10.5, { strokeWidth: 2.6 })]));
for (const [name, text] of [
  ['banner-red', 'Red wins'],
  ['banner-blue', 'Blue wins'],
  ['banner-draw', 'Draw'],
]) sprites.push([name, textSprite(text, 34, { strokeWidth: 5 })]);
for (const [code, text] of [
  ['den', 'reached the enemy den'],
  ['elimination', 'captured every enemy piece'],
  ['immobilization', 'opponent has no legal move'],
  ['repetition', 'same position three times'],
  ['no-capture', '100 plies without a capture'],
  ['timeout', 'opponent ran out of time'],
  ['trap', 'opponent crashed'],
  ['invalid-move', 'opponent made an invalid move'],
]) sprites.push([`reason-${code}`, textSprite(text, 15, { strokeWidth: 3.5 })]);
sprites.push(['mark', textSprite('Jungle · Claude-Opus-5.5 sample v1.1.0', 9, { fill: '#ffffff', stroke: '#1b2016', strokeWidth: 2.2 })]);

// ---- Pack: "JATL" | u16 version | u16 count | entries | pixels, then raw deflate -------------

const header = [];
const blobs = [];
let offset = 0;
for (const [name, s] of sprites) {
  const nameBytes = Buffer.from(name, 'utf8');
  const entry = Buffer.alloc(1 + nameBytes.length + 8);
  entry.writeUInt8(nameBytes.length, 0);
  nameBytes.copy(entry, 1);
  entry.writeUInt16LE(s.width, 1 + nameBytes.length);
  entry.writeUInt16LE(s.height, 3 + nameBytes.length);
  entry.writeUInt32LE(offset, 5 + nameBytes.length);
  header.push(entry);
  blobs.push(s.rgba);
  offset += s.rgba.length;
}
const prefix = Buffer.alloc(8);
prefix.write('JATL', 0, 'ascii');
prefix.writeUInt16LE(1, 4);
prefix.writeUInt16LE(sprites.length, 6);
const raw = Buffer.concat([prefix, ...header, ...blobs]);
const packed = deflateRawSync(raw, { level: 9 });
writeFileSync(OUT, packed);
console.log(`atlas: ${sprites.length} sprites, ${raw.length} B raw, ${packed.length} B deflated, sha256 ${createHash('sha256').update(packed).digest('hex').slice(0, 16)}`);
for (const [name, s] of sprites) if (name.startsWith('label') || name.startsWith('banner')) console.log(`  ${name.padEnd(16)} ${s.width}×${s.height}`);
