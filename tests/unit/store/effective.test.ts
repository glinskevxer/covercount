import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedProperty } from '../../support/fixtures.js';
import { seedFullCatalog } from '../../support/menu.js';
import { seedLabour } from '../../support/labour.js';
import {
  LABOUR_RATES,
  PRICE_LINES,
  seriesFor,
  tableOn,
  valueOn,
} from '../../../src/store/effective.js';
import { setPrice } from '../../../src/catalog/pricing.js';
import { setLabourRate } from '../../../src/labour/staffing.js';
import { calendarDate } from '../../../src/core/calendar.js';

const d = calendarDate;

describe('the value in force on a date', () => {
  it('takes the latest row that is not in the future', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      setPrice(db, CANYON, {
        bookCode: 'RACK-2025',
        subjectKind: 'PACKAGE',
        subjectCode: 'PLATED-THREE',
        effectiveFrom: '2025-07-01',
        priceMinor: 9450,
      });
      const on = (date: string) =>
        valueOn(db, PRICE_LINES, [CANYON, 'RACK-2025', 'PACKAGE', 'PLATED-THREE'], d(date));
      expect(on('2025-06-30')).toBe(8950);
      expect(on('2025-07-01')).toBe(9450);
      expect(on('2024-12-31')).toBeUndefined();
    });
  });

  it('applies a row on the very day it takes effect', () => {
    withStore((db) => {
      seedProperty(db);
      seedLabour(db);
      setLabourRate(db, CANYON, 'SERVER', '2025-07-01', 2600);
      expect(valueOn(db, LABOUR_RATES, [CANYON, 'SERVER'], d('2025-07-01'))).toBe(2600);
      expect(valueOn(db, LABOUR_RATES, [CANYON, 'SERVER'], d('2025-06-30'))).toBe(2400);
    });
  });

  it('refuses the wrong number of keys', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => valueOn(db, LABOUR_RATES, [CANYON], d('2025-04-18'))).toThrow(
        /keyed on 2 columns and 1 were given/,
      );
    });
  });
});

describe('the whole series', () => {
  it('comes back oldest first', () => {
    withStore((db) => {
      seedProperty(db);
      seedLabour(db);
      setLabourRate(db, CANYON, 'SERVER', '2026-01-01', 2800);
      setLabourRate(db, CANYON, 'SERVER', '2025-07-01', 2600);
      expect(seriesFor(db, LABOUR_RATES, [CANYON, 'SERVER'])).toEqual([
        { effectiveFrom: '2025-01-01', value: 2400 },
        { effectiveFrom: '2025-07-01', value: 2600 },
        { effectiveFrom: '2026-01-01', value: 2800 },
      ]);
    });
  });

  it('is empty for a series nothing was ever written to', () => {
    withStore((db) => {
      seedProperty(db);
      expect(seriesFor(db, LABOUR_RATES, [CANYON, 'COOK'])).toEqual([]);
    });
  });
});

describe('every series at one date', () => {
  it('gives one row a series, the one in force', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      setPrice(db, CANYON, {
        bookCode: 'RACK-2025',
        subjectKind: 'PACKAGE',
        subjectCode: 'PLATED-THREE',
        effectiveFrom: '2025-07-01',
        priceMinor: 9450,
      });
      const summer = tableOn(
        db,
        PRICE_LINES,
        [CANYON, 'RACK-2025'],
        ['property_code', 'book_code'],
        d('2025-08-01'),
      );
      const plated = summer.find((row) => row.keys[3] === 'PLATED-THREE');
      expect(plated?.value).toBe(9450);
      expect(summer.filter((row) => row.keys[3] === 'PLATED-THREE')).toHaveLength(1);
    });
  });

  it('is empty before the first row', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      expect(
        tableOn(
          db,
          PRICE_LINES,
          [CANYON, 'RACK-2025'],
          ['property_code', 'book_code'],
          d('2024-12-31'),
        ),
      ).toEqual([]);
    });
  });
});
