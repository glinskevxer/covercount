import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW } from '../../support/fixtures.js';
import { readyFunction } from '../../support/production.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { quantity } from '../../../src/core/quantity.js';
import { countStock } from '../../../src/production/stock.js';
import { draftPurchaseOrder, renderPurchaseOrder } from '../../../src/production/purchasing.js';
import { ingredientDemand } from '../../../src/production/explode.js';

describe('drafting a purchase order', () => {
  it('groups by store and orders whole packs', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const order = draftPurchaseOrder(db, [slot.id]);
      expect(order.propertyCode).toBe(CANYON);
      expect(order.sections.length).toBeGreaterThan(1);
      expect(order.sections.map((section) => section.store)).toEqual(
        [...order.sections.map((section) => section.store)].sort(),
      );
      expect(order.packs).toBeGreaterThan(0);
      for (const section of order.sections) {
        expect(section.packs).toBe(section.lines.reduce((total, line) => total + line.packs, 0));
      }
    });
  });

  it('orders nothing it already has on the shelf', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const bare = draftPurchaseOrder(db, [slot.id]);
      const ribs = ingredientDemand(db, slot.id).find(
        (demand) => demand.ingredientCode === 'SHORT-RIB',
      );
      expect(ribs).toBeDefined();

      countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(2_000, 'LB') }, FIXED_NOW);
      const netted = draftPurchaseOrder(db, [slot.id]);
      expect(netted.linesDropped).toBe(bare.linesDropped + 1);
      expect(netted.packs).toBeLessThan(bare.packs);
      expect(
        netted.sections.flatMap((section) => section.lines).map((line) => line.ingredientCode),
      ).not.toContain('SHORT-RIB');
    });
  });

  it('still orders when the shelf only half covers it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const bare = draftPurchaseOrder(db, [slot.id]);
      const before = bare.sections
        .flatMap((section) => section.lines)
        .find((line) => line.ingredientCode === 'SHORT-RIB');
      expect(before).toBeDefined();

      countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(45, 'LB') }, FIXED_NOW);
      const after = draftPurchaseOrder(db, [slot.id])
        .sections.flatMap((section) => section.lines)
        .find((line) => line.ingredientCode === 'SHORT-RIB');
      expect(after?.packs).toBe((before?.packs ?? 0) - 1);
      expect(after?.onHand.milli).toBe(45_000);
    });
  });

  it('adds the par on top of the need', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const before = draftPurchaseOrder(db, [slot.id])
        .sections.flatMap((section) => section.lines)
        .find((line) => line.ingredientCode === 'SHORT-RIB');

      countStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        { onHand: quantity(0, 'LB'), par: quantity(200, 'LB') },
        FIXED_NOW,
      );
      const after = draftPurchaseOrder(db, [slot.id])
        .sections.flatMap((section) => section.lines)
        .find((line) => line.ingredientCode === 'SHORT-RIB');
      expect(after?.packs).toBe((before?.packs ?? 0) + 5);
    });
  });

  it('refuses an empty set of functions', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      expect(() => draftPurchaseOrder(db, [])).toThrow(/at least one function/);
    });
  });
});

describe('printing the order', () => {
  it('names the property, the packs and the netting', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(2_000, 'LB') }, FIXED_NOW);
      const text = renderPurchaseOrder(draftPurchaseOrder(db, [slot.id]));
      expect(text).toContain('purchase order for CANYON');
      expect(text).toContain('1 function(s)');
      expect(text).toContain('covered by stock on hand');
      expect(text).toContain('need');
      expect(text).not.toContain('SHORT-RIB');
    });
  });

  it('says so when the shelf covers the lot', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      for (const item of ingredientDemand(db, slot.id)) {
        countStock(
          db,
          CANYON,
          item.ingredientCode,
          { onHand: quantity(100_000, item.needed.unit) },
          FIXED_NOW,
        );
      }
      const order = draftPurchaseOrder(db, [slot.id]);
      expect(order.packs).toBe(0);
      expect(order.sections).toEqual([]);
      expect(renderPurchaseOrder(order)).toContain('nothing to order');
    });
  });
});
