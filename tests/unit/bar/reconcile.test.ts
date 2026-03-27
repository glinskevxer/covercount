import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW } from '../../support/fixtures.js';
import { readyFunction } from '../../support/production.js';
import { createBarTier, recordPour, setBar } from '../../../src/bar/store.js';
import { ratePercent } from '../../../src/core/rate.js';
import {
  reconcileBar,
  renderReconciliation,
  requireReconciliation,
} from '../../../src/bar/reconcile.js';
import type { Database } from '../../../src/store/database.js';

function withTiers(db: Database) {
  const slot = readyFunction(db, { guarantee: 180 });
  createBarTier(
    db,
    CANYON,
    { code: 'HOUSE', name: 'House bar', firstHourMinor: 1800, extraHourMinor: 1200 },
    FIXED_NOW,
  );
  return slot;
}

/** Seventy seven tenths of a bottle at forty two dollars is $323.40. */
function pourWine(
  db: Database,
  functionId: Parameters<typeof recordPour>[1],
  tenths: number,
): void {
  recordPour(db, functionId, {
    itemCode: 'HOUSE-RED',
    openingTenths: 120,
    closingTenths: 120 - tenths,
    unitMinor: 4200,
  });
}

describe('reconciling a package bar', () => {
  it('prices the same night both ways', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      pourWine(db, slot.id, 77);

      const found = reconcileBar(db, slot.id);
      expect(found.kind).toBe('PACKAGE');
      expect(found.covers).toBe(180);
      // 180 billed covers at $18 for the first hour plus three hours at $12.
      expect(found.onPackage?.amount).toBe(180 * 1_800 + 180 * 1_200 * 3);
      expect(found.onConsumption.amount).toBe(32_340);
      expect(found.billed.amount).toBe(found.onPackage?.amount);
    });
  });

  it('says the package was the better sale when the room drank little', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      pourWine(db, slot.id, 40);
      expect(reconcileBar(db, slot.id).betterForTheHouse).toBe('PACKAGE');
    });
  });

  it('says consumption was the better sale when the room drank the cellar', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 1 });
      // 180 billed covers at $18 for one hour is $3,240, and this is well
      // past it: eighty bottles of the house red at forty two dollars.
      recordPour(db, slot.id, {
        itemCode: 'HOUSE-RED',
        openingTenths: 800,
        closingTenths: 0,
        unitMinor: 4_200,
      });
      const found = reconcileBar(db, slot.id);
      expect(found.onConsumption.amount).toBe(336_000);
      expect(found.betterForTheHouse).toBe('CONSUMPTION');
      expect(ratePercent(found.ratio)).toBeGreaterThan(100);
    });
  });

  it('counts the bottles whichever way the bar was sold', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      pourWine(db, slot.id, 77);
      expect(reconcileBar(db, slot.id).bottles).toBeCloseTo(7.7, 5);
    });
  });
});

describe('reconciling a consumption bar', () => {
  it('bills what was poured, so the two numbers agree', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CONSUMPTION', hours: 4 });
      pourWine(db, slot.id, 77);
      const found = reconcileBar(db, slot.id);
      expect(found.billed.amount).toBe(found.onConsumption.amount);
      expect(ratePercent(found.ratio)).toBe(100);
      expect(found.onPackage).toBeUndefined();
      expect(found.betterForTheHouse).toBe('THE-SAME');
    });
  });
});

describe('when there is nothing to reconcile', () => {
  it('says so on a cash bar', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CASH', hours: 4 });
      expect(() => requireReconciliation(db, slot.id)).toThrow(/nothing of the house's/);
    });
  });

  it('says so when nobody counted the bottles', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      expect(() => requireReconciliation(db, slot.id)).toThrow(/nobody counted the bottles/);
    });
  });

  it('still reports the plain reconciliation without refusing', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'CASH', hours: 4 });
      const found = reconcileBar(db, slot.id);
      expect(found.billed.amount).toBe(0);
      expect(found.poured).toEqual([]);
    });
  });
});

describe('printing it', () => {
  it('names both prices and which one was better', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      pourWine(db, slot.id, 77);
      const text = renderReconciliation(reconcileBar(db, slot.id));
      expect(text).toContain('PACKAGE bar, 180 covers, 4 hour(s)');
      expect(text).toContain('better for the house');
      expect(text).toContain('HOUSE-RED');
    });
  });

  it('says nobody counted rather than printing an empty list', () => {
    withStore((db) => {
      const slot = withTiers(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      expect(renderReconciliation(reconcileBar(db, slot.id))).toContain(
        'nobody counted the bottles',
      );
    });
  });
});
