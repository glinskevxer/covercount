import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { seedFunction, seedPropertyAccountBooking } from '../../support/fixtures.js';
import { seedFullCatalog } from '../../support/menu.js';
import { openCovers, setGuarantee } from '../../../src/covers/guarantee.js';
import {
  addSpecialMeal,
  allergensInTheRoom,
  assignSubstitute,
  coverBreakdown,
  findSpecialMeal,
  listSpecialMeals,
  removeSpecialMeal,
  requireSpecialMeal,
  totalSpecialCovers,
  unresolvedSpecialMeals,
} from '../../../src/covers/special.js';
import type { Database } from '../../../src/store/database.js';

const BEFORE = '2025-04-10T09:00:00.000Z';

function guaranteedFunction(db: Database, guarantee = 180) {
  const booking = seedPropertyAccountBooking(db);
  seedFullCatalog(db);
  const slot = seedFunction(db, booking.id);
  openCovers(db, slot.id, { packageCode: 'PLATED-THREE', contractDate: '2025-01-20' });
  setGuarantee(db, slot.id, guarantee, BEFORE);
  return slot;
}

describe('adding a special meal', () => {
  it('records the guest, the count and the reason', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      const meal = addSpecialMeal(
        db,
        slot.id,
        { guestName: 'A Okafor', covers: 2, diet: 'vegan', note: 'table 4' },
        BEFORE,
      );
      expect(meal.guestName).toBe('A Okafor');
      expect(meal.covers).toBe(2);
      expect(meal.diet).toBe('VEGAN');
      expect(meal.allergens).toEqual([]);
      expect(meal.note).toBe('table 4');
      expect(meal.substituteItemCode).toBeUndefined();
      expect(meal.createdAt).toBe(BEFORE);
    });
  });

  it('defaults to one cover', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      expect(addSpecialMeal(db, slot.id, { diet: 'VEGAN' }, BEFORE).covers).toBe(1);
    });
  });

  it('sorts and deduplicates the allergens', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      const meal = addSpecialMeal(db, slot.id, { allergens: ['wheat', 'MILK', 'milk'] }, BEFORE);
      expect(meal.allergens).toEqual(['MILK', 'WHEAT']);
    });
  });

  it('refuses a meal with no reason on it', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      expect(() => addSpecialMeal(db, slot.id, { guestName: 'Nobody' }, BEFORE)).toThrow(
        /needs a diet or an allergen on it/,
      );
    });
  });

  it('refuses a diet or allergen it does not track and a bad count', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      expect(() => addSpecialMeal(db, slot.id, { diet: 'PALEO' }, BEFORE)).toThrow(/not a diet/);
      expect(() => addSpecialMeal(db, slot.id, { allergens: ['CELERY'] }, BEFORE)).toThrow(
        /not an allergen/,
      );
      expect(() => addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 0 }, BEFORE)).toThrow(
        /one cover or more/,
      );
    });
  });

  it('refuses a meal on a function with no cover count open', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFullCatalog(db);
      const slot = seedFunction(db, booking.id);
      expect(() => addSpecialMeal(db, slot.id, { diet: 'VEGAN' }, BEFORE)).toThrow(
        /has no cover count open/,
      );
    });
  });
});

describe('special meals come out of the guarantee', () => {
  it('refuses more special covers than the guarantee carries', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db, 10);
      addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 8 }, BEFORE);
      expect(() => addSpecialMeal(db, slot.id, { diet: 'KOSHER', covers: 3 }, BEFORE)).toThrow(
        /guaranteed for 10 and already carries 8 special covers, so 3 more will not fit/,
      );
      expect(() =>
        addSpecialMeal(db, slot.id, { diet: 'KOSHER', covers: 2 }, BEFORE),
      ).not.toThrow();
    });
  });

  it('lets every cover be a special meal', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db, 4);
      addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 4 }, BEFORE);
      expect(totalSpecialCovers(db, slot.id)).toBe(4);
      expect(coverBreakdown(db, slot.id).standard).toBe(0);
    });
  });

  it('takes the special covers off the standard plate count', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db, 180);
      addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 12 }, BEFORE);
      addSpecialMeal(db, slot.id, { diet: 'GLUTEN-FREE', covers: 4 }, BEFORE);
      const breakdown = coverBreakdown(db, slot.id);
      expect(breakdown.guaranteed).toBe(180);
      expect(breakdown.special).toBe(16);
      expect(breakdown.standard).toBe(164);
      expect(breakdown.setFor).toBe(189);
    });
  });

  it('tallies by diet and calls an allergen only meal what it is', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db, 180);
      addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 12 }, BEFORE);
      addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 3 }, BEFORE);
      addSpecialMeal(db, slot.id, { allergens: ['SHELLFISH'], covers: 2 }, BEFORE);
      expect(coverBreakdown(db, slot.id).byDiet).toEqual([
        { diet: 'ALLERGEN-ONLY', covers: 2 },
        { diet: 'VEGAN', covers: 15 },
      ]);
    });
  });

  it('refuses a breakdown before there is a guarantee', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFullCatalog(db);
      const slot = seedFunction(db, booking.id);
      openCovers(db, slot.id, { contractDate: '2025-01-20' });
      expect(() => coverBreakdown(db, slot.id)).toThrow(/no guarantee, so there is no plate count/);
    });
  });

  it('takes a meal on an ungaranteed function without a ceiling to check', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFullCatalog(db);
      const slot = seedFunction(db, booking.id);
      openCovers(db, slot.id, { contractDate: '2025-01-20' });
      expect(() =>
        addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 500 }, BEFORE),
      ).not.toThrow();
    });
  });
});

