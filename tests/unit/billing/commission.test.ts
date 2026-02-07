import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedTaxProfiles } from '../../support/billing.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { rate, ratePercent } from '../../../src/core/rate.js';
import { addCharge, drawPackageCharges } from '../../../src/billing/charges.js';
import { invoiceTotals, raiseInvoice } from '../../../src/billing/invoice.js';
import {
  clearCommission,
  commissionOn,
  compareBases,
  findCommission,
  isCommissionBase,
  paysOnTax,
  setCommission,
} from '../../../src/billing/commission.js';
import type { Database } from '../../../src/store/database.js';

const FENWICK = code('FENWICK');

function invoiced(db: Database) {
  const slot = readyFunction(db, { guarantee: 180 });
  seedTaxProfiles(db);
  drawPackageCharges(db, slot.id);
  addCharge(db, slot.id, {
    category: 'AV',
    description: 'screens and sound',
    quantity: 1,
    unitMinor: 240_000,
  });
  const invoice = raiseInvoice(
    db,
    CANYON,
    { bookingId: slot.bookingId, taxProfileCode: 'DENVER' },
    KITCHEN_NOW,
  );
  return { slot, invoice };
}

describe('the agreement', () => {
  it('reads back what was signed', () => {
    withStore((db) => {
      invoiced(db);
      const agreement = setCommission(db, CANYON, FENWICK, {
        planner: '  Renbrook Events  ',
        ratePpm: 100_000,
        base: 'food-beverage',
        note: 'clause 9',
      });
      expect(agreement.planner).toBe('Renbrook Events');
      expect(ratePercent(agreement.commission)).toBe(10);
      expect(agreement.base).toBe('FOOD-BEVERAGE');
      expect(findCommission(db, CANYON, FENWICK)?.note).toBe('clause 9');
    });
  });

  it('knows which bases pay on money the house never keeps', () => {
    expect(paysOnTax('GROSS')).toBe(true);
    expect(paysOnTax('NET')).toBe(false);
    expect(paysOnTax('FOOD-BEVERAGE')).toBe(false);
    expect(isCommissionBase('GROSS')).toBe(true);
    expect(isCommissionBase('TOTAL')).toBe(false);
  });

  it('refuses a base it does not know, a nameless planner and an absurd rate', () => {
    withStore((db) => {
      invoiced(db);
      expect(() =>
        setCommission(db, CANYON, FENWICK, {
          planner: 'Renbrook',
          ratePpm: 100_000,
          base: 'total',
        }),
      ).toThrow(/not a commission base/);
      expect(() =>
        setCommission(db, CANYON, FENWICK, { planner: '  ', ratePpm: 100_000, base: 'NET' }),
      ).toThrow(/owed to somebody by name/);
      expect(() =>
        setCommission(db, CANYON, FENWICK, { planner: 'Renbrook', ratePpm: 0, base: 'NET' }),
      ).toThrow(/half is already extraordinary/);
      expect(() =>
        setCommission(db, CANYON, FENWICK, { planner: 'Renbrook', ratePpm: 600_000, base: 'NET' }),
      ).toThrow(/half is already extraordinary/);
    });
  });

  it('clears away again', () => {
    withStore((db) => {
      invoiced(db);
      setCommission(db, CANYON, FENWICK, { planner: 'Renbrook', ratePpm: 100_000, base: 'NET' });
      expect(clearCommission(db, CANYON, FENWICK)).toBe(true);
      expect(clearCommission(db, CANYON, FENWICK)).toBe(false);
      expect(findCommission(db, CANYON, FENWICK)).toBeUndefined();
    });
  });
});

describe('what the planner earns', () => {
  it('leaves the screens out on a food and beverage base', () => {
    withStore((db) => {
      const { invoice } = invoiced(db);
      setCommission(db, CANYON, FENWICK, {
        planner: 'Renbrook Events',
        ratePpm: 100_000,
        base: 'FOOD-BEVERAGE',
      });
      const due = commissionOn(db, invoice.id);
      const totals = invoiceTotals(db, invoice.id);
      const av = totals.lines.find((line) => line.category === 'AV');
      expect(av?.net.amount).toBe(240_000);
      expect(due.base.amount).toBe(totals.net.amount - 240_000);
      expect(due.due.amount).toBe(Math.round(due.base.amount / 10));
      expect(due.includesTax).toBe(false);
    });
  });

  it('sweeps the screens in on a net base', () => {
    withStore((db) => {
      const { invoice } = invoiced(db);
      setCommission(db, CANYON, FENWICK, {
        planner: 'Renbrook Events',
        ratePpm: 100_000,
        base: 'NET',
      });
      const due = commissionOn(db, invoice.id);
      expect(due.base.amount).toBe(invoiceTotals(db, invoice.id).net.amount);
    });
  });

  it('pays on the tax on a gross base, and says so', () => {
    withStore((db) => {
      const { invoice } = invoiced(db);
      setCommission(db, CANYON, FENWICK, {
        planner: 'Renbrook Events',
        ratePpm: 100_000,
        base: 'GROSS',
      });
      const due = commissionOn(db, invoice.id);
      const totals = invoiceTotals(db, invoice.id);
      expect(due.base.amount).toBe(totals.gross.amount);
      expect(due.base.amount).toBeGreaterThan(totals.net.amount);
      expect(due.includesTax).toBe(true);
    });
  });

  it('says so when there is no agreement, and when there is no account', () => {
    withStore((db) => {
      const { invoice } = invoiced(db);
      expect(() => commissionOn(db, invoice.id)).toThrow(/no commission agreement/);
    });
  });
});

describe('comparing the three bases', () => {
  it('puts them in order and prices each one', () => {
    withStore((db) => {
      const { invoice } = invoiced(db);
      const compared = compareBases(db, invoice.id, rate(100_000));
      expect(compared.map((entry) => entry.base)).toEqual(['FOOD-BEVERAGE', 'NET', 'GROSS']);
      expect(compared[0]?.amount.amount).toBeLessThan(compared[1]?.amount.amount ?? 0);
      expect(compared[1]?.amount.amount).toBeLessThan(compared[2]?.amount.amount ?? 0);
      for (const entry of compared) {
        expect(entry.due.amount).toBe(Math.round(entry.amount.amount / 10));
      }
    });
  });

  it('agrees with what the signed agreement produces', () => {
    withStore((db) => {
      const { invoice } = invoiced(db);
      setCommission(db, CANYON, FENWICK, {
        planner: 'Renbrook Events',
        ratePpm: 100_000,
        base: 'NET',
      });
      const due = commissionOn(db, invoice.id);
      const compared = compareBases(db, invoice.id, rate(100_000)).find(
        (entry) => entry.base === 'NET',
      );
      expect(compared?.due.amount).toBe(due.due.amount);
    });
  });
});
