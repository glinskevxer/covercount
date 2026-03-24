import { describe, expect, it } from 'vitest';
import { catalogue, catalogueProblems, collectCodes } from '../../../src/core/catalogue.js';

const USES = collectCodes('src');

describe('the refusal codes', () => {
  it('finds the codes the domain actually raises', () => {
    expect(USES.length).toBeGreaterThan(200);
    expect(USES.some((use) => use.code === 'covers.lower')).toBe(true);
    expect(USES.some((use) => use.code === 'minimum.amount')).toBe(true);
  });

  it('is clean', () => {
    expect(catalogueProblems(USES).map((problem) => `${problem.code} ${problem.message}`)).toEqual(
      [],
    );
  });

  it('reads one entry per code, with the kind and the area on it', () => {
    const listed = catalogue(USES);
    expect(listed.length).toBeLessThanOrEqual(USES.length);
    expect(new Set(listed.map((entry) => entry.code)).size).toBe(listed.length);
    const lower = listed.find((entry) => entry.code === 'covers.lower');
    expect(lower?.kind).toBe('deadline-passed');
    expect(lower?.area).toBe('covers');
    expect(lower?.raisedIn).toBe('src/covers/guarantee.ts');
  });

  it('is sorted, so a reader can find one', () => {
    const codes = catalogue(USES).map((entry) => entry.code);
    expect(codes).toEqual([...codes].sort());
  });
});

describe('what the check would catch', () => {
  it('a code that is not shaped as area dot reason', () => {
    const problems = catalogueProblems([
      { code: 'covers', file: 'src/a.ts', kind: 'conflict' },
      { code: 'coversLower', file: 'src/a.ts', kind: 'conflict' },
      { code: 'Covers.Lower', file: 'src/a.ts', kind: 'conflict' },
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]?.message).toBe('is not shaped as area.reason');
  });

  it('one code raised from two files', () => {
    const problems = catalogueProblems([
      { code: 'covers.lower', file: 'src/a.ts', kind: 'conflict' },
      { code: 'covers.lower', file: 'src/b.ts', kind: 'conflict' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('src/a.ts, src/b.ts');
  });

  it('one code carrying two kinds', () => {
    const problems = catalogueProblems([
      { code: 'covers.lower', file: 'src/a.ts', kind: 'conflict' },
      { code: 'covers.lower', file: 'src/a.ts', kind: 'not-found' },
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('carries 2 kinds');
  });

  it('nothing about a code the list says is shared on purpose', () => {
    expect(
      catalogueProblems([
        { code: 'item.missing', file: 'src/a.ts', kind: 'not-found' },
        { code: 'item.missing', file: 'src/b.ts', kind: 'not-found' },
      ]),
    ).toEqual([]);
  });
});
