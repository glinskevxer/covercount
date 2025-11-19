import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW } from '../../support/fixtures.js';
import { readyFunction } from '../../support/production.js';
import { seedTaxProfiles } from '../../support/billing.js';
import { createBarTier, recordPour, setBar } from '../../../src/bar/store.js';
import { drawBarCharges, drawPackageCharges, listCharges } from '../../../src/billing/charges.js';
import { invoiceTotals, raiseInvoice } from '../../../src/billing/invoice.js';
import { formatMoney } from '../../../src/core/money.js';
import type { Database } from '../../../src/store/database.js';

const NOW = '2025-04-10T09:00:00.000Z';

function withBar(db: Database) {
  const slot = readyFunction(db, { guarantee: 180 });
  seedTaxProfiles(db);
  createBarTier(
    db,
    CANYON,
    { code: 'HOUSE', name: 'House bar', firstHourMinor: 1800, extraHourMinor: 1200 },
    FIXED_NOW,
  );
  return slot;
}

describe('drawing the bar onto the bill', () => {
  it('bills a package bar as one beverage line', () => {
    withStore((db) => {
      const slot = withBar(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      const drawn = drawBarCharges(db, slot.id);
      expect(drawn).toHaveLength(1);
      expect(drawn[0]?.category).toBe('BEVERAGE');
      expect(formatMoney(drawn[0]!.unit)).toBe('$9,720.00');
      expect(drawn[0]?.description).toContain('Package bar');
      expect(drawn[0]?.serviceable).toBe(true);
    });
  });

  it('bills a consumption bar what came out of the bottles', () => {
    withStore((db) => {
      const slot = withBar(db);
      setBar(db, slot.id, { kind: 'CONSUMPTION' });
      recordPour(db, slot.id, {
        itemCode: 'HOUSE-RED',
        openingTenths: 120,
        closingTenths: 43,
        unitMinor: 4200,
      });
      const drawn = drawBarCharges(db, slot.id);
      expect(formatMoney(drawn[0]!.unit)).toBe('$323.40');
      expect(drawn[0]?.description).toContain('Consumption bar');
    });
  });

  it('draws no line at all for a cash bar', () => {
    withStore((db) => {
      const slot = withBar(db);
      setBar(db, slot.id, { kind: 'CASH' });
      expect(drawBarCharges(db, slot.id)).toEqual([]);
      expect(listCharges(db, slot.id)).toEqual([]);
    });
  });

  it('replaces the bar line rather than stacking one', () => {
    withStore((db) => {
      const slot = withBar(db);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      drawBarCharges(db, slot.id);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 2 });
      drawBarCharges(db, slot.id);
      const bar = listCharges(db, slot.id).filter((row) => row.source === 'BAR');
      expect(bar).toHaveLength(1);
      expect(formatMoney(bar[0]!.unit)).toBe('$5,400.00');
    });
  });

  it('reaches the invoice and attracts the service charge', () => {
    withStore((db) => {
      const slot = withBar(db);
      drawPackageCharges(db, slot.id);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      drawBarCharges(db, slot.id);

      const invoice = raiseInvoice(
        db,
        CANYON,
        { bookingId: slot.bookingId, taxProfileCode: 'DENVER' },
        NOW,
      );
      const totals = invoiceTotals(db, invoice.id);
      const beverage = totals.lines.find((row) => row.category === 'BEVERAGE');
      expect(formatMoney(beverage!.net)).toBe('$9,720.00');
      expect(beverage!.serviceCharge.amount).toBeGreaterThan(0);
      expect(beverage!.tax.amount).toBeGreaterThan(0);
    });
  });

  it('leaves the package line alone when the bar is redrawn', () => {
    withStore((db) => {
      const slot = withBar(db);
      drawPackageCharges(db, slot.id);
      setBar(db, slot.id, { kind: 'PACKAGE', tierCode: 'HOUSE', hours: 4 });
      drawBarCharges(db, slot.id);
      drawBarCharges(db, slot.id);
      expect(listCharges(db, slot.id).filter((row) => row.source === 'PACKAGE')).toHaveLength(1);
    });
  });
});
