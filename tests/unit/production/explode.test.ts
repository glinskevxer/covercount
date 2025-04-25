import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import {
  assertEverySpecialResolved,
  batchDemand,
  ingredientDemand,
  ingredientDemandForFunctions,
  packWastePercent,
  packsFor,
  plateDemand,
} from '../../../src/production/explode.js';
import { addSpecialMeal } from '../../../src/covers/special.js';
import { setCourseSplit } from '../../../src/covers/selections.js';
import { formatQuantity, quantity } from '../../../src/core/quantity.js';

describe('plates per dish', () => {
  it('adds the split up across the courses', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(plateDemand(db, slot.id)).toEqual([
        { itemCode: 'BEET-TART', plates: 180 },
        { itemCode: 'HALIBUT', plates: 72 },
        { itemCode: 'SHORT-RIB', plates: 108 },
        { itemCode: 'SORBET', plates: 180 },
      ]);
    });
  });

  it('lands a special meal against the dish it was substituted with', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180, specialCovers: 12 });
      const rootPlate = plateDemand(db, slot.id).find((row) => row.itemCode === 'ROOT-PLATE');
      expect(rootPlate?.plates).toBe(12);
      const starter = plateDemand(db, slot.id).find((row) => row.itemCode === 'BEET-TART');
      expect(starter?.plates).toBe(168);
    });
  });

  it('refuses to explode while a special meal has no dish decided', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 4 }, KITCHEN_NOW);
      expect(() => assertEverySpecialResolved(db, slot.id)).toThrow(
        /carries 1 special meals with no dish decided/,
      );
    });
  });

  it('is happy once every special meal has a dish', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180, specialCovers: 12 });
      expect(() => assertEverySpecialResolved(db, slot.id)).not.toThrow();
    });
  });
});

describe('batches per recipe', () => {
  it('rounds a plate count up to whole batches', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const batches = batchDemand(db, slot.id);
      const rib = batches.find((row) => row.recipeCode === 'BRAISED-SHORT-RIB');
      expect(rib?.plates).toBe(108);
      expect(rib?.batches).toBe(6);
      const sorbet = batches.find((row) => row.recipeCode === 'BLOOD-ORANGE-SORBET');
      expect(sorbet?.plates).toBe(180);
      expect(sorbet?.batches).toBe(6);
    });
  });

  it('names the station each batch is made at', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const beet = batchDemand(db, slot.id).find((row) => row.recipeCode === 'BEET-TARTARE');
      expect(beet?.station).toBe('GARDE-MANGER');
    });
  });

  it('refuses a dish with no recipe behind it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180, split: false });
      setCourseSplit(db, slot.id, 'MAIN', [
        { itemCode: 'ROOT-PLATE', covers: 90 },
        { itemCode: 'HALIBUT', covers: 90 },
      ]);
      expect(() => batchDemand(db, slot.id)).not.toThrow();
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 180 }]);
      setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'CHOC-TART', covers: 180 }]);
      expect(() => batchDemand(db, slot.id)).toThrow(
        /CHOC-TART is on the split and no recipe on file makes it/,
      );
    });
  });
});

describe('what has to come out of the stores', () => {
  it('grosses a trimmed line up and rounds to whole packs', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const demand = ingredientDemand(db, slot.id);
      const rib = demand.find((row) => row.ingredientCode === 'SHORT-RIB');
      expect(formatQuantity(rib!.needed)).toBe('147.696 LB');
      expect(rib?.packs).toBe(4);
      expect(rib?.store).toBe('BUTCHER');
    });
  });

  it('walks the stores in picking order', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const stores = ingredientDemand(db, slot.id).map((row) => row.store);
      expect(stores).not.toEqual([]);
      expect(stores[0]).toBe('DRY');
      expect(stores.at(-1)).toBe('CELLAR');
    });
  });

  it('adds two recipes asking for the same ingredient into one row', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const oil = ingredientDemand(db, slot.id).filter((row) => row.ingredientCode === 'OLIVE-OIL');
      expect(oil).toHaveLength(1);
      expect(oil[0]?.needed.unit).toBe('L');
    });
  });

  it('leaves an ingredient out when nothing needs it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const codes = ingredientDemand(db, slot.id).map((row) => row.ingredientCode);
      expect(codes).not.toContain('ROOT-VEG');
    });
  });

  it('brings an ingredient in once a special meal needs it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180, specialCovers: 12 });
      const codes = ingredientDemand(db, slot.id).map((row) => row.ingredientCode);
      expect(codes).toContain('ROOT-VEG');
    });
  });
});

describe('packs and waste', () => {
  it('rounds any part pack up to a whole one', () => {
    expect(packsFor(quantity(40, 'LB'), quantity(40, 'LB'))).toBe(1);
    expect(packsFor(quantity(41, 'LB'), quantity(40, 'LB'))).toBe(2);
    expect(packsFor(quantity(0, 'LB'), quantity(40, 'LB'))).toBe(0);
    expect(packsFor(quantity(1, 'LB'), quantity(0, 'LB'))).toBe(0);
  });

  it('converts before it counts packs', () => {
    expect(packsFor(quantity(4, 'QT'), quantity(1, 'GAL'))).toBe(1);
    expect(packsFor(quantity(5, 'QT'), quantity(1, 'GAL'))).toBe(2);
  });

  it('reports how much of the last pack is left over', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const rib = ingredientDemand(db, slot.id).find((row) => row.ingredientCode === 'SHORT-RIB');
      expect(packWastePercent(rib!)).toBeGreaterThan(0);
      expect(packWastePercent(rib!)).toBeLessThan(100);
    });
  });
});

describe('a day sheet across functions', () => {
  it('adds the same ingredient across two functions and reprices the packs', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const twice = ingredientDemandForFunctions(db, [slot.id, slot.id]);
      const once = ingredientDemand(db, slot.id);
      const ribTwice = twice.find((row) => row.ingredientCode === 'SHORT-RIB');
      const ribOnce = once.find((row) => row.ingredientCode === 'SHORT-RIB');
      expect(ribTwice?.needed.milli).toBe((ribOnce?.needed.milli ?? 0) * 2);
      expect(ribTwice?.packs).toBe(8);
    });
  });

  it('is empty for no functions at all', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      expect(ingredientDemandForFunctions(db, [])).toEqual([]);
    });
  });
});
