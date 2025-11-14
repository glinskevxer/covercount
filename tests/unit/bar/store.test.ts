import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty } from '../../support/fixtures.js';
import { readyFunction } from '../../support/production.js';
import {
  BAR_KINDS,
  barCharge,
  createBarTier,
  findBar,
  isBarKind,
  listBarTiers,
  listPours,
  pourCharge,
  pouredTenths,
  recordPour,
  requireBar,
  requireBarTier,
  setBar,
} from '../../../src/bar/store.js';
import { catalogCode } from '../../../src/core/ids.js';
import { formatMoney } from '../../../src/core/money.js';
import type { Database } from '../../../src/store/database.js';

function withTiers(db: Database) {
  const slot = readyFunction(db, { guarantee: 180 });
  createBarTier(
    db,
    CANYON,
    { code: 'HOUSE', name: 'House bar', firstHourMinor: 1800, extraHourMinor: 1200 },
    FIXED_NOW,
  );
  createBarTier(
    db,
    CANYON,
    { code: 'PREMIUM', name: 'Premium bar', firstHourMinor: 2600, extraHourMinor: 1800 },
    FIXED_NOW,
  );
  return slot;
}

describe('bar tiers', () => {
  it('recognises the ways a bar is sold', () => {
    for (const kind of BAR_KINDS) {
      expect(isBarKind(kind)).toBe(true);
    }
    expect(isBarKind('OPEN')).toBe(false);
  });

  it('reads a tier back and lists them', () => {
    withStore((db) => {
      withTiers(db);
      const tier = requireBarTier(db, CANYON, catalogCode('HOUSE'));
      expect(tier.name).toBe('House bar');
      expect(formatMoney(tier.firstHour)).toBe('$18.00');
      expect(formatMoney(tier.extraHour)).toBe('$12.00');
      expect(listBarTiers(db, CANYON).map((row) => row.code)).toEqual(['HOUSE', 'PREMIUM']);
    });
  });

  it('refuses an extra hour dearer than the first', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        createBarTier(
          db,
          CANYON,
          { code: 'X', name: 'X', firstHourMinor: 1000, extraHourMinor: 1200 },
          FIXED_NOW,
        ),
      ).toThrow(/nobody would buy/);
    });
  });

  it('refuses a blank name, a bad rate and a duplicate', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { code: 'X', name: 'X', firstHourMinor: 1800, extraHourMinor: 1200 };
      expect(() => createBarTier(db, CANYON, { ...base, name: ' ' }, FIXED_NOW)).toThrow(
        /needs a name/,
      );
      expect(() => createBarTier(db, CANYON, { ...base, firstHourMinor: -1 }, FIXED_NOW)).toThrow(
        /whole number of minor units/,
      );
      createBarTier(db, CANYON, base, FIXED_NOW);
      expect(() => createBarTier(db, CANYON, base, FIXED_NOW)).toThrow(/already has a bar tier/);
      expect(() => requireBarTier(db, CANYON, catalogCode('NOWHERE'))).toThrow(/has no bar tier/);
    });
  });
});

describe('putting a bar on a function', () => {
  it('takes a package bar with a tier and hours', () => {
    withStore((db) => {
      const slot = withTiers(db);
      const bar = setBar(db, slot.id, { kind: 'package', tierCode: 'HOUSE', hours: 4 });
      expect(bar.kind).toBe('PACKAGE');
      expect(bar.tierCode).toBe('HOUSE');
      expect(bar.hours).toBe(4);
    });
  });

  it('refuses a package bar with no tier or no hours', () => {
    withStore((db) => {
      const slot = withTiers(db);
      expect(() => setBar(db, slot.id, { kind: 'PACKAGE', hours: 4 })).toThrow(
        /needs a tier, that is what it charges/,
      );
      expect(() => setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE' })).toThrow(
        /at least one hour/,
      );
    });
  });

  it('refuses a tier on a bar that is not sold by tier', () => {
    withStore((db) => {
      const slot = withTiers(db);
      expect(() => setBar(db, slot.id, { kind: 'CONSUMPTION', tierCode: 'HOUSE' })).toThrow(
        /is not sold by tier/,
      );
    });
  });

  it('replaces the bar rather than stacking one', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      setBar(db, slot.id, { kind: 'CONSUMPTION' });
      expect(requireBar(db, slot.id).kind).toBe('CONSUMPTION');
      expect(requireBar(db, slot.id).tierCode).toBeUndefined();
    });
  });

  it('answers for a function with no bar on it', () => {
    withStore((db) => {
      const slot = withTiers(db);
      expect(findBar(db, slot.id)).toBeUndefined();
      expect(() => requireBar(db, slot.id)).toThrow(/has no bar on it/);
      expect(() => setBar(db, slot.id, { kind: 'OPEN' })).toThrow(/not a way this property sells/);
    });
  });
});

