import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedPropertyWithSpaces } from '../../support/fixtures.js';
import {
  clashingSpaces,
  combinationsContaining,
  componentsOf,
  defineCombination,
  physicalFootprint,
  spacesClash,
} from '../../../src/property/combinations.js';
import { listSpaces, requireSpace, setSpaceCapacity } from '../../../src/property/store.js';
import { catalogCode } from '../../../src/core/ids.js';

const code = catalogCode;

describe('defining a combination', () => {
  it('sums the area and the fire capacity of its parts', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      const grand = defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-A', 'GRAND-B'],
      });
      expect(grand.isCombination).toBe(true);
      expect(grand.areaSqFt).toBe(6400);
      expect(grand.fireCapacity).toBe(700);
      expect(grand.floor).toBe('Lobby');
    });
  });

  it('takes the longest setup and teardown of its parts', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      const mixed = defineCombination(db, CANYON, {
        code: 'GRAND-ASPEN',
        name: 'Grand and Aspen',
        components: ['GRAND-A', 'ASPEN'],
      });
      expect(mixed.setupMinutes).toBe(120);
      expect(mixed.teardownMinutes).toBe(60);
    });
  });

  it('takes an explicit fire capacity over the sum', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      const grand = defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-A', 'GRAND-B'],
        fireCapacity: 650,
      });
      expect(grand.fireCapacity).toBe(650);
    });
  });

  it('lists its components in order', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-B', 'GRAND-A'],
      });
      expect(componentsOf(db, CANYON, code('GRAND'))).toEqual(['GRAND-A', 'GRAND-B']);
    });
  });

  it('appears in the room list like any other space', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-A', 'GRAND-B'],
      });
      expect(listSpaces(db, CANYON).map((row) => row.code)).toEqual([
        'ASPEN',
        'GRAND',
        'GRAND-A',
        'GRAND-B',
      ]);
    });
  });

  it('takes a capacity of its own', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-A', 'GRAND-B'],
      });
      setSpaceCapacity(db, CANYON, code('GRAND'), 'ROUNDS-10', 440);
      expect(requireSpace(db, CANYON, code('GRAND')).fireCapacity).toBe(700);
    });
  });
});

describe('refusing a combination that would not resolve', () => {
  it('refuses fewer than two rooms', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      expect(() =>
        defineCombination(db, CANYON, { code: 'X', name: 'X', components: ['GRAND-A'] }),
      ).toThrow(/at least two rooms/);
      expect(() => defineCombination(db, CANYON, { code: 'X', name: 'X', components: [] })).toThrow(
        /at least two rooms/,
      );
    });
  });

  it('refuses the same room listed twice', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      expect(() =>
        defineCombination(db, CANYON, {
          code: 'X',
          name: 'X',
          components: ['GRAND-A', 'GRAND-A'],
        }),
      ).toThrow(/lists the same room twice/);
    });
  });

  it('refuses a combination that contains itself', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      expect(() =>
        defineCombination(db, CANYON, {
          code: 'GRAND-A',
          name: 'X',
          components: ['GRAND-A', 'GRAND-B'],
        }),
      ).toThrow(/cannot be one of its own components/);
      expect(() =>
        defineCombination(db, CANYON, {
          code: 'X',
          name: 'X',
          components: ['X', 'GRAND-B'],
        }),
      ).toThrow(/cannot be one of its own components/);
    });
  });

  it('refuses a combination built out of another combination', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-A', 'GRAND-B'],
      });
      expect(() =>
        defineCombination(db, CANYON, {
          code: 'EVERYTHING',
          name: 'Everything',
          components: ['GRAND', 'ASPEN'],
        }),
      ).toThrow(/itself a combination/);
    });
  });

  it('refuses a room that is not on file', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      expect(() =>
        defineCombination(db, CANYON, {
          code: 'X',
          name: 'X',
          components: ['GRAND-A', 'TERRACE'],
        }),
      ).toThrow(/has no room called TERRACE/);
    });
  });

  it('leaves nothing behind when it refuses', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      expect(() =>
        defineCombination(db, CANYON, {
          code: 'X',
          name: 'X',
          components: ['GRAND-A', 'TERRACE'],
        }),
      ).toThrow();
      expect(listSpaces(db, CANYON)).toHaveLength(3);
    });
  });
});

describe('the footprint a space takes out of the diary', () => {
  it('is the room itself for a plain room', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      expect(physicalFootprint(db, CANYON, code('ASPEN'))).toEqual(['ASPEN']);
    });
  });

  it('is the parts, not the whole, for a combination', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-A', 'GRAND-B'],
      });
      expect(physicalFootprint(db, CANYON, code('GRAND'))).toEqual(['GRAND-A', 'GRAND-B']);
    });
  });

  it('makes a combination clash with each of its parts', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-A', 'GRAND-B'],
      });
      expect(spacesClash(db, CANYON, code('GRAND'), code('GRAND-A'))).toBe(true);
      expect(spacesClash(db, CANYON, code('GRAND-A'), code('GRAND'))).toBe(true);
      expect(spacesClash(db, CANYON, code('GRAND-A'), code('GRAND-B'))).toBe(false);
      expect(spacesClash(db, CANYON, code('GRAND'), code('ASPEN'))).toBe(false);
    });
  });

  it('lists every space a booking would block, itself included', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-A', 'GRAND-B'],
      });
      expect(clashingSpaces(db, CANYON, code('GRAND-A'))).toEqual(['GRAND', 'GRAND-A']);
      expect(clashingSpaces(db, CANYON, code('GRAND'))).toEqual(['GRAND', 'GRAND-A', 'GRAND-B']);
      expect(clashingSpaces(db, CANYON, code('ASPEN'))).toEqual(['ASPEN']);
    });
  });

  it('names the combinations a room belongs to', () => {
    withStore((db) => {
      seedPropertyWithSpaces(db);
      defineCombination(db, CANYON, {
        code: 'GRAND',
        name: 'Grand Ballroom',
        components: ['GRAND-A', 'GRAND-B'],
      });
      defineCombination(db, CANYON, {
        code: 'GRAND-A-ASPEN',
        name: 'Grand A and Aspen',
        components: ['GRAND-A', 'ASPEN'],
      });
      expect(combinationsContaining(db, CANYON, code('GRAND-A'))).toEqual([
        'GRAND',
        'GRAND-A-ASPEN',
      ]);
      expect(combinationsContaining(db, CANYON, code('GRAND-B'))).toEqual(['GRAND']);
    });
  });
});
