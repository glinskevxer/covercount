import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { seedFunction, seedPropertyAccountBooking } from '../../support/fixtures.js';
import { seedFullCatalog } from '../../support/menu.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import {
  addCharge,
  addUpcharge,
  drawPackageCharges,
  findCharge,
  lineTotal,
  listCharges,
  removeCharge,
  removeChargesFrom,
  requireCharge,
} from '../../../src/billing/charges.js';
import { openCovers, recordServed, setGuarantee } from '../../../src/covers/guarantee.js';
import { cancelBooking } from '../../../src/booking/lifecycle.js';
import { money } from '../../../src/core/money.js';

describe('adding a charge line', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const line = addCharge(db, slot.id, {
        category: 'av',
        description: '  Projection screen  ',
        quantity: 2,
        unitMinor: 22_500,
      });
      expect(line.category).toBe('AV');
      expect(line.description).toBe('Projection screen');
      expect(line.quantity).toBe(2);
      expect(line.unit).toEqual(money(22_500, 'USD'));
      expect(line.source).toBe('MANUAL');
      expect(line.position).toBe(1);
      expect(lineTotal(line)).toEqual(money(45_000, 'USD'));
    });
  });

  it('defaults the service charge flag off the category', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const food = addCharge(db, slot.id, {
        category: 'FOOD',
        description: 'Late canapes',
        quantity: 1,
        unitMinor: 100,
      });
      const rental = addCharge(db, slot.id, {
        category: 'RENTAL',
        description: 'Dance floor',
        quantity: 1,
        unitMinor: 100,
      });
      expect(food.serviceable).toBe(true);
      expect(rental.serviceable).toBe(false);
    });
  });

  it('takes an explicit flag over the default', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const line = addCharge(db, slot.id, {
        category: 'RENTAL',
        description: 'Dance floor',
        quantity: 1,
        unitMinor: 100,
        serviceable: true,
        taxable: false,
      });
      expect(line.serviceable).toBe(true);
      expect(line.taxable).toBe(false);
    });
  });

  it('numbers lines in the order they arrive', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const base = { category: 'FEE', description: 'x', quantity: 1, unitMinor: 1 };
      addCharge(db, slot.id, base);
      addCharge(db, slot.id, base);
      expect(listCharges(db, slot.id).map((row) => row.position)).toEqual([1, 2]);
    });
  });

  it('refuses an unknown category, source or a blank description', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const base = { category: 'FOOD', description: 'x', quantity: 1, unitMinor: 1 };
      expect(() => addCharge(db, slot.id, { ...base, category: 'MERCH' })).toThrow(
        /not a charge category/,
      );
      expect(() => addCharge(db, slot.id, { ...base, source: 'GUESS' })).toThrow(
        /not a charge source/,
      );
      expect(() => addCharge(db, slot.id, { ...base, description: '  ' })).toThrow(
        /a charge description cannot be blank/,
      );
      expect(() => addCharge(db, slot.id, { ...base, quantity: 1.5 })).toThrow(/whole number/);
      expect(() => addCharge(db, slot.id, { ...base, unitMinor: 1.5 })).toThrow(/minor units/);
    });
  });

  it('refuses a charge on a cancelled booking', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      cancelBooking(db, slot.bookingId, 'client walked', KITCHEN_NOW);
      expect(() =>
        addCharge(db, slot.id, {
          category: 'FOOD',
          description: 'x',
          quantity: 1,
          unitMinor: 1,
        }),
      ).toThrow(/takes no more charges/);
    });
  });

  it('takes a line back off, by id and by source', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const line = addCharge(db, slot.id, {
        category: 'FEE',
        description: 'x',
        quantity: 1,
        unitMinor: 1,
      });
      expect(findCharge(db, line.id, 'USD')).toBeDefined();
      expect(removeCharge(db, line.id)).toBe(true);
      expect(removeCharge(db, line.id)).toBe(false);
      expect(() => requireCharge(db, line.id, 'USD')).toThrow(/is not on file/);

      addCharge(db, slot.id, { category: 'FEE', description: 'y', quantity: 1, unitMinor: 1 });
      expect(removeChargesFrom(db, slot.id, 'MANUAL')).toBe(1);
    });
  });
});

describe('drawing the package charge', () => {
  it('bills the billed covers at the package price on the contract date', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const drawn = drawPackageCharges(db, slot.id);
      expect(drawn).toHaveLength(1);
      expect(drawn[0]?.quantity).toBe(180);
      expect(drawn[0]?.unit).toEqual(money(8950, 'USD'));
      expect(drawn[0]?.description).toBe('PLATED-THREE at 180 covers');
      expect(lineTotal(drawn[0]!)).toEqual(money(1_611_000, 'USD'));
    });
  });

  it('follows the billed count when more turn up than were guaranteed', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      recordServed(db, slot.id, 192, KITCHEN_NOW);
      expect(drawPackageCharges(db, slot.id)[0]?.quantity).toBe(192);
    });
  });

  it('still bills the guarantee when fewer turn up', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      recordServed(db, slot.id, 165, KITCHEN_NOW);
      expect(drawPackageCharges(db, slot.id)[0]?.quantity).toBe(180);
    });
  });

  it('replaces the package line rather than stacking one', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      drawPackageCharges(db, slot.id);
      setGuarantee(db, slot.id, 190, KITCHEN_NOW);
      drawPackageCharges(db, slot.id);
      const packageLines = listCharges(db, slot.id).filter((row) => row.source === 'PACKAGE');
      expect(packageLines).toHaveLength(1);
      expect(packageLines[0]?.quantity).toBe(190);
    });
  });

  it('leaves a manual line alone when it redraws', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      addCharge(db, slot.id, {
        category: 'AV',
        description: 'Screen',
        quantity: 1,
        unitMinor: 22_500,
      });
      drawPackageCharges(db, slot.id);
      drawPackageCharges(db, slot.id);
      expect(listCharges(db, slot.id).filter((row) => row.source === 'MANUAL')).toHaveLength(1);
    });
  });

  it('refuses a function with no package on it', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFullCatalog(db);
      const bare = seedFunction(db, booking.id);
      openCovers(db, bare.id, { contractDate: '2025-01-20' });
      setGuarantee(db, bare.id, 40, KITCHEN_NOW);
      expect(() => drawPackageCharges(db, bare.id)).toThrow(/has no package on it/);
    });
  });

  it('refuses a function that names no price book', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFullCatalog(db);
      const bare = seedFunction(db, booking.id);
      openCovers(db, bare.id, { packageCode: 'PLATED-THREE', contractDate: '2025-01-20' });
      setGuarantee(db, bare.id, 40, KITCHEN_NOW);
      expect(() => drawPackageCharges(db, bare.id)).toThrow(/names no price book/);
    });
  });
});

describe('upcharges', () => {
  it('bills the covers that took it at the item price', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const line = addUpcharge(db, slot.id, 'LOBSTER-UP', 24);
      expect(line.category).toBe('FOOD');
      expect(line.quantity).toBe(24);
      expect(line.unit).toEqual(money(2400, 'USD'));
      expect(line.source).toBe('UPCHARGE');
      expect(line.itemCode).toBe('LOBSTER-UP');
    });
  });

  it('refuses an item that is not sold as an upcharge', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(() => addUpcharge(db, slot.id, 'SHORT-RIB', 10)).toThrow(/is not sold as an upcharge/);
    });
  });

  it('refuses an item that is not in the catalog', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(() => addUpcharge(db, slot.id, 'UNICORN', 10)).toThrow(/has no menu item UNICORN/);
    });
  });
});
