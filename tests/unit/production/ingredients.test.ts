import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty } from '../../support/fixtures.js';
import {
  createIngredient,
  findIngredient,
  listIngredients,
  requireIngredient,
  setIngredientActive,
} from '../../../src/production/ingredients.js';
import {
  STATIONS,
  STORES,
  isColdStore,
  isRequisitionStatus,
  isStation,
  isStoreArea,
  pickOrder,
} from '../../../src/production/types.js';
import { catalogCode } from '../../../src/core/ids.js';
import { formatQuantity } from '../../../src/core/quantity.js';

const code = catalogCode;

describe('the production vocabularies', () => {
  it('recognises a store, a station and a requisition status', () => {
    for (const store of STORES) {
      expect(isStoreArea(store)).toBe(true);
    }
    expect(isStoreArea('WINE')).toBe(false);
    for (const station of STATIONS) {
      expect(isStation(station)).toBe(true);
    }
    expect(isStation('WOK')).toBe(false);
    expect(isRequisitionStatus('ISSUED')).toBe(true);
    expect(isRequisitionStatus('SENT')).toBe(false);
  });

  it('knows which stores are cold', () => {
    expect(isColdStore('CHILL')).toBe(true);
    expect(isColdStore('FREEZE')).toBe(true);
    expect(isColdStore('PRODUCE')).toBe(true);
    expect(isColdStore('DRY')).toBe(false);
    expect(isColdStore('NONFOOD')).toBe(false);
  });

  it('walks the picker from dry goods towards the freezer', () => {
    expect(pickOrder('DRY')).toBeLessThan(pickOrder('CHILL'));
    expect(pickOrder('CHILL')).toBeLessThan(pickOrder('FREEZE'));
  });
});

describe('creating an ingredient', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      seedProperty(db);
      const created = createIngredient(
        db,
        CANYON,
        {
          code: 'beef-short-rib',
          name: '  Beef short rib, bone in  ',
          store: 'butcher',
          purchaseUnit: 'lb',
          packSize: 40,
        },
        FIXED_NOW,
      );
      expect(created.code).toBe('BEEF-SHORT-RIB');
      expect(created.name).toBe('Beef short rib, bone in');
      expect(created.store).toBe('BUTCHER');
      expect(created.purchaseUnit).toBe('LB');
      expect(formatQuantity(created.packSize)).toBe('40 LB');
      expect(created.active).toBe(true);
      expect(created.createdAt).toBe(FIXED_NOW);
    });
  });

  it('lets the pack unit differ from the purchase unit within a dimension', () => {
    withStore((db) => {
      seedProperty(db);
      const created = createIngredient(
        db,
        CANYON,
        {
          code: 'CREAM',
          name: 'Double cream',
          store: 'CHILL',
          purchaseUnit: 'QT',
          packSize: 1,
          packUnit: 'GAL',
        },
        FIXED_NOW,
      );
      expect(formatQuantity(created.packSize)).toBe('1 GAL');
      expect(created.purchaseUnit).toBe('QT');
    });
  });

  it('refuses a pack unit that measures something else', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        createIngredient(
          db,
          CANYON,
          { code: 'X', name: 'X', store: 'DRY', purchaseUnit: 'LB', packSize: 1, packUnit: 'GAL' },
          FIXED_NOW,
        ),
      ).toThrow(/measure different things/);
    });
  });

  it('refuses a blank name, an unknown store and an unknown unit', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { code: 'X', name: 'X', store: 'DRY', purchaseUnit: 'LB', packSize: 1 };
      expect(() => createIngredient(db, CANYON, { ...base, name: ' ' }, FIXED_NOW)).toThrow(
        /needs a name/,
      );
      expect(() => createIngredient(db, CANYON, { ...base, store: 'WINE' }, FIXED_NOW)).toThrow(
        /not a store this kitchen keeps/,
      );
      expect(() =>
        createIngredient(db, CANYON, { ...base, purchaseUnit: 'SCOOP' }, FIXED_NOW),
      ).toThrow(/is not a unit/);
    });
  });

  it('refuses a pack that holds nothing', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { code: 'X', name: 'X', store: 'DRY', purchaseUnit: 'LB' };
      expect(() => createIngredient(db, CANYON, { ...base, packSize: 0 }, FIXED_NOW)).toThrow(
        /has to hold something/,
      );
      expect(() => createIngredient(db, CANYON, { ...base, packSize: -1 }, FIXED_NOW)).toThrow(
        /has to hold something/,
      );
    });
  });

  it('refuses a duplicate code', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { code: 'X', name: 'X', store: 'DRY', purchaseUnit: 'LB', packSize: 1 };
      createIngredient(db, CANYON, base, FIXED_NOW);
      expect(() => createIngredient(db, CANYON, base, FIXED_NOW)).toThrow(
        /already has an ingredient X/,
      );
    });
  });
});

describe('reading ingredients', () => {
  it('lists in code order and filters by store', () => {
    withStore((db) => {
      seedProperty(db);
      createIngredient(
        db,
        CANYON,
        { code: 'ZEST', name: 'Lemon', store: 'PRODUCE', purchaseUnit: 'EA', packSize: 12 },
        FIXED_NOW,
      );
      createIngredient(
        db,
        CANYON,
        { code: 'FLOUR', name: 'Flour', store: 'DRY', purchaseUnit: 'LB', packSize: 50 },
        FIXED_NOW,
      );
      expect(listIngredients(db, CANYON).map((row) => row.code)).toEqual(['FLOUR', 'ZEST']);
      expect(listIngredients(db, CANYON, { store: 'DRY' }).map((row) => row.code)).toEqual([
        'FLOUR',
      ]);
      expect(() => listIngredients(db, CANYON, { store: 'WINE' })).toThrow(/not a store/);
    });
  });

  it('takes one out of the range without deleting it', () => {
    withStore((db) => {
      seedProperty(db);
      createIngredient(
        db,
        CANYON,
        { code: 'FLOUR', name: 'Flour', store: 'DRY', purchaseUnit: 'LB', packSize: 50 },
        FIXED_NOW,
      );
      expect(setIngredientActive(db, CANYON, code('FLOUR'), false).active).toBe(false);
      expect(listIngredients(db, CANYON, { activeOnly: true })).toHaveLength(0);
      expect(listIngredients(db, CANYON)).toHaveLength(1);
    });
  });

  it('answers for one that is not there', () => {
    withStore((db) => {
      seedProperty(db);
      expect(findIngredient(db, CANYON, code('NOTHING'))).toBeUndefined();
      expect(() => requireIngredient(db, CANYON, code('NOTHING'))).toThrow(/has no ingredient/);
    });
  });
});
