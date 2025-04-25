import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty } from '../../support/fixtures.js';
import { seedMenu } from '../../support/menu.js';
import { seedKitchen, seedLarder } from '../../support/kitchen.js';
import {
  batchesFor,
  createRecipe,
  findRecipe,
  grossQuantity,
  listRecipes,
  recipeForItem,
  recipeLines,
  requireRecipe,
} from '../../../src/production/recipes.js';
import { catalogCode } from '../../../src/core/ids.js';
import { formatQuantity } from '../../../src/core/quantity.js';

const code = catalogCode;

function ribRecipe(overrides: Partial<Parameters<typeof createRecipe>[2]> = {}) {
  return {
    code: 'BRAISED-SHORT-RIB',
    name: 'Braised short rib',
    batchPortions: 20,
    station: 'ROAST',
    lines: [
      { ingredientCode: 'SHORT-RIB', quantity: 16, unit: 'LB', yieldPercent: 65 },
      { ingredientCode: 'RED-WINE', quantity: 3, unit: 'QT' },
    ],
    ...overrides,
  };
}

describe('creating a recipe', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedLarder(db);
      const created = createRecipe(
        db,
        CANYON,
        ribRecipe({ itemCode: 'SHORT-RIB', method: 'sear, braise, rest' }),
        FIXED_NOW,
      );
      expect(created.code).toBe('BRAISED-SHORT-RIB');
      expect(created.batchPortions).toBe(20);
      expect(created.station).toBe('ROAST');
      expect(created.itemCode).toBe('SHORT-RIB');
      expect(created.method).toBe('sear, braise, rest');
      expect(created.createdAt).toBe(FIXED_NOW);
    });
  });

  it('numbers the lines in the order they were given', () => {
    withStore((db) => {
      seedProperty(db);
      seedLarder(db);
      createRecipe(db, CANYON, ribRecipe(), FIXED_NOW);
      const lines = recipeLines(db, CANYON, code('BRAISED-SHORT-RIB'));
      expect(lines.map((row) => row.position)).toEqual([1, 2]);
      expect(lines.map((row) => row.ingredientCode)).toEqual(['SHORT-RIB', 'RED-WINE']);
      expect(formatQuantity(lines[0]!.quantity)).toBe('16 LB');
      expect(lines[0]?.yieldPercent).toBe(65);
      expect(lines[1]?.yieldPercent).toBe(100);
    });
  });

  it('refuses a blank name, a batch of nothing and an unknown station', () => {
    withStore((db) => {
      seedProperty(db);
      seedLarder(db);
      expect(() => createRecipe(db, CANYON, ribRecipe({ name: ' ' }), FIXED_NOW)).toThrow(
        /needs a name/,
      );
      expect(() => createRecipe(db, CANYON, ribRecipe({ batchPortions: 0 }), FIXED_NOW)).toThrow(
        /at least one portion/,
      );
      expect(() => createRecipe(db, CANYON, ribRecipe({ station: 'WOK' }), FIXED_NOW)).toThrow(
        /not a station in this kitchen/,
      );
    });
  });

  it('refuses a recipe with no lines and one that lists an ingredient twice', () => {
    withStore((db) => {
      seedProperty(db);
      seedLarder(db);
      expect(() => createRecipe(db, CANYON, ribRecipe({ lines: [] }), FIXED_NOW)).toThrow(
        /has no ingredients on it/,
      );
      expect(() =>
        createRecipe(
          db,
          CANYON,
          ribRecipe({
            lines: [
              { ingredientCode: 'SHORT-RIB', quantity: 1, unit: 'LB' },
              { ingredientCode: 'short-rib', quantity: 2, unit: 'LB' },
            ],
          }),
          FIXED_NOW,
        ),
      ).toThrow(/lists SHORT-RIB twice/);
    });
  });

  it('refuses a unit that does not measure what the ingredient is bought in', () => {
    withStore((db) => {
      seedProperty(db);
      seedLarder(db);
      expect(() =>
        createRecipe(
          db,
          CANYON,
          ribRecipe({ lines: [{ ingredientCode: 'SHORT-RIB', quantity: 1, unit: 'GAL' }] }),
          FIXED_NOW,
        ),
      ).toThrow(/asks for SHORT-RIB in GAL but it is bought in LB/);
    });
  });

  it('refuses a quantity of nothing and a yield outside one to a hundred', () => {
    withStore((db) => {
      seedProperty(db);
      seedLarder(db);
      const line = (extra: Record<string, unknown>) =>
        ribRecipe({ lines: [{ ingredientCode: 'SHORT-RIB', quantity: 1, unit: 'LB', ...extra }] });
      expect(() =>
        createRecipe(
          db,
          CANYON,
          ribRecipe({ lines: [{ ingredientCode: 'SHORT-RIB', quantity: 0, unit: 'LB' }] }),
          FIXED_NOW,
        ),
      ).toThrow(/which is not a quantity/);
      expect(() => createRecipe(db, CANYON, line({ yieldPercent: 0 }), FIXED_NOW)).toThrow(
        /whole percent between 1 and 100/,
      );
      expect(() => createRecipe(db, CANYON, line({ yieldPercent: 101 }), FIXED_NOW)).toThrow(
        /whole percent between 1 and 100/,
      );
    });
  });

  it('refuses an ingredient or a menu item that is not on file', () => {
    withStore((db) => {
      seedProperty(db);
      seedLarder(db);
      expect(() =>
        createRecipe(
          db,
          CANYON,
          ribRecipe({ lines: [{ ingredientCode: 'UNICORN', quantity: 1, unit: 'LB' }] }),
          FIXED_NOW,
        ),
      ).toThrow(/has no ingredient UNICORN/);
      expect(() => createRecipe(db, CANYON, ribRecipe({ itemCode: 'UNICORN' }), FIXED_NOW)).toThrow(
        /has no menu item UNICORN/,
      );
    });
  });

  it('leaves nothing behind when it refuses and refuses a duplicate code', () => {
    withStore((db) => {
      seedProperty(db);
      seedLarder(db);
      expect(() =>
        createRecipe(
          db,
          CANYON,
          ribRecipe({ lines: [{ ingredientCode: 'UNICORN', quantity: 1, unit: 'LB' }] }),
          FIXED_NOW,
        ),
      ).toThrow();
      expect(findRecipe(db, CANYON, code('BRAISED-SHORT-RIB'))).toBeUndefined();
      createRecipe(db, CANYON, ribRecipe(), FIXED_NOW);
      expect(() => createRecipe(db, CANYON, ribRecipe(), FIXED_NOW)).toThrow(
        /already has a recipe/,
      );
    });
  });
});

