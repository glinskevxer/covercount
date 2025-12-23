import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { addCharge, listCharges } from '../../../src/billing/charges.js';
import {
  SHORTFALL_DESCRIPTION,
  clearRevenueMinimum,
  findRevenueMinimum,
  minimumStanding,
  requireRevenueMinimum,
  setRevenueMinimum,
  sweepMinimum,
} from '../../../src/billing/minimum.js';
import { cancelBooking } from '../../../src/booking/lifecycle.js';

function food(
  db: Parameters<typeof addCharge>[0],
  id: Parameters<typeof addCharge>[1],
  minor: number,
): void {
  addCharge(db, id, {
    category: 'FOOD',
    description: 'dinner',
    quantity: 1,
    unitMinor: minor,
  });
}

describe('putting a minimum on a function', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const record = setRevenueMinimum(
        db,
        slot.id,
        { minimumMinor: 1_500_000, note: '  clause 4b  ' },
        KITCHEN_NOW,
      );
      expect(record.minimum.amount).toBe(1_500_000);
      expect(record.countsBeverage).toBe(true);
      expect(record.note).toBe('clause 4b');
      expect(requireRevenueMinimum(db, slot.id).minimum.amount).toBe(1_500_000);
    });
  });

  it('replaces rather than stacking', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 1_500_000 }, KITCHEN_NOW);
      setRevenueMinimum(db, slot.id, { minimumMinor: 900_000, countsBeverage: false }, KITCHEN_NOW);
      const record = requireRevenueMinimum(db, slot.id);
      expect(record.minimum.amount).toBe(900_000);
      expect(record.countsBeverage).toBe(false);
    });
  });

  it('refuses a negative floor and a dead booking', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(() => setRevenueMinimum(db, slot.id, { minimumMinor: -1 }, KITCHEN_NOW)).toThrow(
        /whole amount of minor units/,
      );
      cancelBooking(db, slot.bookingId, 'client walked', KITCHEN_NOW);
      expect(() => setRevenueMinimum(db, slot.id, { minimumMinor: 1_000 }, KITCHEN_NOW)).toThrow(
        /its minimum is history now/,
      );
    });
  });

  it('clears away again', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 1_500_000 }, KITCHEN_NOW);
      expect(clearRevenueMinimum(db, slot.id)).toBe(true);
      expect(clearRevenueMinimum(db, slot.id)).toBe(false);
      expect(findRevenueMinimum(db, slot.id)).toBeUndefined();
      expect(() => minimumStanding(db, slot.id)).toThrow(/carries no minimum/);
    });
  });
});

describe('where a function stands against its minimum', () => {
  it('counts food and the bar by default', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 1_500_000 }, KITCHEN_NOW);
      food(db, slot.id, 1_000_000);
      addCharge(db, slot.id, {
        category: 'BEVERAGE',
        description: 'wine',
        quantity: 1,
        unitMinor: 400_000,
      });
      const standing = minimumStanding(db, slot.id);
      expect(standing.achieved.amount).toBe(1_400_000);
      expect(standing.shortfall.amount).toBe(100_000);
      expect(standing.met).toBe(false);
      expect(standing.categories).toEqual(['BEVERAGE', 'FOOD']);
    });
  });

  it('leaves the bar out when the contract says food only', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(
        db,
        slot.id,
        { minimumMinor: 1_500_000, countsBeverage: false },
        KITCHEN_NOW,
      );
      food(db, slot.id, 1_000_000);
      addCharge(db, slot.id, {
        category: 'BEVERAGE',
        description: 'wine',
        quantity: 1,
        unitMinor: 400_000,
      });
      const standing = minimumStanding(db, slot.id);
      expect(standing.achieved.amount).toBe(1_000_000);
      expect(standing.shortfall.amount).toBe(500_000);
      expect(standing.categories).toEqual(['FOOD']);
    });
  });

  it('will not let a screen or a coat check clear a food floor', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 500_000 }, KITCHEN_NOW);
      addCharge(db, slot.id, {
        category: 'AV',
        description: 'screens',
        quantity: 4,
        unitMinor: 200_000,
      });
      addCharge(db, slot.id, {
        category: 'LABOR',
        description: 'coat check',
        quantity: 2,
        unitMinor: 50_000,
      });
      expect(minimumStanding(db, slot.id).achieved.amount).toBe(0);
      expect(minimumStanding(db, slot.id).shortfall.amount).toBe(500_000);
    });
  });

  it('reports nil shortfall once the floor is cleared', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 500_000 }, KITCHEN_NOW);
      food(db, slot.id, 800_000);
      const standing = minimumStanding(db, slot.id);
      expect(standing.shortfall.amount).toBe(0);
      expect(standing.met).toBe(true);
    });
  });
});

describe('sweeping the shortfall onto the bill', () => {
  it('writes one rental line that carries no service charge', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 1_500_000 }, KITCHEN_NOW);
      food(db, slot.id, 1_100_000);
      const result = sweepMinimum(db, slot.id);
      expect(result.removed).toBe(0);
      expect(result.charge?.category).toBe('RENTAL');
      expect(result.charge?.description).toBe(SHORTFALL_DESCRIPTION);
      expect(result.charge?.unit.amount).toBe(400_000);
      expect(result.charge?.serviceable).toBe(false);
      expect(result.charge?.taxable).toBe(true);
      expect(result.charge?.source).toBe('MINIMUM');
    });
  });

  it('does not let its own line count toward the floor', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 1_500_000 }, KITCHEN_NOW);
      food(db, slot.id, 1_100_000);
      sweepMinimum(db, slot.id);
      const again = sweepMinimum(db, slot.id);
      expect(again.removed).toBe(1);
      expect(again.standing.achieved.amount).toBe(1_100_000);
      expect(again.charge?.unit.amount).toBe(400_000);
      expect(listCharges(db, slot.id).filter((line) => line.source === 'MINIMUM')).toHaveLength(1);
    });
  });

  it('restates one line rather than adding a second when the floor moves', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 1_500_000 }, KITCHEN_NOW);
      food(db, slot.id, 1_100_000);
      sweepMinimum(db, slot.id);
      setRevenueMinimum(db, slot.id, { minimumMinor: 2_000_000 }, KITCHEN_NOW);
      const result = sweepMinimum(db, slot.id);
      const lines = listCharges(db, slot.id).filter((line) => line.source === 'MINIMUM');
      expect(lines).toHaveLength(1);
      expect(result.charge?.unit.amount).toBe(900_000);
    });
  });

  it('takes the line back off once the client spends past the floor', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 1_500_000 }, KITCHEN_NOW);
      food(db, slot.id, 1_100_000);
      sweepMinimum(db, slot.id);
      food(db, slot.id, 600_000);
      const result = sweepMinimum(db, slot.id);
      expect(result.removed).toBe(1);
      expect(result.charge).toBeUndefined();
      expect(result.standing.met).toBe(true);
      expect(listCharges(db, slot.id).some((line) => line.source === 'MINIMUM')).toBe(false);
    });
  });

  it('sits at the end of the charge list rather than in the middle of it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setRevenueMinimum(db, slot.id, { minimumMinor: 1_500_000 }, KITCHEN_NOW);
      food(db, slot.id, 1_100_000);
      sweepMinimum(db, slot.id);
      const lines = listCharges(db, slot.id);
      expect(lines[lines.length - 1]?.source).toBe('MINIMUM');
    });
  });
});
