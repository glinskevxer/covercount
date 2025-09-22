import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import {
  CANYON,
  FIXED_NOW,
  seedFunction,
  seedProperty,
  seedPropertyAccountBooking,
} from '../../support/fixtures.js';
import { seedEquipment } from '../../support/equipment.js';
import {
  EQUIPMENT_KINDS,
  createEquipment,
  findEquipment,
  isEquipmentKind,
  listEquipment,
  listRequirements,
  pullFor,
  requireEquipment,
  savePull,
  setRequirement,
  tablesFor,
} from '../../../src/equipment/store.js';
import { catalogCode } from '../../../src/core/ids.js';

const code = catalogCode;

describe('the equipment cupboard', () => {
  it('recognises its kinds', () => {
    for (const kind of EQUIPMENT_KINDS) {
      expect(isEquipmentKind(kind)).toBe(true);
    }
    expect(isEquipmentKind('BUNTING')).toBe(false);
  });

  it('reads a piece back', () => {
    withStore((db) => {
      seedProperty(db);
      const item = createEquipment(
        db,
        CANYON,
        { code: 'round-72', name: '  72 inch round  ', kind: 'table', owned: 40 },
        FIXED_NOW,
      );
      expect(item.code).toBe('ROUND-72');
      expect(item.name).toBe('72 inch round');
      expect(item.kind).toBe('TABLE');
      expect(item.owned).toBe(40);
      expect(item.rental.amount).toBe(0);
    });
  });

  it('refuses a blank name, an unknown kind and a bad count', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { code: 'X', name: 'X', kind: 'TABLE' };
      expect(() => createEquipment(db, CANYON, { ...base, name: ' ' }, FIXED_NOW)).toThrow(
        /needs a name/,
      );
      expect(() => createEquipment(db, CANYON, { ...base, kind: 'BUNTING' }, FIXED_NOW)).toThrow(
        /not a kind of equipment/,
      );
      expect(() => createEquipment(db, CANYON, { ...base, owned: -1 }, FIXED_NOW)).toThrow(
        /whole number/,
      );
      expect(() => createEquipment(db, CANYON, { ...base, rentalMinor: -1 }, FIXED_NOW)).toThrow(
        /whole number of minor units/,
      );
    });
  });

  it('refuses a duplicate and answers for one that is not there', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      expect(() =>
        createEquipment(db, CANYON, { code: 'LECTERN', name: 'X', kind: 'STAGING' }, FIXED_NOW),
      ).toThrow(/already has LECTERN on file/);
      expect(findEquipment(db, CANYON, code('NOTHING'))).toBeUndefined();
      expect(() => requireEquipment(db, CANYON, code('NOTHING'))).toThrow(/has no NOTHING/);
      expect(listEquipment(db, CANYON)).toHaveLength(8);
    });
  });
});

describe('setup requirements', () => {
  it('reads a rule back and replaces one set twice', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      const rule = setRequirement(db, CANYON, {
        setupStyle: 'rounds-10',
        equipmentCode: 'wine-glass',
        perCover: 3,
      });
      expect(rule.setupStyle).toBe('ROUNDS-10');
      expect(rule.perCover).toBe(3);
      expect(listRequirements(db, CANYON, 'ROUNDS-10')).toHaveLength(7);
    });
  });

  it('refuses a rule that would never pull anything', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      expect(() =>
        setRequirement(db, CANYON, { setupStyle: 'ROUNDS-10', equipmentCode: 'LECTERN' }),
      ).toThrow(/would never be pulled/);
    });
  });

  it('refuses a per table count on a setup with no tables', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      expect(() =>
        setRequirement(db, CANYON, {
          setupStyle: 'RECEPTION',
          equipmentCode: 'FLOOR-CLOTH',
          perTable: 1,
        }),
      ).toThrow(/has no tables/);
    });
  });

  it('refuses an unknown style, an unknown piece and a bad count', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      expect(() =>
        setRequirement(db, CANYON, {
          setupStyle: 'CABARET',
          equipmentCode: 'LECTERN',
          fixed: 1,
        }),
      ).toThrow(/not a setup style/);
      expect(() =>
        setRequirement(db, CANYON, {
          setupStyle: 'ROUNDS-10',
          equipmentCode: 'UNICORN',
          fixed: 1,
        }),
      ).toThrow(/has no UNICORN/);
      expect(() =>
        setRequirement(db, CANYON, {
          setupStyle: 'ROUNDS-10',
          equipmentCode: 'LECTERN',
          fixed: -1,
        }),
      ).toThrow(/whole number/);
    });
  });
});

