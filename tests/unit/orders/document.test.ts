import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedLabour } from '../../support/labour.js';
import { assembleOrder, orderWarnings, renderOrder } from '../../../src/orders/document.js';
import { addSpecialMeal } from '../../../src/covers/special.js';
import { setCourseSplit } from '../../../src/covers/selections.js';
import { buildRoster } from '../../../src/labour/shifts.js';
import { addCharge, drawPackageCharges } from '../../../src/billing/charges.js';
import type { Database } from '../../../src/store/database.js';

function fullyDressed(db: Database) {
  const slot = readyFunction(db, { guarantee: 180, specialCovers: 12 });
  seedLabour(db);
  buildRoster(db, slot.id, KITCHEN_NOW);
  drawPackageCharges(db, slot.id);
  addCharge(db, slot.id, {
    category: 'AV',
    description: 'Projection screen',
    quantity: 1,
    unitMinor: 22_500,
  });
  return slot;
}

describe('assembling the order', () => {
  it('carries the header off the booking and the room', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      const order = assembleOrder(db, slot.id);
      expect(order.header.functionId).toBe(slot.id);
      expect(order.header.postAs).toBe('Fenwick Annual Symposium');
      expect(order.header.accountName).toBe('Fenwick Geological Society');
      expect(order.header.room).toBe('Grand Ballroom A (GRAND-A)');
      expect(order.header.start).toBe('6pm');
      expect(order.header.end).toBe('11pm');
      expect(order.header.setupStyle).toBe('ROUNDS-10');
    });
  });

  it('carries the covers exactly as the guarantee engine has them', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      const order = assembleOrder(db, slot.id);
      expect(order.covers.guaranteed).toBe(180);
      expect(order.covers.special).toBe(12);
      expect(order.covers.standard).toBe(168);
      expect(order.covers.setFor).toBe(189);
      expect(order.covers.served).toBeUndefined();
      expect(order.covers.guaranteeDue).toBe('2025-04-15 12:00 America/Denver');
    });
  });

  it('lists the menu with the names a chef reads, not the codes', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      const order = assembleOrder(db, slot.id);
      const main = order.menu.filter((row) => row.course === 'MAIN');
      expect(main.map((row) => row.itemName).sort()).toEqual([
        'Braised short rib',
        'Roast halibut',
      ]);
      expect(main.reduce((total, row) => total + row.covers, 0)).toBe(168);
    });
  });

  it('lists the special meals with what they will actually be given', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      const order = assembleOrder(db, slot.id);
      expect(order.specials).toHaveLength(1);
      expect(order.specials[0]?.covers).toBe(12);
      expect(order.specials[0]?.diet).toBe('VEGAN');
      expect(order.specials[0]?.dish).toBe('Winter root plate');
    });
  });

  it('lists the crew and totals the labour', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      const order = assembleOrder(db, slot.id);
      expect(order.roster.map((row) => row.role).sort()).toEqual(['CAPTAIN', 'HOUSEMAN', 'SERVER']);
      expect(order.roster.find((row) => row.role === 'SERVER')?.from).toBe('5pm');
      expect(order.rosterCost).toMatch(/^\$[\d,]+\.\d\d$/);
    });
  });

  it('lists the charges and totals them', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      const order = assembleOrder(db, slot.id);
      expect(order.charges).toHaveLength(2);
      expect(order.chargesTotal).toBe('$16,335.00');
    });
  });
});

describe('the warnings on the sheet', () => {
  it('is silent on a function that is ready', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      expect(orderWarnings(db, slot.id)).toEqual([]);
    });
  });

  it('names a split that does not add up', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 100 }]);
      expect(orderWarnings(db, slot.id)).toContain(
        'the MAIN split adds to 100 against 168 standard covers',
      );
    });
  });

  it('names a guest nobody has decided a dish for', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      addSpecialMeal(db, slot.id, { guestName: 'M Lindqvist', diet: 'KOSHER' }, KITCHEN_NOW);
      expect(orderWarnings(db, slot.id)).toContain('M Lindqvist has no dish decided');
    });
  });

  it('says when nobody is rostered and nothing is charged', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const warnings = orderWarnings(db, slot.id);
      expect(warnings).toContain('nobody is rostered');
      expect(warnings).toContain('nothing has been charged');
    });
  });
});

describe('rendering the sheet', () => {
  it('prints every section a pass sheet carries', () => {
    withStore((db) => {
      const slot = fullyDressed(db);
      const text = renderOrder(assembleOrder(db, slot.id));
      expect(text).toContain('BANQUET EVENT ORDER  FN-2025-0001');
      expect(text).toContain('Fenwick Annual Symposium');
      expect(text).toContain('Fri 18 Apr 2025');
      expect(text).toContain('COVERS');
      expect(text).toContain('168 standard plates, room set for 189');
      expect(text).toContain('MENU');
      expect(text).toContain('SPECIAL MEALS');
      expect(text).toContain('CREW');
      expect(text).toContain('CHARGES');
      expect(text).not.toContain('CHECK BEFORE THIS GOES OUT');
    });
  });

  it('prints the warnings when there are any', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const text = renderOrder(assembleOrder(db, slot.id));
      expect(text).toContain('CHECK BEFORE THIS GOES OUT');
      expect(text).toContain('nobody is rostered');
      expect(text).not.toContain('CREW');
    });
  });
});
