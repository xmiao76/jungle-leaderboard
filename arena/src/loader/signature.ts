/**
 * Extract the component-level contract — imported and exported interfaces with fully
 * expanded function signatures — from `wasm-tools print` output.
 *
 * This walks the component index spaces (types, funcs, instances, components) the
 * way the binary defines them, so references by number or `$name` both resolve. It
 * understands the shapes wit-component produces (typed instance imports, exports via
 * an instantiated shim component, or inline instance bags). Anything else renders as
 * `unsupported:…`, which can never equal the canonical contract and so is rejected.
 */
import { head, isList, parseSExpr, type SExpr, type SList } from './sexpr';

export type InterfaceShape = Readonly<Record<string, string>>;
export interface ContractShape {
  /** Interface imports: name → member (function name, or `type:name`) → rendered signature. */
  readonly imports: Readonly<Record<string, InterfaceShape>>;
  readonly exports: Readonly<Record<string, InterfaceShape>>;
  /** Imports or exports that are not interface instances (bare funcs, types, …). */
  readonly otherImports: readonly string[];
  readonly otherExports: readonly string[];
}

type Entry =
  | { readonly kind: 'def'; readonly node: SExpr; readonly scope: Scope }
  | { readonly kind: 'ref'; readonly ref: SExpr; readonly scope: Scope; readonly space: Space }
  | { readonly kind: 'typed'; readonly typeRef: SExpr; readonly scope: Scope }
  | { readonly kind: 'instantiate'; readonly component: SExpr; readonly scope: Scope }
  | { readonly kind: 'inline'; readonly exports: readonly SList[]; readonly scope: Scope }
  | { readonly kind: 'opaque'; readonly why: string };

type Space = 'type' | 'func' | 'instance' | 'component';
const SPACES: readonly Space[] = ['type', 'func', 'instance', 'component'];

interface Scope {
  readonly parent: Scope | null;
  readonly entries: Record<Space, Entry[]>;
  readonly names: Record<Space, Map<string, number>>;
  readonly imports: { name: string; space: Space | 'other'; index: number }[];
  readonly exports: { name: string; space: Space | 'other'; index: number }[];
}

const PRIMITIVES = new Set([
  'bool', 's8', 'u8', 's16', 'u16', 's32', 'u32', 's64', 'u64', 'f32', 'f64', 'float32', 'float64', 'char',
  'string', 'error-context',
]);
const MAX_DEPTH = 64;

function newScope(parent: Scope | null): Scope {
  return {
    parent,
    entries: { type: [], func: [], instance: [], component: [] },
    names: { type: new Map(), func: new Map(), instance: new Map(), component: new Map() },
    imports: [],
    exports: [],
  };
}

function atom(expr: SExpr | undefined): string | undefined {
  return expr?.kind === 'atom' ? expr.value : undefined;
}

function str(expr: SExpr | undefined): string | undefined {
  return expr?.kind === 'string' ? expr.value : undefined;
}

function isSpace(word: string | undefined): word is Space {
  return SPACES.includes(word as Space);
}

function push(scope: Scope, space: Space, entry: Entry, id?: string): number {
  const index = scope.entries[space].length;
  scope.entries[space].push(entry);
  if (id?.startsWith('$')) scope.names[space].set(id, index);
  return index;
}

/** `(sort $id? …rest)` → [id, rest] */
function splitId(items: readonly SExpr[], from: number): [string | undefined, readonly SExpr[]] {
  const maybeId = atom(items[from]);
  return maybeId?.startsWith('$') ? [maybeId, items.slice(from + 1)] : [undefined, items.slice(from)];
}

function lookup(scope: Scope, space: Space, ref: SExpr | undefined): Entry {
  const word = atom(ref);
  if (word === undefined) return { kind: 'opaque', why: `non-index ${space} reference` };
  const index = word.startsWith('$') ? scope.names[space].get(word) : Number(word);
  const entry = index === undefined || Number.isNaN(index) ? undefined : scope.entries[space][index];
  return entry ?? { kind: 'opaque', why: `unknown ${space} ${word}` };
}

