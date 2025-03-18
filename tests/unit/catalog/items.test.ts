import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty } from '../../support/fixtures.js';
import { seedMenu } from '../../support/menu.js';
import {
  ALLERGEN_BLOCKS_DIET,
  createItem,
  findItem,
  itemAllergens,
  itemDiets,
  itemsWithoutAllergens,
  listItems,
  requireItem,
  setItemActive,
  setItemAllergens,
  setItemDiets,
} from '../../../src/catalog/items.js';
import { catalogCode } from '../../../src/core/ids.js';

const code = catalogCode;

describe('creating a menu item', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      seedProperty(db);
      const item = createItem(
        db,
        CANYON,
        {
          code: 'short-rib',
          name: '  Braised short rib  ',
          kind: 'food',
          course: 'main',
          description: 'four hour braise, red wine',
        },
        FIXED_NOW,
      );
      expect(item.code).toBe('SHORT-RIB');
      expect(item.name).toBe('Braised short rib');
      expect(item.kind).toBe('FOOD');
      expect(item.course).toBe('MAIN');
      expect(item.soldBy).toBe('PERSON');
      expect(item.isUpcharge).toBe(false);
      expect(item.active).toBe(true);
      expect(item.description).toBe('four hour braise, red wine');
      expect(item.createdAt).toBe(FIXED_NOW);
    });
  });

  it('stores allergens and diets sorted and deduplicated', () => {
    withStore((db) => {
      seedProperty(db);
      createItem(
        db,
        CANYON,
        {
          code: 'CAESAR',
          name: 'Caesar',
          kind: 'FOOD',
          course: 'SALAD',
          allergens: ['wheat', 'MILK', 'milk', ' egg '],
          diets: ['low-sodium', 'LOW-SODIUM'],
        },
        FIXED_NOW,
      );
      expect(itemAllergens(db, CANYON, code('CAESAR'))).toEqual(['EGG', 'MILK', 'WHEAT']);
      expect(itemDiets(db, CANYON, code('CAESAR'))).toEqual(['LOW-SODIUM']);
    });
  });

  it('refuses a blank name, an unknown kind, course or unit', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { code: 'X', name: 'X', kind: 'FOOD' };
      expect(() => createItem(db, CANYON, { ...base, name: ' ' }, FIXED_NOW)).toThrow(
        /needs a name/,
      );
      expect(() => createItem(db, CANYON, { ...base, kind: 'MERCH' }, FIXED_NOW)).toThrow(
        /not a kind of thing/,
      );
      expect(() => createItem(db, CANYON, { ...base, course: 'AMUSE' }, FIXED_NOW)).toThrow(
        /not a course/,
      );
      expect(() => createItem(db, CANYON, { ...base, soldBy: 'TRAY' }, FIXED_NOW)).toThrow(
        /not a unit of sale/,
      );
    });
  });

  it('refuses a course on something that is not food or drink', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        createItem(
          db,
          CANYON,
          { code: 'SCREEN', name: 'Screen', kind: 'AV', course: 'MAIN' },
          FIXED_NOW,
        ),
      ).toThrow(/cannot sit in the MAIN course/);
      expect(
        createItem(db, CANYON, { code: 'SCREEN', name: 'Screen', kind: 'AV' }, FIXED_NOW).course,
      ).toBe('NONE');
    });
  });

  it('refuses an allergen or a diet it does not track', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { code: 'X', name: 'X', kind: 'FOOD' };
      expect(() => createItem(db, CANYON, { ...base, allergens: ['CELERY'] }, FIXED_NOW)).toThrow(
        /not an allergen this catalog tracks/,
      );
      expect(() => createItem(db, CANYON, { ...base, diets: ['PALEO'] }, FIXED_NOW)).toThrow(
        /not a diet this catalog tracks/,
      );
    });
  });

  it('refuses a duplicate code', () => {
    withStore((db) => {
      seedProperty(db);
      createItem(db, CANYON, { code: 'X', name: 'X', kind: 'FOOD' }, FIXED_NOW);
      expect(() =>
        createItem(db, CANYON, { code: 'X', name: 'X', kind: 'FOOD' }, FIXED_NOW),
      ).toThrow(/already has a menu item X/);
    });
  });
});