describe('the yield factor', () => {
  it('leaves a hundred percent line alone', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedKitchen(db);
      const lines = recipeLines(db, CANYON, code('BRAISED-SHORT-RIB'));
      const wine = lines.find((row) => row.ingredientCode === 'RED-WINE');
      expect(formatQuantity(grossQuantity(wine!))).toBe('3 QT');
    });
  });

  it('grosses a trimmed line up to what has to be bought', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedKitchen(db);
      const lines = recipeLines(db, CANYON, code('BRAISED-SHORT-RIB'));
      const rib = lines.find((row) => row.ingredientCode === 'SHORT-RIB');
      expect(formatQuantity(grossQuantity(rib!))).toBe('24.616 LB');
      const mirepoix = lines.find((row) => row.ingredientCode === 'MIREPOIX');
      expect(formatQuantity(grossQuantity(mirepoix!))).toBe('4.706 LB');
    });
  });

  it('rounds the gross up rather than down', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedKitchen(db);
      const lines = recipeLines(db, CANYON, code('BLOOD-ORANGE-SORBET'));
      const orange = lines.find((row) => row.ingredientCode === 'BLOOD-ORANGE');
      expect(formatQuantity(grossQuantity(orange!))).toBe('53.334 EA');
    });
  });
});

describe('scaling a recipe to a plate count', () => {
  it('takes whole batches', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedKitchen(db);
      const rib = requireRecipe(db, CANYON, code('BRAISED-SHORT-RIB'));
      expect(batchesFor(rib, 20)).toBe(1);
      expect(batchesFor(rib, 21)).toBe(2);
      expect(batchesFor(rib, 180)).toBe(9);
      expect(batchesFor(rib, 181)).toBe(10);
      expect(batchesFor(rib, 0)).toBe(0);
    });
  });

  it('refuses a plate count that is not a whole number', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedKitchen(db);
      const rib = requireRecipe(db, CANYON, code('BRAISED-SHORT-RIB'));
      expect(() => batchesFor(rib, 1.5)).toThrow(/whole number/);
      expect(() => batchesFor(rib, -1)).toThrow(/whole number/);
    });
  });
});

describe('reading recipes', () => {
  it('lists in code order and filters by station and item', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedKitchen(db);
      expect(listRecipes(db, CANYON).map((row) => row.code)).toEqual([
        'BEET-TARTARE',
        'BLOOD-ORANGE-SORBET',
        'BRAISED-SHORT-RIB',
        'ROAST-HALIBUT',
        'WINTER-ROOT-PLATE',
      ]);
      expect(listRecipes(db, CANYON, { station: 'GARDE-MANGER' }).map((row) => row.code)).toEqual([
        'BEET-TARTARE',
        'WINTER-ROOT-PLATE',
      ]);
      expect(listRecipes(db, CANYON, { itemCode: 'SORBET' }).map((row) => row.code)).toEqual([
        'BLOOD-ORANGE-SORBET',
      ]);
      expect(() => listRecipes(db, CANYON, { station: 'WOK' })).toThrow(/not a station/);
    });
  });

  it('finds the recipe behind a menu item', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedKitchen(db);
      expect(recipeForItem(db, CANYON, code('SHORT-RIB'))?.code).toBe('BRAISED-SHORT-RIB');
      expect(recipeForItem(db, CANYON, code('HALIBUT'))?.code).toBe('ROAST-HALIBUT');
      expect(recipeForItem(db, CANYON, code('MUSHROOM-WELL'))).toBeUndefined();
    });
  });

  it('answers for a recipe that is not there', () => {
    withStore((db) => {
      seedProperty(db);
      expect(findRecipe(db, CANYON, code('NOTHING'))).toBeUndefined();
      expect(() => requireRecipe(db, CANYON, code('NOTHING'))).toThrow(/has no recipe/);
      expect(recipeLines(db, CANYON, code('NOTHING'))).toEqual([]);
    });
  });
});
