import { describe, expect, it } from 'vitest';
import {
  ID_PREFIXES,
  catalogCode,
  entityIdKind,
  entityIdSequence,
  entityIdYear,
  formatEntityId,
  formatRevisionId,
  isCatalogCode,
  parseEntityId,
} from '../../../src/core/ids.js';
import { DomainError } from '../../../src/core/errors.js';

describe('office identifiers', () => {
  it('formats with the kind on the front and a padded sequence', () => {
    expect(formatEntityId('booking', 2025, 142)).toBe('BK-2025-0142');
    expect(formatEntityId('beo', 2025, 1)).toBe('BEO-2025-0001');
    expect(formatEntityId('invoice', 2026, 9999)).toBe('INV-2026-9999');
  });

  it('refuses a year or a sequence outside the shape', () => {
    expect(() => formatEntityId('booking', 25, 1)).toThrow(/not a four digit year/);
    expect(() => formatEntityId('booking', 2025, 0)).toThrow(/outside the sequence range/);
    expect(() => formatEntityId('booking', 2025, 10000)).toThrow(DomainError);
  });

  it('reads one back and normalises the case', () => {
    expect(parseEntityId('booking', 'bk-2025-0142')).toBe('BK-2025-0142');
    expect(parseEntityId('booking', ' BK-2025-0142 ')).toBe('BK-2025-0142');
  });

  it('refuses an identifier of the wrong kind', () => {
    expect(() => parseEntityId('booking', 'INV-2025-0142')).toThrow(
      /is a INV identifier, not a BK one/,
    );
  });

  it('refuses text that is not an identifier at all', () => {
    expect(() => parseEntityId('booking', 'the Fenwick wedding')).toThrow(/not an identifier/);
    expect(() => parseEntityId('booking', 'BK-25-142')).toThrow(DomainError);
  });

  it('names the kind of an identifier it is handed', () => {
    expect(entityIdKind('BEO-2025-0142')).toBe('beo');
    expect(entityIdKind('RQ-2025-0142')).toBe('requisition');
    expect(entityIdKind('ZZ-2025-0142')).toBeUndefined();
    expect(entityIdKind('nonsense')).toBeUndefined();
  });

  it('pulls the year and sequence back out', () => {
    const id = formatEntityId('booking', 2025, 142);
    expect(entityIdYear(id)).toBe(2025);
    expect(entityIdSequence(id)).toBe(142);
  });

  it('keeps a distinct prefix for every kind', () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('hangs a revision off its parent', () => {
    const beo = formatEntityId('beo', 2025, 142);
    expect(formatRevisionId(beo, 3)).toBe('BEO-2025-0142 r3');
    expect(formatRevisionId(beo, 0)).toBe('BEO-2025-0142 r0');
    expect(() => formatRevisionId(beo, -1)).toThrow(/not a revision number/);
  });
});

describe('catalog codes', () => {
  it('normalises what somebody types', () => {
    expect(catalogCode('beef-short-rib')).toBe('BEEF-SHORT-RIB');
    expect(catalogCode('  plated dinner  ')).toBe('PLATED-DINNER');
    expect(catalogCode('AV.SCREEN.16X9')).toBe('AV.SCREEN.16X9');
  });

  it('refuses a blank, an overlong or a badly shaped code', () => {
    expect(() => catalogCode('   ')).toThrow(/cannot be blank/);
    expect(() => catalogCode('X'.repeat(33))).toThrow(/longer than 32 characters/);
    expect(() => catalogCode('beef/rib')).toThrow(/not a catalog code/);
    expect(() => catalogCode('-leading')).toThrow(/not a catalog code/);
    expect(() => catalogCode('trailing-')).toThrow(/not a catalog code/);
  });

  it('answers whether a string would pass', () => {
    expect(isCatalogCode('BEEF-SHORT-RIB')).toBe(true);
    expect(isCatalogCode('beef/rib')).toBe(false);
  });
});