describe('counting a consumption bar', () => {
  it('records what came out of a bottle', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CONSUMPTION' });
      const pour = recordPour(db, slot.id, {
        itemCode: 'HOUSE-RED',
        openingTenths: 120,
        closingTenths: 43,
        unitMinor: 4200,
      });
      expect(pouredTenths(pour)).toBe(77);
      expect(formatMoney(pourCharge(pour))).toBe('$323.40');
      expect(listPours(db, slot.id)).toHaveLength(1);
    });
  });

  it('refuses a bottle that closed fuller than it opened', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CONSUMPTION' });
      expect(() =>
        recordPour(db, slot.id, {
          itemCode: 'HOUSE-RED',
          openingTenths: 40,
          closingTenths: 50,
          unitMinor: 4200,
        }),
      ).toThrow(/closed fuller than it opened/);
    });
  });

  it('refuses a count on a bar that is not a consumption one', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      expect(() =>
        recordPour(db, slot.id, {
          itemCode: 'HOUSE-RED',
          openingTenths: 10,
          closingTenths: 0,
          unitMinor: 4200,
        }),
      ).toThrow(/so nobody counts the bottles/);
    });
  });

  it('refuses something that does not come off a bar', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CONSUMPTION' });
      expect(() =>
        recordPour(db, slot.id, {
          itemCode: 'SHORT-RIB',
          openingTenths: 10,
          closingTenths: 0,
          unitMinor: 100,
        }),
      ).toThrow(/is FOOD and does not come off a bar/);
    });
  });

  it('replaces a count taken twice', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CONSUMPTION' });
      const base = { itemCode: 'HOUSE-RED', openingTenths: 120, unitMinor: 4200 };
      recordPour(db, slot.id, { ...base, closingTenths: 43 });
      recordPour(db, slot.id, { ...base, closingTenths: 30 });
      expect(listPours(db, slot.id)).toHaveLength(1);
      expect(pouredTenths(listPours(db, slot.id)[0]!)).toBe(90);
    });
  });
});

describe('what the bar comes to', () => {
  it('charges a package bar per cover for the first hour and less after it', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      const charge = barCharge(db, slot.id);
      expect(charge.covers).toBe(180);
      expect(formatMoney(charge.amount)).toBe('$9,720.00');
      expect(charge.detail).toBe('HOUSE at 180 covers for 4 hours');
    });
  });

  it('charges one hour at the first hour rate alone', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 1 });
      expect(formatMoney(barCharge(db, slot.id).amount)).toBe('$3,240.00');
    });
  });

  it('follows the billed cover count', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'PREMIUM', hours: 2 });
      const before = barCharge(db, slot.id).amount.amount;
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'PREMIUM', hours: 3 });
      expect(barCharge(db, slot.id).amount.amount).toBeGreaterThan(before);
    });
  });

  it('charges a consumption bar what came out of the bottles', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CONSUMPTION' });
      recordPour(db, slot.id, {
        itemCode: 'HOUSE-RED',
        openingTenths: 120,
        closingTenths: 43,
        unitMinor: 4200,
      });
      const charge = barCharge(db, slot.id);
      expect(formatMoney(charge.amount)).toBe('$323.40');
      expect(charge.covers).toBe(0);
      expect(charge.detail).toBe('7.7 bottles across 1 lines');
    });
  });

  it('charges a cash bar nothing', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CASH' });
      const charge = barCharge(db, slot.id);
      expect(charge.amount.amount).toBe(0);
      expect(charge.detail).toBe('guests paid at the bar');
    });
  });

  it('charges a consumption bar nothing when nothing was poured', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CONSUMPTION' });
      expect(barCharge(db, slot.id).amount.amount).toBe(0);
    });
  });
});
