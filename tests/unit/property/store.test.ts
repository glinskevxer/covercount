import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty, seedSpaces } from '../../support/fixtures.js';
import {
  addCalendarEntry,
  addSpace,
  findProperty,
  findSpace,
  listCalendarEntries,
  listProperties,
  listSpaces,
  requireProperty,
  requireSpace,
  setSpaceActive,
  setSpaceCapacity,
  spaceCapacities,
} from '../../../src/property/store.js';
import { catalogCode } from '../../../src/core/ids.js';
import { DomainError } from '../../../src/core/errors.js';
import { ratePercent } from '../../../src/core/rate.js';

describe('creating a property', () => {
  it('reads back everything it was given', () => {
    withStore((db) => {
      const property = seedProperty(db);
      expect(property.code).toBe('CANYON');
      expect(property.name).toBe('Canyon Ridge Hotel');
      expect(property.timeZone).toBe('America/Denver');
      expect(property.currency).toBe('USD');
      expect(property.guaranteeLeadDays).toBe(3);
      expect(property.guaranteeDueTime).toBe(720);
      expect(ratePercent(property.oversetRate)).toBe(5);
      expect(property.oversetCap).toBe(25);
      expect(property.createdAt).toBe(FIXED_NOW);
    });
  });

  it('normalises the code and trims the name', () => {
    withStore((db) => {
      const property = seedProperty(db, { code: ' canyon ', name: '  Canyon Ridge Hotel  ' });
      expect(property.code).toBe('CANYON');
      expect(property.name).toBe('Canyon Ridge Hotel');
    });
  });

  it('refuses a second property with the same code', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => seedProperty(db)).toThrow(/already on file/);
    });
  });

  it('refuses a blank name, an unknown currency and an unknown zone', () => {
    withStore((db) => {
      expect(() => seedProperty(db, { name: '   ' })).toThrow(/needs a name/);
      expect(() => seedProperty(db, { currency: 'JPY' })).toThrow(/not a currency this build/);
      expect(() => seedProperty(db, { timeZone: 'Middle/Earth' })).toThrow(/not a time zone/);
    });
  });

  it('refuses a guarantee lead that is negative, fractional or absurd', () => {
    withStore((db) => {
      expect(() => seedProperty(db, { guaranteeLeadDays: -1 })).toThrow(/whole number of business/);
      expect(() => seedProperty(db, { guaranteeLeadDays: 2.5 })).toThrow(DomainError);
      expect(() => seedProperty(db, { guaranteeLeadDays: 31 })).toThrow(
        /over thirty business days/,
      );
    });
  });

  it('refuses a negative overset and a fractional cap', () => {
    withStore((db) => {
      expect(() => seedProperty(db, { oversetPpm: -1 })).toThrow(/cannot be negative/);
      expect(() => seedProperty(db, { oversetCap: 1.5 })).toThrow(/whole number of covers/);
    });
  });

  it('lists what is on file and answers for what is not', () => {
    withStore((db) => {
      expect(listProperties(db)).toEqual([]);
      seedProperty(db);
      expect(listProperties(db).map((row) => row.code)).toEqual(['CANYON']);
      expect(findProperty(db, catalogCode('NOWHERE'))).toBeUndefined();
      expect(() => requireProperty(db, catalogCode('NOWHERE'))).toThrow(/is not on file/);
    });
  });
});

describe('adding a room', () => {
  it('stores the room and its capacities', () => {
    withStore((db) => {
      seedProperty(db);
      seedSpaces(db);
      const grand = requireSpace(db, CANYON, catalogCode('GRAND-A'));
      expect(grand.name).toBe('Grand Ballroom A');
      expect(grand.fireCapacity).toBe(350);
      expect(grand.floor).toBe('Lobby');
      expect(grand.active).toBe(true);
      expect(grand.isCombination).toBe(false);

      expect(spaceCapacities(db, CANYON, catalogCode('GRAND-A'))).toEqual([
        { spaceCode: 'GRAND-A', setupStyle: 'RECEPTION', capacity: 350 },
        { spaceCode: 'GRAND-A', setupStyle: 'ROUNDS-10', capacity: 200 },
        { spaceCode: 'GRAND-A', setupStyle: 'THEATER', capacity: 300 },
      ]);
    });
  });

  it('lists rooms in code order', () => {
    withStore((db) => {
      seedProperty(db);
      seedSpaces(db);
      expect(listSpaces(db, CANYON).map((row) => row.code)).toEqual([
        'ASPEN',
        'GRAND-A',
        'GRAND-B',
      ]);
    });
  });
});

