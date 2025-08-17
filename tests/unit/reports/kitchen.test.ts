import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import {
  packsByStore,
  pickList,
  pickListForFunctions,
  productionSheet,
  renderPickList,
  renderProductionSheet,
} from '../../../src/reports/kitchen.js';
import { addSpecialMeal } from '../../../src/covers/special.js';
import { setFunctionStatus } from '../../../src/booking/functions.js';
import { calendarDate } from '../../../src/core/calendar.js';

const d = calendarDate;

describe('the production sheet', () => {
  it('groups the batches by station', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const sheet = productionSheet(db, slot.id);
      expect(sheet.rows.map((row) => row.station)).toEqual([
        'FISH',
        'GARDE-MANGER',
        'PASTRY',
        'ROAST',
      ]);
      const rib = sheet.rows.find((row) => row.recipeCode === 'BRAISED-SHORT-RIB');
      expect(rib?.plates).toBe(108);
      expect(rib?.batches).toBe(6);
      expect(rib?.batchPortions).toBe(20);
      expect(rib?.recipeName).toBe('Braised short rib');
    });
  });

  it('carries the cover breakdown at the top', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180, specialCovers: 12 });
      const sheet = productionSheet(db, slot.id);
      expect(sheet.guaranteed).toBe(180);
      expect(sheet.standard).toBe(168);
      expect(sheet.special).toBe(12);
      expect(sheet.functionName).toBe('Awards Dinner');
    });
  });

  it('names every allergen the room has to be kept away from', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      addSpecialMeal(
        db,
        slot.id,
        { covers: 2, allergens: ['PEANUT', 'SESAME'], substituteItemCode: 'ROOT-PLATE' },
        KITCHEN_NOW,
      );
      const sheet = productionSheet(db, slot.id);
      expect(sheet.allergens).toEqual(['PEANUT', 'SESAME']);
      expect(sheet.specialNotes[0]).toContain('Winter root plate');
      expect(sheet.specialNotes[0]).toContain('PEANUT SESAME');
    });
  });

  it('refuses to draw while a special meal has no dish', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      addSpecialMeal(db, slot.id, { covers: 2, diet: 'VEGAN' }, KITCHEN_NOW);
      expect(() => productionSheet(db, slot.id)).toThrow(/no dish decided/);
    });
  });

  it('prints one line a recipe under its station', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180, specialCovers: 12 });
      const text = renderProductionSheet(productionSheet(db, slot.id));
      expect(text).toContain('PRODUCTION SHEET  FN-2025-0001  Awards Dinner');
      expect(text).toContain('180 guaranteed, 168 standard plates, 12 special');
      expect(text).toContain('ROAST');
      expect(text).toContain('Braised short rib');
      expect(text).toContain('SPECIAL MEALS');
    });
  });
});

describe('the pick list', () => {
  it('walks the stores in picking order', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const list = pickList(db, CANYON, d('2025-04-18'));
      expect(list.functionIds).toEqual([slot.id]);
      expect(list.rows[0]?.store).toBe('DRY');
      expect(list.rows.at(-1)?.store).toBe('CELLAR');
    });
  });

  it('adds two functions on the same date together', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const twice = pickListForFunctions(db, d('2025-04-18'), [slot.id, slot.id]);
      const once = pickListForFunctions(db, d('2025-04-18'), [slot.id]);
      const ribTwice = twice.rows.find((row) => row.ingredientCode === 'SHORT-RIB');
      const ribOnce = once.rows.find((row) => row.ingredientCode === 'SHORT-RIB');
      expect(ribTwice?.packs).toBe((ribOnce?.packs ?? 0) * 2);
    });
  });

  it('leaves a released function out', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setFunctionStatus(db, slot.id, 'RELEASED', KITCHEN_NOW);
      const list = pickList(db, CANYON, d('2025-04-18'));
      expect(list.functionIds).toEqual([]);
      expect(list.rows).toEqual([]);
    });
  });

  it('is empty on a date with nothing in the diary', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const list = pickList(db, CANYON, d('2025-04-20'));
      expect(renderPickList(list)).toContain('nothing is in the diary');
      expect(renderPickList(list)).toContain('nothing to pick');
    });
  });

  it('counts packs by store for the porter', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const tally = packsByStore(pickListForFunctions(db, d('2025-04-18'), [slot.id]));
      expect(tally.find((row) => row.store === 'BUTCHER')?.packs).toBe(4);
      expect(tally.every((row) => row.packs > 0)).toBe(true);
    });
  });

  it('prints the name, the need and the packs', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const text = renderPickList(pickListForFunctions(db, d('2025-04-18'), [slot.id]));
      expect(text).toContain('PICK LIST  Fri 18 Apr 2025');
      expect(text).toContain('BUTCHER');
      expect(text).toContain('Beef short rib, bone in');
      expect(text).toContain('147.696 LB');
    });
  });
});
