import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedProperty } from '../../support/fixtures.js';
import { seedKitchen } from '../../support/kitchen.js';
import { seedFullCatalog } from '../../support/menu.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { money } from '../../../src/core/money.js';
import { ratePercent } from '../../../src/core/rate.js';
import {
  costHistory,
  costRecipe,
  findPackCost,
  marginOn,
  requirePackCost,
  setIngredientCost,
} from '../../../src/production/costing.js';
import type { Database } from '../../../src/store/database.js';

const JAN = calendarDate('2025-01-01');
const APR = calendarDate('2025-04-01');

/** Pack prices for the whole larder, so a recipe costs end to end. */
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
    setIngredientCost(db, CANYON, code(item), on, pack, 'Front Range Provisions');
  }
}

function larder(db: Database): void {
  seedProperty(db);
  seedFullCatalog(db);
  seedKitchen(db);
}

describe('what a pack costs', () => {
  it('reads back the price in force on a date', () => {
    withStore((db) => {
      larder(db);
      setIngredientCost(db, CANYON, code('SHORT-RIB'), JAN, 32_000, ' Front Range  ');
      const quoted = setIngredientCost(db, CANYON, code('SHORT-RIB'), APR, 36_500);
      expect(quoted.pack.amount).toBe(36_500);
      expect(findPackCost(db, CANYON, code('SHORT-RIB'), JAN)?.amount).toBe(32_000);
      expect(findPackCost(db, CANYON, code('SHORT-RIB'), calendarDate('2025-03-31'))?.amount).toBe(
        32_000,
      );
      expect(findPackCost(db, CANYON, code('SHORT-RIB'), APR)?.amount).toBe(36_500);
      expect(costHistory(db, CANYON, code('SHORT-RIB'))).toHaveLength(2);
    });
  });

  it('has nothing to say before the first quote', () => {
    withStore((db) => {
      larder(db);
      setIngredientCost(db, CANYON, code('SHORT-RIB'), APR, 36_500);
      expect(findPackCost(db, CANYON, code('SHORT-RIB'), JAN)).toBeUndefined();
      expect(() => requirePackCost(db, CANYON, code('SHORT-RIB'), JAN)).toThrow(
        /no quoted price on or before/,
      );
    });
  });

  it('replaces a quote for the same date rather than doubling it', () => {
    withStore((db) => {
      larder(db);
      setIngredientCost(db, CANYON, code('SHORT-RIB'), JAN, 32_000);
      setIngredientCost(db, CANYON, code('SHORT-RIB'), JAN, 33_500);
      expect(costHistory(db, CANYON, code('SHORT-RIB'))).toHaveLength(1);
      expect(findPackCost(db, CANYON, code('SHORT-RIB'), JAN)?.amount).toBe(33_500);
    });
  });

  it('refuses a negative price and an ingredient nobody stocks', () => {
    withStore((db) => {
      larder(db);
      expect(() => setIngredientCost(db, CANYON, code('SHORT-RIB'), JAN, -1)).toThrow(
        /nil or more/,
      );
      expect(() => setIngredientCost(db, CANYON, code('UNOBTANIUM'), JAN, 100)).toThrow(
        /has no ingredient/,
      );
    });
  });
});

describe('costing a recipe', () => {
  it('spreads the pack price over the quantity actually used', () => {
    withStore((db) => {
      larder(db);
      seedCosts(db);
      const costed = costRecipe(db, CANYON, code('BRAISED-SHORT-RIB'), JAN);
      const ribs = costed.lines.find((line) => line.ingredientCode === 'SHORT-RIB');
      // Sixteen pounds at sixty five percent yield is 24.616 pounds gross,
      // and a forty pound case is $320.
      expect(ribs?.gross.milli).toBe(24_616);
      expect(ribs?.lineCost.amount).toBe(19_693);
      expect(costed.lines).toHaveLength(4);
    });
  });

  it('adds the lines to the batch and divides down to the portion', () => {
    withStore((db) => {
      larder(db);
      seedCosts(db);
      const costed = costRecipe(db, CANYON, code('BRAISED-SHORT-RIB'), JAN);
      const summed = costed.lines.reduce((total, line) => total + line.lineCost.amount, 0);
      expect(costed.batchCost.amount).toBe(summed);
      expect(costed.batchPortions).toBe(20);
      expect(costed.portionCost.amount).toBe(Math.ceil(summed / 20));
    });
  });

  it('rounds the portion up rather than down', () => {
    withStore((db) => {
      larder(db);
      seedCosts(db);
      const costed = costRecipe(db, CANYON, code('BRAISED-SHORT-RIB'), JAN);
      expect(costed.portionCost.amount * costed.batchPortions).toBeGreaterThanOrEqual(
        costed.batchCost.amount,
      );
    });
  });

  it('follows the quote in force on the date asked about', () => {
    withStore((db) => {
      larder(db);
      seedCosts(db);
      setIngredientCost(db, CANYON, code('SHORT-RIB'), APR, 40_000);
      const january = costRecipe(db, CANYON, code('BRAISED-SHORT-RIB'), JAN);
      const april = costRecipe(db, CANYON, code('BRAISED-SHORT-RIB'), APR);
      expect(april.batchCost.amount).toBeGreaterThan(january.batchCost.amount);
      expect(april.portionCost.amount).toBeGreaterThan(january.portionCost.amount);
    });
  });

  it('refuses to cost a recipe whose ingredients nobody has priced', () => {
    withStore((db) => {
      larder(db);
      setIngredientCost(db, CANYON, code('SHORT-RIB'), JAN, 32_000);
      expect(() => costRecipe(db, CANYON, code('BRAISED-SHORT-RIB'), JAN)).toThrow(
        /MIREPOIX has no quoted price/,
      );
    });
  });

  it('converts across units when the recipe and the pack disagree', () => {
    withStore((db) => {
      larder(db);
      seedCosts(db);
      const costed = costRecipe(db, CANYON, code('BRAISED-SHORT-RIB'), JAN);
      const wine = costed.lines.find((line) => line.ingredientCode === 'RED-WINE');
      // The recipe asks in quarts, the cellar buys in three gallon cases.
      expect(wine?.gross.unit).toBe('QT');
      expect(wine?.packSize.unit).toBe('GAL');
      expect(wine?.lineCost.amount).toBe(1_050);
    });
  });
});

describe('the margin on a plate', () => {
  it('reads gross over price and cost over price', () => {
    const margin = marginOn(money(9_500, 'USD'), money(2_850, 'USD'));
    expect(margin.gross.amount).toBe(6_650);
    expect(ratePercent(margin.marginRate)).toBe(70);
    expect(ratePercent(margin.costRate)).toBe(30);
  });

  it('reports a loss rather than hiding one', () => {
    const margin = marginOn(money(2_000, 'USD'), money(2_850, 'USD'));
    expect(margin.gross.amount).toBe(-850);
    expect(ratePercent(margin.marginRate)).toBe(-42.5);
    expect(ratePercent(margin.costRate)).toBe(142.5);
  });

  it('says nothing about a plate that is not sold on its own', () => {
    const margin = marginOn(money(0, 'USD'), money(2_850, 'USD'));
    expect(margin.gross.amount).toBe(-2_850);
    expect(ratePercent(margin.marginRate)).toBe(0);
    expect(ratePercent(margin.costRate)).toBe(0);
  });

  it('will not mix currencies', () => {
    expect(() => marginOn(money(9_500, 'USD'), money(2_850, 'CAD'))).toThrow(
      /across two currencies/,
    );
  });
});
