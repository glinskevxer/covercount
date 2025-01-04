import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedProperty } from '../../support/fixtures.js';
import {
  MAX_SEQUENCE,
  allocateEntityId,
  allocateSequence,
  listSequences,
  peekSequence,
  reserveSequenceThrough,
} from '../../../src/store/sequence.js';
import { inTransaction } from '../../../src/store/database.js';
import { DomainError } from '../../../src/core/errors.js';

describe('allocating a number', () => {
  it('starts at one and never skips', () => {
    withStore((db) => {
      seedProperty(db);
      expect(allocateSequence(db, CANYON, 'booking', 2025)).toBe(1);
      expect(allocateSequence(db, CANYON, 'booking', 2025)).toBe(2);
      expect(allocateSequence(db, CANYON, 'booking', 2025)).toBe(3);
    });
  });

  it('keeps a separate run per kind and per year', () => {
    withStore((db) => {
      seedProperty(db);
      expect(allocateSequence(db, CANYON, 'booking', 2025)).toBe(1);
      expect(allocateSequence(db, CANYON, 'invoice', 2025)).toBe(1);
      expect(allocateSequence(db, CANYON, 'booking', 2026)).toBe(1);
      expect(allocateSequence(db, CANYON, 'booking', 2025)).toBe(2);
    });
  });

  it('formats a full identifier', () => {
    withStore((db) => {
      seedProperty(db);
      expect(allocateEntityId(db, CANYON, 'booking', 2025)).toBe('BK-2025-0001');
      expect(allocateEntityId(db, CANYON, 'booking', 2025)).toBe('BK-2025-0002');
      expect(allocateEntityId(db, CANYON, 'beo', 2025)).toBe('BEO-2025-0001');
    });
  });

  it('refuses a year outside four digits', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => allocateSequence(db, CANYON, 'booking', 25)).toThrow(/four digit year/);
      expect(() => allocateSequence(db, CANYON, 'booking', 2025.5)).toThrow(DomainError);
    });
  });

  it('reports what the next number would be without taking it', () => {
    withStore((db) => {
      seedProperty(db);
      expect(peekSequence(db, CANYON, 'booking', 2025)).toBe(1);
      allocateSequence(db, CANYON, 'booking', 2025);
      expect(peekSequence(db, CANYON, 'booking', 2025)).toBe(2);
      expect(peekSequence(db, CANYON, 'booking', 2025)).toBe(2);
    });
  });

  it('gives the number back when the caller rolls its work back', () => {
    withStore((db) => {
      seedProperty(db);
      allocateSequence(db, CANYON, 'booking', 2025);
      expect(() =>
        inTransaction(db, (handle) => {
          allocateSequence(handle, CANYON, 'booking', 2025);
          throw new Error('the client walked away');
        }),
      ).toThrow('the client walked away');
      expect(allocateSequence(db, CANYON, 'booking', 2025)).toBe(2);
    });
  });

  it('runs out at the end of the range rather than wrapping', () => {
    withStore((db) => {
      seedProperty(db);
      reserveSequenceThrough(db, CANYON, 'booking', 2025, MAX_SEQUENCE);
      expect(() => allocateSequence(db, CANYON, 'booking', 2025)).toThrow(/used every booking/);
    });
  });

  it('issues the last number in the range before it runs out', () => {
    withStore((db) => {
      seedProperty(db);
      reserveSequenceThrough(db, CANYON, 'booking', 2025, MAX_SEQUENCE - 1);
      expect(allocateSequence(db, CANYON, 'booking', 2025)).toBe(MAX_SEQUENCE);
    });
  });
});

describe('reserving numbers already issued elsewhere', () => {
  it('moves the counter past what a previous system used', () => {
    withStore((db) => {
      seedProperty(db);
      expect(reserveSequenceThrough(db, CANYON, 'booking', 2025, 417)).toBe(418);
      expect(allocateSequence(db, CANYON, 'booking', 2025)).toBe(418);
    });
  });

  it('never moves a counter backwards', () => {
    withStore((db) => {
      seedProperty(db);
      reserveSequenceThrough(db, CANYON, 'booking', 2025, 417);
      expect(reserveSequenceThrough(db, CANYON, 'booking', 2025, 12)).toBe(418);
      expect(allocateSequence(db, CANYON, 'booking', 2025)).toBe(418);
    });
  });

  it('refuses a reservation that is not a whole count or is past the range', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => reserveSequenceThrough(db, CANYON, 'booking', 2025, -1)).toThrow(/whole count/);
      expect(() => reserveSequenceThrough(db, CANYON, 'booking', 2025, 10000)).toThrow(
        /past the end of the 2025 range/,
      );
    });
  });
});

describe('reading the counters', () => {
  it('lists them in kind then year order', () => {
    withStore((db) => {
      seedProperty(db);
      allocateSequence(db, CANYON, 'invoice', 2025);
      allocateSequence(db, CANYON, 'booking', 2026);
      allocateSequence(db, CANYON, 'booking', 2025);
      expect(listSequences(db, CANYON)).toEqual([
        { kind: 'booking', year: 2025, nextValue: 2 },
        { kind: 'booking', year: 2026, nextValue: 2 },
        { kind: 'invoice', year: 2025, nextValue: 2 },
      ]);
    });
  });

  it('is empty on a property that has issued nothing', () => {
    withStore((db) => {
      seedProperty(db);
      expect(listSequences(db, CANYON)).toEqual([]);
    });
  });
});