describe('refusing a badly formed room', () => {
  it('refuses a room in a property that is not on file', () => {
    withStore((db) => {
      expect(() =>
        addSpace(db, catalogCode('NOWHERE'), {
          code: 'GRAND',
          name: 'Grand',
          areaSqFt: 100,
          fireCapacity: 10,
          setupMinutes: 10,
          teardownMinutes: 10,
        }),
      ).toThrow(/is not on file/);
    });
  });

  it('refuses a duplicate room code', () => {
    withStore((db) => {
      seedProperty(db);
      seedSpaces(db);
      expect(() =>
        addSpace(db, CANYON, {
          code: 'ASPEN',
          name: 'Aspen Again',
          areaSqFt: 900,
          fireCapacity: 80,
          setupMinutes: 45,
          teardownMinutes: 30,
        }),
      ).toThrow(/already has a room called ASPEN/);
    });
  });

  it('refuses a blank name, a fractional measure and a zero fire capacity', () => {
    withStore((db) => {
      seedProperty(db);
      const base = {
        code: 'TEST',
        name: 'Test',
        areaSqFt: 100,
        fireCapacity: 10,
        setupMinutes: 10,
        teardownMinutes: 10,
      };
      expect(() => addSpace(db, CANYON, { ...base, name: ' ' })).toThrow(/needs a name/);
      expect(() => addSpace(db, CANYON, { ...base, areaSqFt: 1.5 })).toThrow(/whole number/);
      expect(() => addSpace(db, CANYON, { ...base, setupMinutes: -1 })).toThrow(/whole number/);
      expect(() => addSpace(db, CANYON, { ...base, fireCapacity: 0 })).toThrow(
        /fire capacity of zero/,
      );
    });
  });

  it('rolls the room back when one of its capacities is refused', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        addSpace(db, CANYON, {
          code: 'TERRACE',
          name: 'Terrace',
          areaSqFt: 1000,
          fireCapacity: 100,
          setupMinutes: 30,
          teardownMinutes: 30,
          capacities: [{ setupStyle: 'ROUNDS-10', capacity: 120 }],
        }),
      ).toThrow(/over the fire capacity/);
      expect(findSpace(db, CANYON, catalogCode('TERRACE'))).toBeUndefined();
    });
  });
});

describe('capacities and the fire certificate', () => {
  it('refuses a capacity over the fire capacity', () => {
    withStore((db) => {
      seedProperty(db);
      seedSpaces(db);
      expect(() => setSpaceCapacity(db, CANYON, catalogCode('ASPEN'), 'ROUNDS-10', 81)).toThrow(
        /over the fire capacity of 80/,
      );
    });
  });

  it('allows a capacity exactly at the fire capacity', () => {
    withStore((db) => {
      seedProperty(db);
      seedSpaces(db);
      setSpaceCapacity(db, CANYON, catalogCode('ASPEN'), 'RECEPTION', 80);
      const found = spaceCapacities(db, CANYON, catalogCode('ASPEN')).find(
        (row) => row.setupStyle === 'RECEPTION',
      );
      expect(found?.capacity).toBe(80);
    });
  });

  it('replaces a capacity that is set twice', () => {
    withStore((db) => {
      seedProperty(db);
      seedSpaces(db);
      setSpaceCapacity(db, CANYON, catalogCode('ASPEN'), 'ROUNDS-10', 50);
      const found = spaceCapacities(db, CANYON, catalogCode('ASPEN')).find(
        (row) => row.setupStyle === 'ROUNDS-10',
      );
      expect(found?.capacity).toBe(50);
    });
  });

  it('refuses a setup style it does not know', () => {
    withStore((db) => {
      seedProperty(db);
      seedSpaces(db);
      expect(() => setSpaceCapacity(db, CANYON, catalogCode('ASPEN'), 'CABARET', 40)).toThrow(
        /not a setup style/,
      );
    });
  });

  it('takes a room out of service without deleting it', () => {
    withStore((db) => {
      seedProperty(db);
      seedSpaces(db);
      expect(setSpaceActive(db, CANYON, catalogCode('ASPEN'), false).active).toBe(false);
      expect(listSpaces(db, CANYON)).toHaveLength(3);
      expect(setSpaceActive(db, CANYON, catalogCode('ASPEN'), true).active).toBe(true);
    });
  });
});

describe('the house calendars', () => {
  it('keeps the office and kitchen calendars apart', () => {
    withStore((db) => {
      seedProperty(db);
      addCalendarEntry(db, CANYON, { calendar: 'office', date: '2025-07-04', kind: 'closed' });
      addCalendarEntry(db, CANYON, {
        calendar: 'kitchen',
        date: '2025-12-25',
        kind: 'closed',
        note: 'property dark',
      });
      expect(listCalendarEntries(db, CANYON, 'office').map((row) => row.date)).toEqual([
        '2025-07-04',
      ]);
      const kitchen = listCalendarEntries(db, CANYON, 'kitchen');
      expect(kitchen[0]?.note).toBe('property dark');
    });
  });

  it('replaces an entry on the same date', () => {
    withStore((db) => {
      seedProperty(db);
      addCalendarEntry(db, CANYON, { calendar: 'office', date: '2025-07-04', kind: 'closed' });
      addCalendarEntry(db, CANYON, {
        calendar: 'office',
        date: '2025-07-04',
        kind: 'open',
        note: 'skeleton crew',
      });
      const entries = listCalendarEntries(db, CANYON, 'office');
      expect(entries).toHaveLength(1);
      expect(entries[0]?.kind).toBe('open');
    });
  });

  it('refuses an unknown calendar, an unknown entry kind and a bad date', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        addCalendarEntry(db, CANYON, { calendar: 'banquet', date: '2025-07-04', kind: 'closed' }),
      ).toThrow(/not a calendar this build keeps/);
      expect(() =>
        addCalendarEntry(db, CANYON, { calendar: 'office', date: '2025-07-04', kind: 'maybe' }),
      ).toThrow(/closed or open/);
      expect(() =>
        addCalendarEntry(db, CANYON, { calendar: 'office', date: '4th July', kind: 'closed' }),
      ).toThrow(/YYYY-MM-DD/);
    });
  });
});
