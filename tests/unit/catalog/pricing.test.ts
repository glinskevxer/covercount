import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty } from '../../support/fixtures.js';
import { seedFullCatalog, seedMenu, seedPackages } from '../../support/menu.js';
import {
  bookOn,
  createPriceBook,
  findPriceBook,
  findPriceOn,
  listPriceBooks,
  priceHistory,
  removePrice,
  requirePriceBook,
  requirePriceOn,
  rollForward,
  setPrice,
} from '../../../src/catalog/pricing.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { catalogCode } from '../../../src/core/ids.js';
import { applyRate, rateFromPercent } from '../../../src/core/rate.js';
import { addMoney, money } from '../../../src/core/money.js';

const code = catalogCode;
const d = calendarDate;
const RACK = code('RACK-2025');

describe('creating a price book', () => {
  it('takes the currency of the property by default', () => {
    withStore((db) => {
      seedProperty(db);
      const book = createPriceBook(db, CANYON, { code: 'RACK-2025', name: 'Rack 2025' }, FIXED_NOW);
      expect(book.code).toBe('RACK-2025');
      expect(book.currency).toBe('USD');
      expect(book.createdAt).toBe(FIXED_NOW);
    });
  });

  it('refuses a currency the property does not invoice in', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        createPriceBook(db, CANYON, { code: 'X', name: 'X', currency: 'EUR' }, FIXED_NOW),
      ).toThrow(/invoices in USD and cannot carry a EUR book/);
      expect(() =>
        createPriceBook(db, CANYON, { code: 'X', name: 'X', currency: 'JPY' }, FIXED_NOW),
      ).toThrow(/not a currency this build holds/);
    });
  });

  it('refuses a blank name and a duplicate code', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => createPriceBook(db, CANYON, { code: 'X', name: ' ' }, FIXED_NOW)).toThrow(
        /needs a name/,
      );
      createPriceBook(db, CANYON, { code: 'X', name: 'X' }, FIXED_NOW);
      expect(() => createPriceBook(db, CANYON, { code: 'X', name: 'X' }, FIXED_NOW)).toThrow(
        /already has a price book X/,
      );
    });
  });

  it('lists what is on file and answers for what is not', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      expect(listPriceBooks(db, CANYON).map((row) => row.code)).toEqual(['RACK-2025']);
      expect(findPriceBook(db, CANYON, code('NOTHING'))).toBeUndefined();
      expect(() => requirePriceBook(db, CANYON, code('NOTHING'))).toThrow(/has no price book/);
    });
  });
});

describe('putting a price on something', () => {
  it('prices an item and a package', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      expect(
        requirePriceOn(db, CANYON, RACK, 'PACKAGE', code('PLATED-THREE'), d('2025-04-18')),
      ).toEqual(money(8950, 'USD'));
      expect(requirePriceOn(db, CANYON, RACK, 'ITEM', code('LOBSTER-UP'), d('2025-04-18'))).toEqual(
        money(2400, 'USD'),
      );
    });
  });

  it('refuses a subject kind, a subject or a book it does not know', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      const base = {
        bookCode: 'RACK-2025',
        subjectKind: 'ITEM',
        subjectCode: 'CRAB-CAKE',
        effectiveFrom: '2025-01-01',
        priceMinor: 100,
      };
      expect(() => setPrice(db, CANYON, { ...base, subjectKind: 'FUNCTION' })).toThrow(
        /not something a price attaches to/,
      );
      expect(() => setPrice(db, CANYON, { ...base, subjectCode: 'UNICORN' })).toThrow(
        /has no menu item UNICORN/,
      );
      expect(() =>
        setPrice(db, CANYON, { ...base, subjectKind: 'PACKAGE', subjectCode: 'UNICORN' }),
      ).toThrow(/has no package UNICORN/);
      expect(() => setPrice(db, CANYON, { ...base, bookCode: 'NOBOOK' })).toThrow(
        /has no price book NOBOOK/,
      );
    });
  });

  it('refuses a negative or fractional price and a date that is not one', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      const base = {
        bookCode: 'RACK-2025',
        subjectKind: 'ITEM',
        subjectCode: 'CRAB-CAKE',
        effectiveFrom: '2025-01-01',
        priceMinor: 100,
      };
      expect(() => setPrice(db, CANYON, { ...base, priceMinor: -1 })).toThrow(/cannot be negative/);
      expect(() => setPrice(db, CANYON, { ...base, priceMinor: 1.5 })).toThrow(/minor units/);
      expect(() => setPrice(db, CANYON, { ...base, effectiveFrom: 'January' })).toThrow(
        /YYYY-MM-DD/,
      );
    });
  });

  it('replaces a line on the same effective date rather than stacking one', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      setPrice(db, CANYON, {
        bookCode: 'RACK-2025',
        subjectKind: 'ITEM',
        subjectCode: 'CRAB-CAKE',
        effectiveFrom: '2025-01-01',
        priceMinor: 725,
      });
      const history = priceHistory(db, CANYON, RACK, 'ITEM', code('CRAB-CAKE'));
      expect(history).toHaveLength(1);
      expect(history[0]?.price.amount).toBe(725);
    });
  });
});