/** Describe an import/export target `(sort …)` as an entry in its index space. */
function externEntry(desc: SList, scope: Scope): [Space | 'other', Entry, string | undefined] {
  const sort = head(desc);
  const [id, rest] = splitId(desc.items, 1);
  if (sort === 'instance') {
    const typeUse = rest.find((x) => isList(x, 'type'));
    if (typeUse && rest.length === 1) return ['instance', { kind: 'typed', typeRef: typeUse.items[1]!, scope }, id];
    // Inline instance type: `(instance $id (export …) …)`.
    return ['instance', { kind: 'def', node: { kind: 'list', items: [{ kind: 'atom', value: 'instance' }, ...rest] }, scope }, id];
  }
  if (sort === 'func') {
    const typeUse = rest.find((x) => isList(x, 'type'));
    return ['func', typeUse ? { kind: 'typed', typeRef: typeUse.items[1]!, scope } : { kind: 'opaque', why: 'untyped func' }, id];
  }
  if (sort === 'type') {
    const bound = rest[0];
    if (isList(bound, 'eq')) return ['type', { kind: 'ref', ref: bound.items[1]!, scope, space: 'type' }, id];
    return ['type', { kind: 'opaque', why: 'abstract type' }, id];
  }
  if (sort === 'component') return ['component', { kind: 'opaque', why: 'imported component' }, id];
  return ['other', { kind: 'opaque', why: `${sort ?? '?'} extern` }, id];
}

function walkComponent(items: readonly SExpr[], scope: Scope): void {
  for (const field of items) {
    if (!isList(field)) continue;
    const kw = head(field);
    switch (kw) {
      case 'type': {
        const [id, rest] = splitId(field.items, 1);
        push(scope, 'type', { kind: 'def', node: rest[rest.length - 1]!, scope }, id);
        break;
      }
      case 'import': {
        const name = str(field.items[1]) ?? '';
        const desc = field.items[2];
        if (!isList(desc)) break;
        const [space, entry, id] = externEntry(desc, scope);
        const index = space === 'other' ? -1 : push(scope, space, entry, id);
        scope.imports.push({ name, space, index });
        break;
      }
      case 'alias': {
        const target = field.items[field.items.length - 1];
        const sort = head(target);
        if (atom(field.items[1]) === 'core' || !isList(target) || !isSpace(sort)) break;
        const [id] = splitId(target.items, 1);
        if (atom(field.items[1]) === 'outer') {
          const depth = Number(atom(field.items[2]));
          let outer: Scope | null = scope;
          for (let d = 0; d < depth && outer; d += 1) outer = outer.parent;
          const entry: Entry = outer ? lookup(outer, sort, field.items[3]) : { kind: 'opaque', why: 'bad outer alias' };
          push(scope, sort, entry, id);
        } else {
          push(scope, sort, { kind: 'opaque', why: 'alias of an instance export' }, id);
        }
        break;
      }
      case 'func': {
        const [id, rest] = splitId(field.items, 1);
        const typeUse = rest.find((x) => isList(x, 'type'));
        push(scope, 'func', typeUse ? { kind: 'typed', typeRef: typeUse.items[1]!, scope } : { kind: 'opaque', why: 'func without type' }, id);
        break;
      }
      case 'component': {
        const [id] = splitId(field.items, 1);
        push(scope, 'component', { kind: 'def', node: field, scope }, id);
        break;
      }
      case 'instance': {
        const [id, rest] = splitId(field.items, 1);
        const inst = rest.find((x) => isList(x, 'instantiate'));
        const entry: Entry = inst
          ? { kind: 'instantiate', component: inst.items[1]!, scope }
          : { kind: 'inline', exports: rest.filter((x): x is SList => isList(x, 'export')), scope };
        push(scope, 'instance', entry, id);
        break;
      }
      case 'export': {
        const [id, rest] = splitId(field.items, 1);
        const name = str(rest[0]) ?? '';
        const target = rest[1];
        const sort = head(target);
        if (!isList(target) || !isSpace(sort)) {
          scope.exports.push({ name, space: 'other', index: -1 });
          break;
        }
        const ascription = rest[2];
        let entry: Entry = { kind: 'ref', ref: target.items[1]!, scope, space: sort };
        if (sort === 'func' && isList(ascription, 'func')) {
          const typeUse = ascription.items.find((x) => isList(x, 'type'));
          if (isList(typeUse)) entry = { kind: 'typed', typeRef: typeUse.items[1]!, scope };
        }
        const index = push(scope, sort, entry, id);
        scope.exports.push({ name, space: sort, index });
        break;
      }
      default:
        break; // core items, start, value, custom sections: no type information we need
    }
  }
}

function resolve(entry: Entry, depth: number): Entry {
  let current = entry;
  for (let d = depth; current.kind === 'ref'; d += 1) {
    if (d > MAX_DEPTH) return { kind: 'opaque', why: 'reference cycle' };
    current = lookup(current.scope, current.space, current.ref);
  }
  return current;
}

/** Longest rendered signature accepted; real contracts are a few hundred characters. */
const MAX_RENDERED_CHARS = 64 * 1024;

export class ContractTooComplexError extends Error {
  override readonly name = 'ContractTooComplexError';
  constructor() {
    super('A type in this component is too large to compare with the contract.');
  }
}

/** Rendered strings per definition node: each definition is expanded once. */
const rendered = new WeakMap<object, string>();

