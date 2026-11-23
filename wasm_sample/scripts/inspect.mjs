// Inspect a built entrant: hash, size, embedded WIT, imports/exports, and info().
//   node scripts/inspect.mjs [dist/jungle-claude-opus-5-5-claudecode-official-1.1.0.wasm]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { transpileBytes } from '@bytecodealliance/jco-transpile';
import { componentWit } from '@bytecodealliance/jco-transpile/wasm-tools';

const file = process.argv[2] ?? 'dist/jungle-claude-opus-5-5-claudecode-official-1.1.0.wasm';
const bytes = new Uint8Array(readFileSync(file));
console.log(`file     ${file}`);
console.log(`size     ${bytes.length} bytes`);
console.log(`sha256   ${createHash('sha256').update(bytes).digest('hex')}`);
console.log(`\nembedded WIT:\n${await componentWit(bytes)}`);

const t = await transpileBytes(bytes, { name: 'c', instantiation: 'async', emitTypescriptDeclarations: false, nodejsCompat: false });
console.log(`imports  ${t.imports.join(', ')}`);
console.log(`exports  ${t.exports.map(([n]) => n).join(', ')}`);
const mod = await import(`data:text/javascript;base64,${Buffer.from(t.files['c.js']).toString('base64')}`);
const exports = await mod.instantiate((p) => WebAssembly.compile(t.files[p]), { 'jungle:arena/display': { present() {} } });
console.log('\ninfo():', (exports['jungle:arena/game@1.0.0'] ?? exports.game).info());