describe('the price in force on a date', () => {
  it('takes the latest line that is not in the future', () => {
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
        requirePriceOn(db, CANYON, RACK, 'PACKAGE', code('PLATED-THREE'), d(date)).amount;
      expect(on('2025-06-30')).toBe(8950);
      expect(on('2025-07-01')).toBe(9450);
      expect(on('2025-12-31')).toBe(9450);
    });
  });

  it('has no price before the first line rather than a price of zero', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      expect(
        findPriceOn(db, CANYON, RACK, 'PACKAGE', code('PLATED-THREE'), d('2024-12-31')),
      ).toBeUndefined();
      expect(() =>
        requirePriceOn(db, CANYON, RACK, 'PACKAGE', code('PLATED-THREE'), d('2024-12-31')),
      ).toThrow(/carries no price for PLATED-THREE on 2024-12-31/);
    });
  });

  it('has no price for something the book never carried', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      expect(
        findPriceOn(db, CANYON, RACK, 'ITEM', code('SHORT-RIB'), d('2025-04-18')),
      ).toBeUndefined();
    });
  });

  it('lists a history in date order', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      for (const [date, price] of [
        ['2025-07-01', 9450],
        ['2026-01-01', 9950],
      ] as const) {
        setPrice(db, CANYON, {
          bookCode: 'RACK-2025',
          subjectKind: 'PACKAGE',
          subjectCode: 'PLATED-THREE',
          effectiveFrom: date,
          priceMinor: price,
        });
      }
      const history = priceHistory(db, CANYON, RACK, 'PACKAGE', code('PLATED-THREE'));
      expect(history.map((row) => [row.effectiveFrom, row.price.amount])).toEqual([
        ['2025-01-01', 8950],
        ['2025-07-01', 9450],
        ['2026-01-01', 9950],
      ]);
    });
  });

  it('takes a line back out', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      expect(removePrice(db, CANYON, RACK, 'ITEM', code('CRAB-CAKE'), d('2025-01-01'))).toBe(true);
      expect(removePrice(db, CANYON, RACK, 'ITEM', code('CRAB-CAKE'), d('2025-01-01'))).toBe(false);
      expect(
        findPriceOn(db, CANYON, RACK, 'ITEM', code('CRAB-CAKE'), d('2025-04-18')),
      ).toBeUndefined();
    });
  });
});

describe('printing a book on a date', () => {
  it('gives one line per subject, the one in force', () => {
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
      const summer = bookOn(db, CANYON, RACK, d('2025-08-01'));
      const plated = summer.find((row) => row.subjectCode === 'PLATED-THREE');
      expect(plated?.price.amount).toBe(9450);
      expect(plated?.effectiveFrom).toBe('2025-07-01');
      expect(summer.filter((row) => row.subjectCode === 'PLATED-THREE')).toHaveLength(1);
    });
  });

  it('is ordered by kind then code and leaves out what is not yet in force', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      const lines = bookOn(db, CANYON, RACK, d('2025-04-18'));
      expect(lines.map((row) => row.subjectKind)[0]).toBe('ITEM');
      expect(lines.at(-1)?.subjectKind).toBe('PACKAGE');
      expect(bookOn(db, CANYON, RACK, d('2024-12-31'))).toEqual([]);
    });
  });
});

describe('rolling a book forward', () => {
  it('writes a new line per subject and leaves the old ones alone', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      const written = rollForward(db, CANYON, RACK, d('2025-04-18'), d('2026-01-01'), (price) =>
        addMoney(price, applyRate(price, rateFromPercent(4))),
      );
      expect(written).toBe(9);
      expect(
        requirePriceOn(db, CANYON, RACK, 'PACKAGE', code('PLATED-THREE'), d('2025-12-31')).amount,
      ).toBe(8950);
      expect(
        requirePriceOn(db, CANYON, RACK, 'PACKAGE', code('PLATED-THREE'), d('2026-01-01')).amount,
      ).toBe(9308);
    });
  });

  it('refuses to roll into a date that is not later', () => {
    withStore((db) => {
      seedProperty(db);
      seedFullCatalog(db);
      expect(() =>
        rollForward(db, CANYON, RACK, d('2025-04-18'), d('2025-04-18'), (price) => price),
      ).toThrow(/is not after/);
      expect(() =>
        rollForward(db, CANYON, RACK, d('2025-04-18'), d('2025-01-01'), (price) => price),
      ).toThrow(/is not after/);
    });
  });

  it('rolls nothing when the source date carries no prices', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedPackages(db);
      createPriceBook(db, CANYON, { code: 'EMPTY', name: 'Empty' }, FIXED_NOW);
      expect(
        rollForward(db, CANYON, code('EMPTY'), d('2025-01-01'), d('2026-01-01'), (p) => p),
      ).toBe(0);
    });
  });
});
