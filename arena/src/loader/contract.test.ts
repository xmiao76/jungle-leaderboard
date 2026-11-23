import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { componentEmbed, componentNew, print } from '@bytecodealliance/jco-transpile/wasm-tools';
import { beforeAll, describe, expect, it } from 'vitest';
import { CANONICAL_CONTRACT, contractIssues, DISPLAY_INTERFACE, GAME_INTERFACE, LEGACY_METADATA_SIGNATURES } from './contract';
import { extractContract, type ContractShape } from './signature';
import { isComponentBinary, isCoreModuleBinary, MalformedComponentError, stripCoreModules } from './strip';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../test-fixtures/${name}`, import.meta.url)));
const witSource = readFileSync(new URL('../../../wit/jungle.wit', import.meta.url), 'utf8');

async function contractOf(bytes: Uint8Array): Promise<ContractShape> {
  return extractContract(await print(stripCoreModules(bytes)));
}

describe('canonical contract', () => {
  let reference: ContractShape;

  beforeAll(async () => {
    // A dummy component built straight from the WIT is the ground truth.
    const core = await componentEmbed({ witSource, world: 'competitor', dummy: true });
    reference = await contractOf(await componentNew(core));
  });

  it('matches the committed canonical-contract.json (UPDATE_CONTRACT=1 regenerates it)', () => {
    if (process.env['UPDATE_CONTRACT']) {
      const path = fileURLToPath(new URL('./canonical-contract.json', import.meta.url));
      writeFileSync(path, `${JSON.stringify(reference, null, 2)}\n`);
    }
    expect(CANONICAL_CONTRACT).toEqual(reference);
  });

  it('describes exactly one import and one export with every WIT function', () => {
    expect(Object.keys(reference.imports)).toEqual([DISPLAY_INTERFACE]);
    expect(Object.keys(reference.exports)).toEqual([GAME_INTERFACE]);
    const members = Object.keys(reference.exports[GAME_INTERFACE]!);
    expect(members.filter((k) => !k.startsWith('type:'))).toEqual(['choose-move', 'info', 'init', 'render']);
    expect(members.filter((k) => k.startsWith('type:'))).toEqual(
      ['animal', 'level', 'metadata', 'phase', 'piece', 'ply-move', 'settings', 'side', 'snapshot'].map((t) => `type:${t}`),
    );
    expect(reference.exports[GAME_INTERFACE]!['type:side']).toBe('enum{red,blue}');
    expect(reference.imports[DISPLAY_INTERFACE]!['present']).toBe('func(width: u16, height: u16, rgba: list<u8>)');
    expect(reference.exports[GAME_INTERFACE]!['choose-move']).toMatch(/^func\(state: record\{rev:u32,board:list<option<record\{owner:enum\{red,blue\},kind:enum\{rat,cat,dog,wolf,leopard,tiger,lion,elephant\}\}>>.*node-budget: u32\) -> u32$/);
  });
});

describe('contractIssues on built entrants', () => {
  it('accepts the test entrant', async () => {
    const bytes = fixture('test-entrant-1.1.0.wasm');
    expect(contractIssues(await contractOf(bytes))).toEqual([]);
  });

  it('accepts a legacy binary whose metadata predates model-platform', async () => {
    // legacy-metadata.wasm is a preserved pre-field build (test-entrant 1.0.0, 9-field record).
    expect(contractIssues(await contractOf(fixture('legacy-metadata.wasm')))).toEqual([]);
  });

  it('rejects a mixed legacy/canonical metadata pair', () => {
    const game = CANONICAL_CONTRACT.exports[GAME_INTERFACE]!;
    const mixed: ContractShape = {
      ...CANONICAL_CONTRACT,
      exports: { [GAME_INTERFACE]: { ...game, info: LEGACY_METADATA_SIGNATURES['info']! } },
    };
    const issues = contractIssues(mixed);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"info" has the wrong type');
  });

  it('accepts behaviourally broken but type-correct entrants (those fail later, at run time)', async () => {
    for (const name of ['broken-trap.wasm', 'broken-hang.wasm', 'broken-digest.wasm']) {
      expect(contractIssues(await contractOf(fixture(name)))).toEqual([]);
    }
  });

  it('rejects an undeclared import with an actionable reason', async () => {
    const issues = contractIssues(await contractOf(fixture('broken-extra-import.wasm')));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('test:extra/net');
    expect(issues[0]).toContain('does not supply');
  });

  it('reports a signature mismatch function by function', () => {
    const game = CANONICAL_CONTRACT.exports[GAME_INTERFACE]!;
    const tampered: ContractShape = {
      ...CANONICAL_CONTRACT,
      exports: { [GAME_INTERFACE]: { ...game, 'choose-move': game['choose-move']!.replace(/-> u32$/, '-> u64') } },
    };
    const issues = contractIssues(tampered);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"choose-move" has the wrong type');
  });

  it('reports a missing export and a stray export', () => {
    const issues = contractIssues({ imports: CANONICAL_CONTRACT.imports, exports: { 'jungle:arena/game@2.0.0': {} }, otherImports: [], otherExports: ['run'] });
    expect(issues.some((i) => i.startsWith(`Does not export ${GAME_INTERFACE}`))).toBe(true);
    expect(issues.some((i) => i.includes('"jungle:arena/game@2.0.0"'))).toBe(true);
    expect(issues.some((i) => i.includes('"run"'))).toBe(true);
  });
});

describe('binary classification', () => {
  it('tells components from core modules', () => {
    expect(isComponentBinary(fixture('broken-trap.wasm'))).toBe(true);
    expect(isCoreModuleBinary(fixture('core-module.wasm'))).toBe(true);
    expect(isComponentBinary(fixture('core-module.wasm'))).toBe(false);
  });

  it('rejects a truncated component', () => {
    expect(() => stripCoreModules(fixture('truncated.wasm'))).toThrow(MalformedComponentError);
  });

  it('shrinks the printable component without changing its contract', async () => {
    const bytes = fixture('broken-digest.wasm');
    const stripped = stripCoreModules(bytes);
    expect(stripped.length).toBeLessThan(bytes.length / 4);
    expect(await contractOf(bytes)).toEqual(extractContract(await print(bytes)));
  });
});
