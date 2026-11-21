// One-time download of third-party artwork, pinned by URL and verified by SHA-256.
// The files are committed under assets/, so builds never need the network.
//
//   node scripts/fetch-assets.mjs           # verify existing files (download missing ones)
//   node scripts/fetch-assets.mjs --pin     # (re)record hashes after an intentional change
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES = join(ROOT, 'assets', 'SOURCES.json');

// Twemoji 15.1.0 (jdecked fork), graphics licensed CC-BY 4.0.
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg';
const FILES = {
  'animals/rat.svg': `${TWEMOJI}/1f400.svg`,
  'animals/cat.svg': `${TWEMOJI}/1f431.svg`,
  'animals/dog.svg': `${TWEMOJI}/1f436.svg`,
  'animals/wolf.svg': `${TWEMOJI}/1f43a.svg`,
  'animals/leopard.svg': `${TWEMOJI}/1f406.svg`,
  'animals/tiger.svg': `${TWEMOJI}/1f42f.svg`,
  'animals/lion.svg': `${TWEMOJI}/1f981.svg`,
  'animals/elephant.svg': `${TWEMOJI}/1f418.svg`,
  // IBM Plex Sans Bold, SIL Open Font License 1.1. Used only at build time to rasterize labels.
  'fonts/IBMPlexSans-Bold.ttf': 'https://cdn.jsdelivr.net/gh/IBM/plex@v6.4.0/IBM-Plex-Sans/fonts/complete/ttf/IBMPlexSans-Bold.ttf',
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pinned = existsSync(SOURCES) ? JSON.parse(readFileSync(SOURCES, 'utf8')) : {};
const pin = process.argv.includes('--pin') || Object.keys(pinned).length === 0;
const record = {};

for (const [file, url] of Object.entries(FILES)) {
  const path = join(ROOT, 'assets', file);
  let bytes = existsSync(path) ? readFileSync(path) : null;
  if (!bytes) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    writeFileSync(path, bytes);
    console.log(`downloaded ${file}`);
  }
  const hash = sha256(bytes);
  if (!pin && pinned[file]?.sha256 !== hash) throw new Error(`${file} does not match its pinned SHA-256`);
  record[file] = { url, sha256: hash };
}
if (pin) writeFileSync(SOURCES, `${JSON.stringify(record, null, 2)}\n`);
console.log(`${Object.keys(record).length} assets ${pin ? 'pinned' : 'verified'}`);
