/**
 * Compare a component's extracted contract with the canonical one and explain every
 * difference in terms an entrant author can act on.
 */
import canonical from './canonical-contract.json';
import type { ContractShape, InterfaceShape } from './signature';

export const DISPLAY_INTERFACE = 'jungle:arena/display@1.0.0';
export const GAME_INTERFACE = 'jungle:arena/game@1.0.0';
export const WORLD = 'jungle:arena/competitor@1.0.0';

/** Generated from wit/jungle.wit by contract.test.ts; see that test to regenerate. */
export const CANONICAL_CONTRACT: ContractShape = canonical;

/**
 * The one designed exception to exact matching: metadata gained an optional `model-platform`
 * field, and binaries built before it (the 9-field record below) stay admissible — their
 * platform normalizes to '' in checkMetadata. Both members must match the legacy pair
 * together; a mixed old/new record is still rejected like any other type change.
 */
const LEGACY_METADATA = 'title:string,game-version:string,model:string,code-agent:string,github-url:string,engine-version:string,runtime:string,rules-id:string,rules-digest:string';
export const LEGACY_METADATA_SIGNATURES: Readonly<Record<string, string>> = {
  info: `func() -> record{${LEGACY_METADATA}}`,
  'type:metadata': `record{${LEGACY_METADATA}}`,
};

/** Rewrite a legacy metadata pair to the canonical signatures, leaving every other shape untouched. */
function withLegacyMetadata(actual: ContractShape, expected: ContractShape): ContractShape {
  const game = actual.exports[GAME_INTERFACE];
  const canonicalGame = expected.exports[GAME_INTERFACE];
  if (!game || !canonicalGame) return actual;
  const isLegacy = Object.entries(LEGACY_METADATA_SIGNATURES).every(([key, signature]) => game[key] === signature);
  if (!isLegacy) return actual;
  const rewritten: Record<string, string> = { ...game };
  for (const key of Object.keys(LEGACY_METADATA_SIGNATURES)) rewritten[key] = canonicalGame[key]!;
  return { ...actual, exports: { ...actual.exports, [GAME_INTERFACE]: rewritten } };
}

/** Members are functions by name, or types as `type:name`. */
function member(key: string): string {
  if (key.startsWith('type:')) return `type "${key.slice(5)}"`;
  if (key.startsWith('other:')) return `member "${key.slice(6)}"`;
  return `function "${key}"`;
}

function compareInterface(kind: 'import' | 'export', name: string, actual: InterfaceShape, expected: InterfaceShape): string[] {
  const issues: string[] = [];
  for (const [key, signature] of Object.entries(expected)) {
    const found = actual[key];
    if (found === undefined) issues.push(`${kind} ${name} is missing ${member(key)} (expected ${signature}).`);
    else if (found !== signature) {
      issues.push(`${kind} ${name} ${member(key)} has the wrong type.\n  expected ${signature}\n  found    ${found}`);
    }
  }
  for (const key of Object.keys(actual)) {
    if (!(key in expected)) issues.push(`${kind} ${name} has an unexpected ${member(key)}.`);
  }
  return issues;
}

/** Every way `actual` departs from the contract; an empty list means it conforms. */
export function contractIssues(shape: ContractShape, expected: ContractShape = CANONICAL_CONTRACT): string[] {
  const actual = withLegacyMetadata(shape, expected);
  const issues: string[] = [];

  for (const name of Object.keys(actual.imports)) {
    if (!(name in expected.imports)) {
      issues.push(
        `Imports ${name}, which the Arena does not supply. The only host capability is ${DISPLAY_INTERFACE}; ` +
          'remove the dependency (WASI imports usually come from the language runtime or an adapter).',
      );
    }
  }
  for (const name of actual.otherImports) issues.push(`Imports "${name}" outside any interface; only ${DISPLAY_INTERFACE} is supplied.`);
  for (const [name, shape] of Object.entries(expected.imports)) {
    const found = actual.imports[name];
    if (found) issues.push(...compareInterface('import', name, found, shape));
  }

  for (const [name, shape] of Object.entries(expected.exports)) {
    const found = actual.exports[name];
    if (!found) {
      issues.push(`Does not export ${name}. Build the ${WORLD} world from wit/jungle.wit.`);
    } else issues.push(...compareInterface('export', name, found, shape));
  }
  for (const name of [...Object.keys(actual.exports), ...actual.otherExports]) {
    if (!(name in expected.exports)) issues.push(`Exports "${name}", which is not part of ${WORLD}.`);
  }
  return issues;
}