describe('working out the pull', () => {
  it('counts tables off the seats per table', () => {
    expect(tablesFor('ROUNDS-10', 180)).toBe(18);
    expect(tablesFor('ROUNDS-10', 181)).toBe(19);
    expect(tablesFor('ROUNDS-8', 180)).toBe(23);
    expect(tablesFor('ROUNDS-12', 180)).toBe(15);
    expect(tablesFor('RECEPTION', 180)).toBe(0);
    expect(tablesFor('ROUNDS-10', 0)).toBe(0);
  });

  it('pulls per cover, per table and flat all in one pass', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      const pull = pullFor(db, CANYON, 'ROUNDS-10', 180);
      const at = (item: string) => pull.find((row) => row.equipmentCode === item)?.quantity;
      expect(at('ROUND-72')).toBe(18);
      expect(at('BANQUET-CHAIR')).toBe(180);
      expect(at('FLOOR-CLOTH')).toBe(18);
      expect(at('WINE-GLASS')).toBe(360);
      expect(at('LECTERN')).toBe(1);
    });
  });

  it('names what the property is short of', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      const pull = pullFor(db, CANYON, 'ROUNDS-10', 380);
      const settings = pull.find((row) => row.equipmentCode === 'PLACE-SETTING');
      expect(settings?.quantity).toBe(380);
      expect(settings?.owned).toBe(320);
      expect(settings?.shortfall).toBe(60);
      expect(settings?.rental.amount).toBe(275);

      const chairs = pull.find((row) => row.equipmentCode === 'BANQUET-CHAIR');
      expect(chairs?.shortfall).toBe(0);
    });
  });

  it('follows the cover count', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      const small = pullFor(db, CANYON, 'ROUNDS-10', 40);
      expect(small.find((row) => row.equipmentCode === 'ROUND-72')?.quantity).toBe(4);
      expect(small.find((row) => row.equipmentCode === 'LECTERN')?.quantity).toBe(1);
    });
  });

  it('pulls a flat count on a setup with no tables', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      const pull = pullFor(db, CANYON, 'RECEPTION', 200);
      expect(pull.find((row) => row.equipmentCode === 'CHAFER')?.quantity).toBe(4);
      expect(pull.find((row) => row.equipmentCode === 'WINE-GLASS')?.quantity).toBe(400);
    });
  });

  it('is empty for a style with no rules on it', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      expect(pullFor(db, CANYON, 'THEATER', 200)).toEqual([]);
    });
  });

  it('refuses a cover count that is not a whole number', () => {
    withStore((db) => {
      seedProperty(db);
      seedEquipment(db);
      expect(() => pullFor(db, CANYON, 'ROUNDS-10', 1.5)).toThrow(/whole number/);
      expect(() => pullFor(db, CANYON, 'ROUNDS-10', -1)).toThrow(/whole number/);
    });
  });

  it('saves the pull against a function and replaces it on a redraw', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedEquipment(db);
      const slot = seedFunction(db, booking.id);
      const first = pullFor(db, CANYON, 'ROUNDS-10', 180);
      expect(savePull(db, slot.id, first)).toBe(first.length);
      const second = pullFor(db, CANYON, 'ROUNDS-10', 40);
      expect(savePull(db, slot.id, second)).toBe(second.length);
    });
  });
});
