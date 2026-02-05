import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { readyFunction } from '../../support/production.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { ratePercent } from '../../../src/core/rate.js';
import { setIngredientCost } from '../../../src/production/costing.js';
import { costPackage, functionFoodCost, packageMargin } from '../../../src/catalog/margin.js';
import { packageCourses } from '../../../src/catalog/packages.js';
import type { Database } from '../../../src/store/database.js';

const JAN = calendarDate('2025-01-01');
const PLATED = code('PLATED-THREE');
const RACK = code('RACK-2025');

function seedCosts(db: Database, on = JAN): void {
  const quotes: [string, number][] = [
    ['SHORT-RIB', 32_000],
    ['MIREPOIX', 1_400],
    ['RED-WINE', 4_200],
    ['VEAL-STOCK', 5_600],
    ['ROOT-VEG', 3_100],
    ['OLIVE-OIL', 6_400],
    ['BLOOD-ORANGE', 2_880],
    ['SUGAR', 1_850],
    ['BEETROOT', 2_200],
    ['HALIBUT-FILLET', 41_800],
    ['BUTTER', 12_600],
  ];
  for (const [item, pack] of quotes) {
    setIngredientCost(db, CANYON, code(item), on, pack);
  }
}

describe('costing a package', () => {
  it('takes the dearest choice in each course, not the average', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedCosts(db);
      const costed = costPackage(db, CANYON, PLATED, JAN);
      const main = costed.courses.find((course) => course.course === 'MAIN');
      expect(main?.options.length).toBeGreaterThan(1);
      expect(main?.choices).toBe(1);

      const dearest = main?.options[0]?.cost.amount ?? 0;
      const cheapest = main?.options[main.options.length - 1]?.cost.amount ?? 0;
      expect(dearest).toBeGreaterThan(cheapest);
      expect(main?.worstCase.amount).toBe(dearest);
    });
  });

  it('adds a second choice on rather than doubling the first', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedCosts(db);
      const one = costPackage(db, CANYON, PLATED, JAN);
      const main = one.courses.find((course) => course.course === 'MAIN');
      const [first, second] = main?.options ?? [];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(main?.worstCase.amount).toBe(first?.cost.amount);
    });
  });

  it('adds the courses up to the package cost', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedCosts(db);
      const costed = costPackage(db, CANYON, PLATED, JAN);
      const summed = costed.courses.reduce((total, course) => total + course.worstCase.amount, 0);
      expect(costed.cost.amount).toBe(summed);
      expect(costed.courses).toHaveLength(packageCourses(db, CANYON, PLATED).length);
    });
  });

  it('names the items no recipe covers rather than costing them at nothing', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const costed = costPackage(db, CANYON, PLATED, JAN);
      expect(costed.uncosted).toBeGreaterThan(0);
      expect(costed.cost.amount).toBe(0);
    });
  });

  it('follows the quotes in force on the date asked about', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedCosts(db);
      setIngredientCost(db, CANYON, code('HALIBUT-FILLET'), calendarDate('2025-04-01'), 60_000);
      const january = costPackage(db, CANYON, PLATED, JAN);
      const april = costPackage(db, CANYON, PLATED, calendarDate('2025-04-01'));
      expect(april.cost.amount).toBeGreaterThan(january.cost.amount);
    });
  });
});

describe('the margin on a package', () => {
  it('prices the worst case against the book', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedCosts(db);
      const margin = packageMargin(db, CANYON, PLATED, RACK, JAN);
      expect(margin.margin.price.amount).toBeGreaterThan(0);
      expect(margin.margin.cost.amount).toBe(margin.worstCase.cost.amount);
      expect(ratePercent(margin.margin.marginRate)).toBeGreaterThan(0);
      expect(ratePercent(margin.margin.marginRate)).toBeLessThan(100);
    });
  });

  it('says so when the book carries no price on that date', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedCosts(db);
      expect(() => packageMargin(db, CANYON, PLATED, RACK, calendarDate('2020-01-01'))).toThrow(
        /carries no price/,
      );
    });
  });
});

describe('what the room actually cost', () => {
  it('costs the split rather than the package', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedCosts(db);
      const actual = functionFoodCost(db, slot.id, JAN);
      expect(actual.covers).toBe(180);
      expect(actual.actualCost.amount).toBeGreaterThan(0);
      expect(actual.actualCost.amount).toBeLessThan(actual.worstCaseCost.amount);
    });
  });

  it('reports a per cover figure rounded up', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedCosts(db);
      const actual = functionFoodCost(db, slot.id, JAN);
      expect(actual.perCover.amount * actual.covers).toBeGreaterThanOrEqual(
        actual.actualCost.amount,
      );
    });
  });

  it('names what it could not cost', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const actual = functionFoodCost(db, slot.id, JAN);
      expect(actual.uncosted.length).toBeGreaterThan(0);
      expect(actual.actualCost.amount).toBe(0);
    });
  });
});
