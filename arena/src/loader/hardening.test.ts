// Regression tests for the loader findings of the first code review.
import { describe, expect, it } from 'vitest';
import { checkMetadata } from './metadata';
import { METADATA } from '../match/fakes.test-support';
import { ContractTooComplexError, extractContract } from './signature';
import { MalformedComponentError, stripCoreModules } from './strip';

const PREAMBLE = [0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00];

const importOf = (body: string) => `(component
  (type (;0;) (instance ${body}))
  (import "jungle:arena/display@1.0.0" (instance (;0;) (type 0)))
)`;

describe('stripCoreModules resource limits', () => {
  it('rejects a file made of tens of thousands of empty sections', () => {
    const bytes = new Uint8Array(PREAMBLE.length + 2 * 60_000);
    bytes.set(PREAMBLE);
    expect(() => stripCoreModules(bytes)).toThrow(MalformedComponentError);
  });

  it('rejects a nested module shorter than a module header', () => {
    expect(() => stripCoreModules(new Uint8Array([...PREAMBLE, 0x01, 0x02, 0x00, 0x61]))).toThrow(/truncated/);
  });
});

describe('extractContract never renders a non-canonical form as canonical', () => {
  it('marks an async function as unsupported', () => {
    const shape = extractContract(importOf('(type (;0;) (func async (param "x" u32))) (export (;0;) "present" (func (type 0)))'));
    expect(shape.imports['jungle:arena/display@1.0.0']!['present']).toBe('unsupported:func-modifier');
  });

  it('distinguishes a fixed-size list from list<T>', () => {
    const shape = extractContract(
      importOf('(type (;0;) (list u8 4)) (type (;1;) (func (param "rgba" 0))) (export (;0;) "present" (func (type 1)))'),
    );
    expect(shape.imports['jungle:arena/display@1.0.0']!['present']).toBe('func(rgba: unsupported:fixed-size-list)');
  });

  it('reports extra type exports on an imported instance', () => {
    const shape = extractContract(importOf('(type (;0;) (enum "a")) (export (;1;) "extra" (type (eq 0)))'));
    expect(shape.imports['jungle:arena/display@1.0.0']!['type:extra']).toBe('enum{a}');
  });

  it('stops an exponentially large type instead of expanding it', () => {
    const defs = ['(type (;0;) (tuple u8 u8))'];
    for (let i = 1; i <= 24; i += 1) defs.push(`(type (;${i};) (tuple ${i - 1} ${i - 1}))`);
    defs.push('(type (;25;) (func (param "x" 24)))', '(export (;0;) "present" (func (type 25)))');
    const started = performance.now();
    expect(() => extractContract(importOf(defs.join(' ')))).toThrow(ContractTooComplexError);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('metadata identity', () => {
  it('compares the rules identity on raw strings, before sanitizing', () => {
    const check = checkMetadata({ ...METADATA, rulesId: `${METADATA.rulesId}\u0000` });
    expect(check.rulesCompatible).toBe(false);
    expect(check.issues.join()).toMatch(/Rules ID/);
  });

  it('requires githubUrl to be a GitHub repository URL', () => {
    expect(checkMetadata(METADATA).issues).toEqual([]);
    for (const githubUrl of ['https://example.com/a/b', 'http://github.com/a/b', 'https://github.com/onlyowner', 'github.com/a/b', 'https://github.com/a/b/tree/main', '']) {
      const check = checkMetadata({ ...METADATA, githubUrl });
      expect(check.issues.join(), githubUrl).toMatch(/githubUrl/);
    }
    const { githubUrl: _dropped, ...without } = METADATA;
    expect(checkMetadata(without).issues.join()).toMatch(/githubUrl/);
  });

  it('strips zero-width and bidi characters from displayed text', () => {
    const check = checkMetadata({ ...METADATA, title: 'Tit​le‮ ' });
    expect(check.metadata?.title).toBe('Title');
  });
});