function capped(text: string): string {
  if (text.length > MAX_RENDERED_CHARS) throw new ContractTooComplexError();
  return text;
}

function renderType(ref: SExpr | undefined, scope: Scope, depth: number): string {
  if (depth > MAX_DEPTH) return 'unsupported:depth';
  const word = atom(ref);
  if (word !== undefined && PRIMITIVES.has(word)) return word;
  if (isList(ref)) return renderDef(ref, scope, depth + 1);
  const entry = resolve(lookup(scope, 'type', ref), depth);
  if (entry.kind === 'def') return renderDef(entry.node, entry.scope, depth + 1);
  return `unsupported:${entry.kind === 'opaque' ? entry.why : entry.kind}`;
}

function renderDef(node: SExpr, scope: Scope, depth: number): string {
  const word = atom(node);
  if (word !== undefined) return PRIMITIVES.has(word) ? word : `unsupported:${word}`;
  if (!isList(node)) return 'unsupported:literal';
  const cached = rendered.get(node);
  if (cached !== undefined) return cached;
  const text = capped(renderDefUncached(node, scope, depth));
  rendered.set(node, text);
  return text;
}

/** Any bare keyword after the head (e.g. `async`, a fixed list length) is a construct we do not model. */
function hasUnmodeledAtoms(items: readonly SExpr[], allowed: number): boolean {
  return items.slice(1).some((x) => x.kind === 'atom') || items.length - 1 > allowed;
}

function renderDefUncached(node: SList, scope: Scope, depth: number): string {
  const items = node.items;
  const t = (x: SExpr | undefined) => renderType(x, scope, depth);
  const kind = head(node) ?? '?';
  switch (kind) {
    case 'enum':
    case 'flags':
      if (!items.slice(1).every((x) => x.kind === 'string')) return `unsupported:${kind}`;
      return `${kind}{${items.slice(1).map((x) => str(x)).join(',')}}`;
    case 'record':
      if (!items.slice(1).every((x) => isList(x, 'field'))) return 'unsupported:record';
      return `record{${(items.slice(1) as SList[]).map((f) => `${str(f.items[1])}:${t(f.items[2])}`).join(',')}}`;
    case 'variant':
      if (!items.slice(1).every((x) => isList(x, 'case'))) return 'unsupported:variant';
      return `variant{${(items.slice(1) as SList[])
        .map((c) => {
          const [, rest] = splitId(c.items, 1);
          return rest[1] === undefined ? `${str(rest[0])}` : `${str(rest[0])}(${t(rest[1])})`;
        })
        .join(',')}}`;
    case 'list':
      // `(list T N)` is a fixed-size list, a different type from `list<T>`.
      return items.length === 2 ? `list<${t(items[1])}>` : 'unsupported:fixed-size-list';
    case 'option':
      return items.length === 2 ? `option<${t(items[1])}>` : 'unsupported:option';
    case 'tuple':
      return `tuple<${items.slice(1).map(t).join(',')}>`;
    case 'result': {
      const ok = items.slice(1).find((x) => !isList(x, 'error'));
      const err = items.find((x): x is SList => isList(x, 'error'));
      return `result<${ok ? t(ok) : '_'},${err ? t(err.items[1]) : '_'}>`;
    }
    case 'func': {
      // `(func async …)` and any other modifier change the calling convention.
      if (hasUnmodeledAtoms(items, Number.POSITIVE_INFINITY)) return 'unsupported:func-modifier';
      if (!items.slice(1).every((x) => isList(x, 'param') || isList(x, 'result'))) return 'unsupported:func';
      const params = items.filter((x): x is SList => isList(x, 'param')).map((p) => `${str(p.items[1])}: ${t(p.items[2])}`);
      const results = items.filter((x): x is SList => isList(x, 'result'));
      if (results.length > 1) return 'unsupported:multiple-results';
      const result = results[0];
      return `func(${params.join(', ')})${result ? ` -> ${t(result.items[result.items.length - 1])}` : ''}`;
    }
    default:
      return `unsupported:${kind}`;
  }
}

/** Key for a type export, so type and function names never collide. */
const typeKey = (name: string) => `type:${name}`;