describe('an allergen and a diet cannot contradict each other', () => {
  it('refuses milk sold as dairy free', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        createItem(
          db,
          CANYON,
          { code: 'X', name: 'X', kind: 'FOOD', allergens: ['MILK'], diets: ['DAIRY-FREE'] },
          FIXED_NOW,
        ),
      ).toThrow(/carries MILK and cannot also be sold as DAIRY-FREE/);
    });
  });

  it('refuses shellfish sold as pescatarian and pork sold as halal', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        createItem(
          db,
          CANYON,
          { code: 'X', name: 'X', kind: 'FOOD', allergens: ['SHELLFISH'], diets: ['PESCATARIAN'] },
          FIXED_NOW,
        ),
      ).toThrow(/cannot also be sold as PESCATARIAN/);
      expect(() =>
        createItem(
          db,
          CANYON,
          { code: 'Y', name: 'Y', kind: 'FOOD', allergens: ['PORK'], diets: ['HALAL'] },
          FIXED_NOW,
        ),
      ).toThrow(/cannot also be sold as HALAL/);
    });
  });

  it('allows a fish dish sold as pescatarian', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        createItem(
          db,
          CANYON,
          {
            code: 'HALIBUT',
            name: 'Halibut',
            kind: 'FOOD',
            allergens: ['FISH'],
            diets: ['PESCATARIAN'],
          },
          FIXED_NOW,
        ),
      ).not.toThrow();
    });
  });

  it('allows soy, sesame and sulphite alongside every diet', () => {
    withStore((db) => {
      seedProperty(db);
      expect(ALLERGEN_BLOCKS_DIET.SOY).toEqual([]);
      expect(ALLERGEN_BLOCKS_DIET.SESAME).toEqual([]);
      expect(ALLERGEN_BLOCKS_DIET.SULPHITE).toEqual([]);
      expect(() =>
        createItem(
          db,
          CANYON,
          {
            code: 'TOFU',
            name: 'Tofu',
            kind: 'FOOD',
            allergens: ['SOY', 'SESAME'],
            diets: ['VEGAN', 'GLUTEN-FREE'],
          },
          FIXED_NOW,
        ),
      ).not.toThrow();
    });
  });

  it('names a blocked diet for every allergen it tracks', () => {
    for (const blocked of Object.values(ALLERGEN_BLOCKS_DIET)) {
      expect(Array.isArray(blocked)).toBe(true);
    }
  });

  it('holds the contradiction rule on a later change too', () => {
    withStore((db) => {
      seedProperty(db);
      createItem(
        db,
        CANYON,
        { code: 'SOUP', name: 'Soup', kind: 'FOOD', diets: ['VEGAN'] },
        FIXED_NOW,
      );
      expect(() => setItemAllergens(db, CANYON, code('SOUP'), ['MILK'])).toThrow(
        /cannot also be sold as VEGAN/,
      );
      expect(itemAllergens(db, CANYON, code('SOUP'))).toEqual([]);

      setItemAllergens(db, CANYON, code('SOUP'), ['SOY']);
      expect(() => setItemDiets(db, CANYON, code('SOUP'), ['VEGAN', 'NUT-FREE'])).not.toThrow();
      expect(() => setItemAllergens(db, CANYON, code('SOUP'), ['SOY', 'PEANUT'])).toThrow(
        /cannot also be sold as NUT-FREE/,
      );
      expect(itemAllergens(db, CANYON, code('SOUP'))).toEqual(['SOY']);
    });
  });
});

describe('reading the catalog', () => {
  it('answers for an item that is not there', () => {
    withStore((db) => {
      seedProperty(db);
      expect(findItem(db, CANYON, code('NOTHING'))).toBeUndefined();
      expect(() => requireItem(db, CANYON, code('NOTHING'))).toThrow(/has no menu item/);
    });
  });

  it('lists in code order and filters by course and kind', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      const all = listItems(db, CANYON);
      expect(all.length).toBeGreaterThan(10);
      expect([...all].map((row) => row.code)).toEqual([...all].map((row) => row.code).sort());

      const mains = listItems(db, CANYON, { course: 'MAIN' }).map((row) => row.code);
      expect(mains).toEqual(['HALIBUT', 'LOBSTER-UP', 'MUSHROOM-WELL', 'ROOT-PLATE', 'SHORT-RIB']);
      expect(listItems(db, CANYON, { kind: 'AV' }).map((row) => row.code)).toEqual(['SCREEN']);
    });
  });

  it('filters out what has been taken off the menu', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      setItemActive(db, CANYON, code('HALIBUT'), false);
      expect(
        listItems(db, CANYON, { course: 'MAIN', activeOnly: true }).map((r) => r.code),
      ).toEqual(['LOBSTER-UP', 'MUSHROOM-WELL', 'ROOT-PLATE', 'SHORT-RIB']);
      expect(listItems(db, CANYON, { course: 'MAIN' })).toHaveLength(5);
      expect(setItemActive(db, CANYON, code('HALIBUT'), true).active).toBe(true);
    });
  });

  it('refuses a filter on a course or kind it does not know', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => listItems(db, CANYON, { course: 'AMUSE' })).toThrow(/not a course/);
      expect(() => listItems(db, CANYON, { kind: 'MERCH' })).toThrow(/not a kind of thing/);
    });
  });
});

describe('finding something a guest can eat', () => {
  it('drops every item carrying one of the named allergens', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      const safe = itemsWithoutAllergens(db, CANYON, ['SHELLFISH', 'MILK'], { course: 'MAIN' });
      expect(safe.map((row) => row.code)).toEqual(['ROOT-PLATE', 'SHORT-RIB']);
    });
  });

  it('returns everything when no allergen is named', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(itemsWithoutAllergens(db, CANYON, [], { course: 'MAIN' })).toHaveLength(5);
    });
  });

  it('can come back empty', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      const nothing = itemsWithoutAllergens(db, CANYON, ['FISH', 'MILK', 'SHELLFISH', 'BEEF'], {
        course: 'MAIN',
      });
      expect(nothing.map((row) => row.code)).toEqual(['ROOT-PLATE']);
    });
  });
});
