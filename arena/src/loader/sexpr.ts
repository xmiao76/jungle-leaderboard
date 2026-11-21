/**
 * A minimal S-expression reader for the WAT that `wasm-tools print` emits. Block
 * comments `(; … ;)`, line comments and annotations `(@…)` are dropped; strings keep
 * their decoded text and are marked so they cannot be mistaken for keywords.
 */

export type SExpr = SAtom | SString | SList;
export interface SAtom {
  readonly kind: 'atom';
  readonly value: string;
}
export interface SString {
  readonly kind: 'string';
  readonly value: string;
}
export interface SList {
  readonly kind: 'list';
  readonly items: readonly SExpr[];
}

export class WatSyntaxError extends Error {
  override readonly name = 'WatSyntaxError';
}

function decodeString(raw: string): string {
  return raw.replace(/\\(["'\\nt]|[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\})/g, (_m, esc: string) => {
    if (esc === 'n') return '\n';
    if (esc === 't') return '\t';
    if (esc.startsWith('u{')) return String.fromCodePoint(parseInt(esc.slice(2, -1), 16));
    if (esc.length === 2 && /^[0-9a-fA-F]{2}$/.test(esc)) return String.fromCharCode(parseInt(esc, 16));
    return esc;
  });
}

export function parseSExpr(text: string): SList {
  const root: SExpr[] = [];
  const stack: SExpr[][] = [root];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i]!;
    if (c === '(' && text[i + 1] === ';') {
      // Block comments may nest.
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === '(' && text[i + 1] === ';') {
          depth += 1;
          i += 2;
        } else if (text[i] === ';' && text[i + 1] === ')') {
          depth -= 1;
          i += 2;
        } else i += 1;
      }
      continue;
    }
    if (c === ';' && text[i + 1] === ';') {
      while (i < n && text[i] !== '\n') i += 1;
      continue;
    }
    if (c === '(') {
      stack.push([]);
      i += 1;
      continue;
    }
    if (c === ')') {
      const items = stack.pop();
      const parent = stack[stack.length - 1];
      if (!items || !parent) throw new WatSyntaxError('Unbalanced parenthesis');
      const head = items[0];
      // Annotations such as (@producers …) carry no type information.
      if (!(head?.kind === 'atom' && head.value.startsWith('@'))) parent.push({ kind: 'list', items });
      i += 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= n) throw new WatSyntaxError('Unterminated string');
      stack[stack.length - 1]!.push({ kind: 'string', value: decodeString(text.slice(i + 1, j)) });
      i = j + 1;
      continue;
    }
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !/[\s()"]/.test(text[j]!)) j += 1;
    stack[stack.length - 1]!.push({ kind: 'atom', value: text.slice(i, j) });
    i = j;
  }

  if (stack.length !== 1) throw new WatSyntaxError('Unbalanced parenthesis at end of input');
  return { kind: 'list', items: root };
}

export function head(expr: SExpr | undefined): string | undefined {
  if (expr?.kind !== 'list') return undefined;
  const first = expr.items[0];
  return first?.kind === 'atom' ? first.value : undefined;
}

export function isList(expr: SExpr | undefined, keyword?: string): expr is SList {
  return expr?.kind === 'list' && (keyword === undefined || head(expr) === keyword);
}