/** Exports of an instance *type*: functions by name, types as `type:name`. */
function instanceTypeExports(node: SExpr, scope: Scope, depth: number): Record<string, string> | null {
  if (!isList(node, 'instance')) return null;
  const inner = newScope(scope);
  const shape: Record<string, string> = {};
  for (const decl of node.items.slice(1)) {
    if (!isList(decl)) continue;
    const kw = head(decl);
    if (kw === 'type' || kw === 'alias') {
      walkComponent([decl], inner);
    } else if (kw === 'export') {
      const name = str(decl.items[1]) ?? '';
      const desc = decl.items[2];
      if (!isList(desc)) continue;
      const [space, entry, id] = externEntry(desc, inner);
      if (space === 'func') {
        shape[name] = entry.kind === 'typed' ? renderType(entry.typeRef, inner, depth) : 'unsupported:untyped';
        continue;
      }
      if (space === 'other') {
        shape[`other:${name}`] = 'unsupported:extern';
        continue;
      }
      const index = push(inner, space, entry, id);
      if (space === 'type') shape[typeKey(name)] = typeExportSignature(inner, index, depth);
      else shape[`other:${name}`] = `unsupported:${space}`;
    }
  }
  return shape;
}

function typeExportSignature(scope: Scope, index: number, depth: number): string {
  const entry = resolve(scope.entries.type[index]!, depth);
  if (entry.kind === 'def') return renderDef(entry.node, entry.scope, depth + 1);
  return `unsupported:${entry.kind === 'opaque' ? entry.why : entry.kind}`;
}

function funcSignature(entry: Entry, depth: number): string {
  const resolved = resolve(entry, depth);
  if (resolved.kind === 'typed') return renderType(resolved.typeRef, resolved.scope, depth);
  return `unsupported:${resolved.kind === 'opaque' ? resolved.why : resolved.kind}`;
}

/** Exports of a concrete instance (imported, instantiated, or an inline bag). */
function instanceExports(entry: Entry, depth: number): Record<string, string> | null {
  if (depth > MAX_DEPTH) return null;
  const resolved = resolve(entry, depth);
  if (resolved.kind === 'typed') {
    const typeEntry = resolve(lookup(resolved.scope, 'type', resolved.typeRef), depth);
    return typeEntry.kind === 'def' ? instanceTypeExports(typeEntry.node, typeEntry.scope, depth + 1) : null;
  }
  if (resolved.kind === 'def') return instanceTypeExports(resolved.node, resolved.scope, depth + 1);
  if (resolved.kind === 'inline') {
    const shape: Record<string, string> = {};
    for (const exp of resolved.exports) {
      const name = str(exp.items[1]) ?? '';
      const target = exp.items[2];
      const sort = head(target);
      if (isList(target) && sort === 'func') {
        shape[name] = funcSignature({ kind: 'ref', ref: target.items[1]!, scope: resolved.scope, space: 'func' }, depth + 1);
      } else if (isList(target) && sort === 'type') {
        const typeEntry = resolve({ kind: 'ref', ref: target.items[1]!, scope: resolved.scope, space: 'type' }, depth);
        shape[typeKey(name)] = typeEntry.kind === 'def' ? renderDef(typeEntry.node, typeEntry.scope, depth + 1) : 'unsupported:type';
      } else shape[`other:${name}`] = `unsupported:${sort ?? 'extern'}`;
    }
    return shape;
  }
  if (resolved.kind === 'instantiate') {
    const comp = resolve(lookup(resolved.scope, 'component', resolved.component), depth);
    if (comp.kind !== 'def' || !isList(comp.node)) return null;
    const inner = newScope(comp.scope);
    const [, body] = splitId(comp.node.items, 1);
    walkComponent(body, inner);
    const shape: Record<string, string> = {};
    for (const exp of inner.exports) {
      if (exp.space === 'func') shape[exp.name] = funcSignature(inner.entries.func[exp.index]!, depth + 1);
      else if (exp.space === 'type') shape[typeKey(exp.name)] = typeExportSignature(inner, exp.index, depth);
      else shape[`other:${exp.name}`] = `unsupported:${exp.space}`;
    }
    return shape;
  }
  return null;
}

function sorted(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

export function extractContract(wat: string): ContractShape {
  const root = parseSExpr(wat);
  const component = root.items.find((x): x is SList => isList(x, 'component'));
  if (!component) throw new Error('The printed module is not a component');

  const scope = newScope(null);
  const [, body] = splitId(component.items, 1);
  walkComponent(body, scope);

  const imports: Record<string, InterfaceShape> = {};
  const exports: Record<string, InterfaceShape> = {};
  const otherImports: string[] = [];
  const otherExports: string[] = [];

  for (const imp of scope.imports) {
    const funcs = imp.space === 'instance' ? instanceExports(scope.entries.instance[imp.index]!, 0) : null;
    if (funcs) imports[imp.name] = sorted(funcs);
    else otherImports.push(imp.name);
  }
  for (const exp of scope.exports) {
    const funcs = exp.space === 'instance' ? instanceExports(scope.entries.instance[exp.index]!, 0) : null;
    if (funcs) exports[exp.name] = sorted(funcs);
    else otherExports.push(exp.name);
  }
  return { imports, exports, otherImports, otherExports };
}
