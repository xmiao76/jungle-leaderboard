/**
 * Replace every core module inside a component binary with an empty module.
 *
 * Contract checking only needs component-level types, but printing a component to
 * WAT also prints every core function body and data segment — megabytes of text for a
 * large entrant. Index spaces are unchanged (one module still occupies each slot), so
 * the printed component-level structure is identical. The result is for printing
 * only; it is never instantiated.
 */

const CORE_MODULE_SECTION = 1;
const COMPONENT_SECTION = 4;
const EMPTY_CORE_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const COMPONENT_PREAMBLE = [0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00] as const;
/** Far above any real component; bounds the work a hostile file can cause. */
const MAX_SECTIONS = 50_000;

export class MalformedComponentError extends Error {
  override readonly name = 'MalformedComponentError';
}

export function isComponentBinary(bytes: Uint8Array): boolean {
  return COMPONENT_PREAMBLE.every((b, i) => bytes[i] === b);
}

export function isCoreModuleBinary(bytes: Uint8Array): boolean {
  return EMPTY_CORE_MODULE.every((b, i) => bytes[i] === b);
}

function readU32Leb(bytes: Uint8Array, offset: number): [value: number, next: number] {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= bytes.length) throw new MalformedComponentError('Truncated section size');
    const byte = bytes[pos]!;
    pos += 1;
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 28) throw new MalformedComponentError('Section size LEB128 is too long');
  }
  return [result, pos];
}

function writeU32Leb(value: number): number[] {
  const out: number[] = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v = Math.floor(v / 128);
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

export function stripCoreModules(bytes: Uint8Array, depth = 0, budget = { sections: 0 }): Uint8Array {
  if (depth > 16) throw new MalformedComponentError('Components are nested too deeply');
  if (!isComponentBinary(bytes)) throw new MalformedComponentError('Not a component binary');

  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let pos = 8;
  while (pos < bytes.length) {
    budget.sections += 1;
    if (budget.sections > MAX_SECTIONS) throw new MalformedComponentError(`More than ${MAX_SECTIONS} sections`);
    const id = bytes[pos]!;
    const [size, contentStart] = readU32Leb(bytes, pos + 1);
    const end = contentStart + size;
    if (end > bytes.length) throw new MalformedComponentError('Section runs past the end of the file');

    if (id === CORE_MODULE_SECTION || id === COMPONENT_SECTION) {
      const inner = bytes.subarray(contentStart, end);
      if (inner.length < 8) throw new MalformedComponentError('A nested module or component is truncated');
      const replaced = id === CORE_MODULE_SECTION ? EMPTY_CORE_MODULE : stripCoreModules(inner, depth + 1, budget);
      parts.push(new Uint8Array([id, ...writeU32Leb(replaced.length)]), replaced);
    } else {
      parts.push(bytes.subarray(pos, end));
    }
    pos = end;
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
