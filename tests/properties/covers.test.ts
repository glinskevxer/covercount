/**
 * The guarantee engine, swept rather than sampled.
 *
 * The overset is a rate with a cap on it, the special meals come out of the
 * guarantee, and the split has to reach the standard count. Those three
 * interact, and the interactions are where the arithmetic goes wrong: an
 * overset that rounds the wrong way, a standard count that goes negative, a
 * split that adds up at one guarantee and not at the next.
 */

import { describe, expect, it } from 'vitest';
import { withStore } from '../support/store.js';
import { readyFunction, KITCHEN_NOW } from '../support/production.js';
import {
  billedCovers,
  oversetFor,
  recordServed,
  requireCovers,
  setCoversFor,
  setGuarantee,
  shortfallCovers,
  overageCovers,
} from '../../src/covers/guarantee.js';
import { addSpecialMeal, coverBreakdown, totalSpecialCovers } from '../../src/covers/special.js';
import { setCourseSplit, splitsAddUp } from '../../src/covers/selections.js';
import { rateFromPercent } from '../../src/core/rate.js';

const PERCENTS = [0, 1, 2.5, 5, 7.5, 10, 15];
const CAPS = [0, 1, 5, 25, 100, 10_000];

function counts(): number[] {
  const out: number[] = [];
  for (let covers = 0; covers <= 60; covers += 1) {
    out.push(covers);
  }
  for (const covers of [61, 99, 100, 101, 199, 200, 201, 399, 400, 401, 1000]) {
    out.push(covers);
  }
  return out;
}

describe('the overset', () => {
  it('is never negative and never over the cap', () => {
    for (const covers of counts()) {
      for (const percent of PERCENTS) {
        for (const cap of CAPS) {
          const extra = oversetFor(covers, rateFromPercent(percent), cap);
          expect(extra).toBeGreaterThanOrEqual(0);
          expect(extra).toBeLessThanOrEqual(cap);
          expect(Number.isInteger(extra)).toBe(true);
        }
      }
    }
  });

  it('never rounds a part cover down', () => {
    for (const covers of counts()) {
      for (const percent of PERCENTS) {
        const exact = (covers * percent) / 100;
        const extra = oversetFor(covers, rateFromPercent(percent), 10_000);
        expect(extra).toBeGreaterThanOrEqual(Math.ceil(exact - 1e-9));
      }
    }
  });

  it('never shrinks as the guarantee grows', () => {
    for (const percent of PERCENTS) {
      for (const cap of CAPS) {
        let previous = 0;
        for (const covers of counts().sort((left, right) => left - right)) {
          const extra = oversetFor(covers, rateFromPercent(percent), cap);
          expect(extra).toBeGreaterThanOrEqual(previous);
          previous = extra;
        }
      }
    }
  });

  it('sets the room for at least the guarantee, always', () => {
    for (const covers of counts()) {
      for (const percent of PERCENTS) {
        for (const cap of CAPS) {
          expect(setCoversFor(covers, rateFromPercent(percent), cap)).toBeGreaterThanOrEqual(
            covers,
          );
        }
      }
    }
  });

  it('gives a zero guarantee a zero overset whatever the rate', () => {
    for (const percent of PERCENTS) {
      expect(oversetFor(0, rateFromPercent(percent), 25)).toBe(0);
      expect(setCoversFor(0, rateFromPercent(percent), 25)).toBe(0);
    }
  });
});

describe('the billed count', () => {
  it('is never below the guarantee and never below what was served', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 100, split: false });
      for (const guarantee of [10, 50, 100, 150, 190]) {
        setGuarantee(db, slot.id, guarantee, KITCHEN_NOW);
        for (const served of [0, 1, guarantee - 1, guarantee, guarantee + 1, guarantee + 40]) {
          if (served < 0) {
            continue;
          }
          const covers = recordServed(db, slot.id, served, KITCHEN_NOW);
          expect(billedCovers(covers)).toBeGreaterThanOrEqual(guarantee);
          expect(billedCovers(covers)).toBeGreaterThanOrEqual(served);
          expect(billedCovers(covers)).toBe(Math.max(guarantee, served));
          expect(overageCovers(covers)).toBe(Math.max(0, served - guarantee));
          expect(shortfallCovers(covers)).toBe(Math.max(0, guarantee - served));
        }
      }
    });
  });
});

describe('special meals against the guarantee', () => {
  it('never leaves a negative standard count', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 100, split: false });
      for (const special of [1, 5, 20, 50, 99, 100]) {
        setGuarantee(db, slot.id, 100, KITCHEN_NOW);
        const already = totalSpecialCovers(db, slot.id);
        if (already + special > 100) {
          expect(() =>
            addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: special }, KITCHEN_NOW),
          ).toThrow(/will not fit/);
          continue;
        }
        addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: special }, KITCHEN_NOW);
        const breakdown = coverBreakdown(db, slot.id);
        expect(breakdown.standard).toBeGreaterThanOrEqual(0);
        expect(breakdown.standard + breakdown.special).toBe(breakdown.guaranteed);
      }
    });
  });
});

describe('the split against the standard count', () => {
  it('adds up at every guarantee it is redrawn for', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 100, split: false });
      for (const guarantee of [1, 2, 7, 33, 100, 190]) {
        setGuarantee(db, slot.id, guarantee, KITCHEN_NOW);
        const standard = coverBreakdown(db, slot.id).standard;
        const rib = Math.ceil(standard * 0.6);
        setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: standard }]);
        setCourseSplit(db, slot.id, 'MAIN', [
          { itemCode: 'SHORT-RIB', covers: rib },
          { itemCode: 'HALIBUT', covers: standard - rib },
        ]);
        setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'SORBET', covers: standard }]);
        expect(splitsAddUp(db, slot.id)).toBe(true);
      }
    });
  });

  it('stops adding up the moment the guarantee moves under it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 100 });
      expect(splitsAddUp(db, slot.id)).toBe(true);
      for (const guarantee of [99, 101, 150, 60]) {
        setGuarantee(db, slot.id, guarantee, KITCHEN_NOW);
        expect(splitsAddUp(db, slot.id)).toBe(false);
        expect(requireCovers(db, slot.id).guaranteedCovers).toBe(guarantee);
      }
    });
  });
});