describe('the substitution has to be safe', () => {
  it('takes a dish that carries none of the allergens', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      const meal = addSpecialMeal(
        db,
        slot.id,
        { allergens: ['SHELLFISH', 'MILK'], substituteItemCode: 'ROOT-PLATE' },
        BEFORE,
      );
      expect(meal.substituteItemCode).toBe('ROOT-PLATE');
    });
  });

  it('refuses a dish that still carries the allergen', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      expect(() =>
        addSpecialMeal(db, slot.id, { allergens: ['MILK'], substituteItemCode: 'HALIBUT' }, BEFORE),
      ).toThrow(/HALIBUT carries MILK and is not a substitute/);
    });
  });

  it('names every allergen the substitute still carries', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      expect(() =>
        addSpecialMeal(
          db,
          slot.id,
          { allergens: ['MILK', 'SHELLFISH'], substituteItemCode: 'LOBSTER-UP' },
          BEFORE,
        ),
      ).toThrow(/carries MILK, SHELLFISH/);
    });
  });

  it('refuses a dish that is not sold as the diet asked for', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      expect(() =>
        addSpecialMeal(db, slot.id, { diet: 'VEGAN', substituteItemCode: 'SHORT-RIB' }, BEFORE),
      ).toThrow(/SHORT-RIB is not sold as VEGAN/);
      expect(() =>
        addSpecialMeal(db, slot.id, { diet: 'VEGAN', substituteItemCode: 'ROOT-PLATE' }, BEFORE),
      ).not.toThrow();
    });
  });

  it('checks the diet and the allergens together', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      expect(() =>
        addSpecialMeal(
          db,
          slot.id,
          { diet: 'VEGETARIAN', allergens: ['MILK'], substituteItemCode: 'MUSHROOM-WELL' },
          BEFORE,
        ),
      ).toThrow(/carries MILK/);
      expect(() =>
        addSpecialMeal(
          db,
          slot.id,
          { diet: 'VEGETARIAN', allergens: ['MILK'], substituteItemCode: 'ROOT-PLATE' },
          BEFORE,
        ),
      ).not.toThrow();
    });
  });

  it('refuses a substitute that is not in the catalog', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      expect(() =>
        addSpecialMeal(db, slot.id, { diet: 'VEGAN', substituteItemCode: 'UNICORN' }, BEFORE),
      ).toThrow(/has no menu item UNICORN/);
    });
  });

  it('applies the same check when a substitute is assigned later', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      const meal = addSpecialMeal(db, slot.id, { allergens: ['MILK'] }, BEFORE);
      expect(() => assignSubstitute(db, meal.id, 'HALIBUT')).toThrow(/carries MILK/);
      expect(assignSubstitute(db, meal.id, 'ROOT-PLATE').substituteItemCode).toBe('ROOT-PLATE');
    });
  });
});

describe('reading the special meals on a function', () => {
  it('lists them in the order they arrived', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      addSpecialMeal(db, slot.id, { guestName: 'First', diet: 'VEGAN' }, BEFORE);
      addSpecialMeal(db, slot.id, { guestName: 'Second', diet: 'KOSHER' }, BEFORE);
      expect(listSpecialMeals(db, slot.id).map((row) => row.guestName)).toEqual([
        'First',
        'Second',
      ]);
    });
  });

  it('answers for one that is not there and takes one back out', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      const meal = addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 3 }, BEFORE);
      expect(findSpecialMeal(db, 9999)).toBeUndefined();
      expect(() => requireSpecialMeal(db, 9999)).toThrow(/is not on file/);
      expect(totalSpecialCovers(db, slot.id)).toBe(3);
      expect(removeSpecialMeal(db, meal.id)).toBe(true);
      expect(removeSpecialMeal(db, meal.id)).toBe(false);
      expect(totalSpecialCovers(db, slot.id)).toBe(0);
    });
  });

  it('collects every allergen the room has to be kept away from', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      addSpecialMeal(db, slot.id, { allergens: ['PEANUT', 'SESAME'] }, BEFORE);
      addSpecialMeal(db, slot.id, { allergens: ['PEANUT', 'SHELLFISH'] }, BEFORE);
      addSpecialMeal(db, slot.id, { diet: 'VEGAN' }, BEFORE);
      expect(allergensInTheRoom(db, slot.id)).toEqual(['PEANUT', 'SESAME', 'SHELLFISH']);
    });
  });

  it('names the meals nobody has decided what to cook for', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      const open = addSpecialMeal(db, slot.id, { diet: 'VEGAN' }, BEFORE);
      addSpecialMeal(db, slot.id, { diet: 'VEGAN', substituteItemCode: 'ROOT-PLATE' }, BEFORE);
      expect(unresolvedSpecialMeals(db, slot.id).map((row) => row.id)).toEqual([open.id]);
      assignSubstitute(db, open.id, 'ROOT-PLATE');
      expect(unresolvedSpecialMeals(db, slot.id)).toEqual([]);
    });
  });

  it('is empty on a function nobody has asked anything of', () => {
    withStore((db) => {
      const slot = guaranteedFunction(db);
      expect(listSpecialMeals(db, slot.id)).toEqual([]);
      expect(allergensInTheRoom(db, slot.id)).toEqual([]);
      expect(totalSpecialCovers(db, slot.id)).toBe(0);
    });
  });
});
