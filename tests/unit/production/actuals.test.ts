import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { ratePercent } from '../../../src/core/rate.js';
import {
  listActuals,
  productionVariance,
  recordProduced,
  suggestFactor,
} from '../../../src/production/actuals.js';
import { setProductionFactor } from '../../../src/production/factors.js';
import { batchDemand } from '../../../src/production/explode.js';

const RIB = code('BRAISED-SHORT-RIB');

describe('recording what the kitchen made', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const row = recordProduced(
        db,
        slot.id,
        RIB,
        { produced: 120, returned: 14, note: '  last pan would not divide  ' },
        KITCHEN_NOW,
      );
      expect(row.produced).toBe(120);
      expect(row.returned).toBe(14);
      expect(row.note).toBe('last pan would not divide');
      expect(listActuals(db, slot.id)).toHaveLength(1);
    });
  });

  it('replaces a recipe rather than doubling it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      recordProduced(db, slot.id, RIB, { produced: 120 }, KITCHEN_NOW);
      recordProduced(db, slot.id, RIB, { produced: 132, returned: 8 }, KITCHEN_NOW);
      const rows = listActuals(db, slot.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.produced).toBe(132);
      expect(rows[0]?.returned).toBe(8);
    });
  });

  it('will not take back more than went out', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(() =>
        recordProduced(db, slot.id, RIB, { produced: 100, returned: 101 }, KITCHEN_NOW),
      ).toThrow(/cannot come back when only 100 went out/);
    });
  });

  it('refuses fractions and negatives and an unknown recipe', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(() => recordProduced(db, slot.id, RIB, { produced: 1.5 }, KITCHEN_NOW)).toThrow(
        /whole number/,
      );
      expect(() =>
        recordProduced(db, slot.id, RIB, { produced: 10, returned: -1 }, KITCHEN_NOW),
      ).toThrow(/nil or more/);
      expect(() =>
        recordProduced(db, slot.id, code('CHICKEN-KIEV'), { produced: 10 }, KITCHEN_NOW),
      ).toThrow(/recipe/);
    });
  });
});

describe('plan against actual', () => {
  it('measures over production against the plan, not against the plates', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setProductionFactor(db, CANYON, 'PLATED', 1_150_000);
      const plan = batchDemand(db, slot.id).find((row) => row.recipeCode === RIB);
      expect(plan?.plates).toBe(108);
      expect(plan?.produced).toBe(125);

      recordProduced(db, slot.id, RIB, { produced: 140, returned: 20 }, KITCHEN_NOW);
      const row = productionVariance(db, slot.id).rows[0];
      expect(row?.planned).toBe(125);
      expect(row?.overProduction).toBe(15);
      expect(ratePercent(row?.wasteRate ?? { ppm: 0 })).toBeCloseTo(14.2857, 3);
      expect(row?.ranOut).toBe(false);
    });
  });

  it('says a recipe ran out when production fell under the plate count', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      recordProduced(db, slot.id, RIB, { produced: 100 }, KITCHEN_NOW);
      const row = productionVariance(db, slot.id).rows[0];
      expect(row?.plates).toBe(108);
      expect(row?.ranOut).toBe(true);
      expect(ratePercent(row?.wasteRate ?? { ppm: 1 })).toBe(0);
    });
  });

  it('counts the recipes nobody wrote down', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const planned = batchDemand(db, slot.id).length;
      expect(productionVariance(db, slot.id).unrecorded).toBe(planned);
      recordProduced(db, slot.id, RIB, { produced: 110 }, KITCHEN_NOW);
      expect(productionVariance(db, slot.id).unrecorded).toBe(planned - 1);
    });
  });

  it('totals production and returns across the whole function', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      recordProduced(db, slot.id, RIB, { produced: 120, returned: 12 }, KITCHEN_NOW);
      recordProduced(
        db,
        slot.id,
        code('ROAST-HALIBUT'),
        { produced: 80, returned: 8 },
        KITCHEN_NOW,
      );
      const variance = productionVariance(db, slot.id);
      expect(variance.produced).toBe(200);
      expect(variance.returned).toBe(20);
      expect(ratePercent(variance.wasteRate)).toBe(10);
    });
  });
});

describe('reading the factor off the nights that already happened', () => {
  it('suggests served over plates', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      // 108 rib plates, 72 halibut. Every portion made was eaten.
      recordProduced(db, slot.id, RIB, { produced: 130, returned: 0 }, KITCHEN_NOW);
      recordProduced(
        db,
        slot.id,
        code('ROAST-HALIBUT'),
        { produced: 86, returned: 0 },
        KITCHEN_NOW,
      );
      const suggestion = suggestFactor(db, [slot.id]);
      expect(suggestion.serviceStyle).toBe('PLATED');
      expect(suggestion.platesRead).toBe(180);
      expect(suggestion.servedRead).toBe(216);
      expect(ratePercent(suggestion.suggested)).toBe(120);
      expect(ratePercent(suggestion.current)).toBe(100);
    });
  });

  it('never suggests making less than the plate count', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      recordProduced(db, slot.id, RIB, { produced: 130, returned: 60 }, KITCHEN_NOW);
      recordProduced(
        db,
        slot.id,
        code('ROAST-HALIBUT'),
        { produced: 86, returned: 40 },
        KITCHEN_NOW,
      );
      const suggestion = suggestFactor(db, [slot.id]);
      expect(suggestion.servedRead).toBe(116);
      expect(ratePercent(suggestion.suggested)).toBe(100);
    });
  });

  it('refuses to mix two service styles in one reading', () => {
    withStore((db) => {
      const plated = readyFunction(db, { guarantee: 180 });
      recordProduced(db, plated.id, RIB, { produced: 130 }, KITCHEN_NOW);
      expect(() => suggestFactor(db, [])).toThrow(/at least one recorded function/);
    });
  });

  it('says so when nothing has been recorded', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(() => suggestFactor(db, [slot.id])).toThrow(/production actual recorded against it/);
    });
  });
});
