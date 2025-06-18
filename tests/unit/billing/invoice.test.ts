import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedTaxProfiles } from '../../support/billing.js';
import {
  advanceInvoice,
  findInvoice,
  invoiceFunctions,
  invoiceTotals,
  listInvoices,
  listPayments,
  paidToDate,
  raiseInvoice,
  recordPayment,
  requireInvoice,
} from '../../../src/billing/invoice.js';
import { addCharge, drawPackageCharges } from '../../../src/billing/charges.js';
import { parseEntityId } from '../../../src/core/ids.js';
import { formatMoney } from '../../../src/core/money.js';
import type { Database } from '../../../src/store/database.js';

function billed(db: Database, profile = 'DENVER') {
  const slot = readyFunction(db, { guarantee: 180 });
  seedTaxProfiles(db);
  drawPackageCharges(db, slot.id);
  const invoice = raiseInvoice(
    db,
    CANYON,
    { bookingId: slot.bookingId, taxProfileCode: profile },
    KITCHEN_NOW,
  );
  return { slot, invoice };
}

describe('raising an invoice', () => {
  it('numbers it and links every function that holds space', () => {
    withStore((db) => {
      const { slot, invoice } = billed(db);
      expect(invoice.id).toBe('INV-2025-0001');
      expect(invoice.status).toBe('DRAFT');
      expect(invoice.taxProfileCode).toBe('DENVER');
      expect(invoiceFunctions(db, invoice.id)).toEqual([slot.id]);
    });
  });

  it('refuses a booking with nothing to invoice and a function from elsewhere', () => {
    withStore((db) => {
      const { slot } = billed(db);
      expect(() =>
        raiseInvoice(
          db,
          CANYON,
          {
            bookingId: slot.bookingId,
            taxProfileCode: 'DENVER',
            functionIds: ['FN-2025-9999'],
          },
          KITCHEN_NOW,
        ),
      ).toThrow(/is not on file/);
    });
  });

  it('refuses a tax profile that is not on file', () => {
    withStore((db) => {
      const { slot } = billed(db);
      expect(() =>
        raiseInvoice(
          db,
          CANYON,
          { bookingId: slot.bookingId, taxProfileCode: 'NOWHERE' },
          KITCHEN_NOW,
        ),
      ).toThrow(/has no tax profile NOWHERE/);
    });
  });

  it('answers for one that is not on file and lists by booking', () => {
    withStore((db) => {
      const { slot, invoice } = billed(db);
      expect(findInvoice(db, parseEntityId('invoice', 'INV-2025-9999'))).toBeUndefined();
      expect(() => requireInvoice(db, parseEntityId('invoice', 'INV-2025-9999'))).toThrow(
        /is not on file/,
      );
      expect(listInvoices(db, CANYON, { bookingId: slot.bookingId })).toHaveLength(1);
      expect(listInvoices(db, CANYON, { status: 'ISSUED' })).toHaveLength(0);
      expect(() => listInvoices(db, CANYON, { status: 'SENT' })).toThrow(/not an invoice status/);
      expect(invoice.note).toBe('');
    });
  });
});

describe('the totals', () => {
  it('takes the service charge only on the serviceable lines', () => {
    withStore((db) => {
      const { slot, invoice } = billed(db);
      addCharge(db, slot.id, {
        category: 'RENTAL',
        description: 'Dance floor',
        quantity: 1,
        unitMinor: 50_000,
      });
      const totals = invoiceTotals(db, invoice.id);
      expect(formatMoney(totals.net)).toBe('$16,610.00');
      expect(formatMoney(totals.serviceCharge)).toBe('$3,544.20');
    });
  });

  it('taxes the service charge where the profile says it is taxable', () => {
    withStore((db) => {
      const { invoice } = billed(db, 'DENVER');
      const totals = invoiceTotals(db, invoice.id);
      const food = totals.lines.find((row) => row.category === 'FOOD');
      expect(formatMoney(food!.net)).toBe('$16,110.00');
      expect(formatMoney(food!.serviceCharge)).toBe('$3,544.20');
      expect(formatMoney(food!.tax)).toBe('$1,731.53');
    });
  });

  it('leaves the service charge untaxed where the profile says so', () => {
    withStore((db) => {
      const { invoice } = billed(db, 'OFFSITE');
      const totals = invoiceTotals(db, invoice.id);
      const food = totals.lines.find((row) => row.category === 'FOOD');
      expect(formatMoney(food!.serviceCharge)).toBe('$3,222.00');
      expect(formatMoney(food!.tax)).toBe('$644.40');
    });
  });

  it('adds no gratuity where the profile carries none', () => {
    withStore((db) => {
      expect(formatMoney(invoiceTotalsFor(db, 'DENVER').gratuity)).toBe('$0.00');
    });
  });

  it('adds a gratuity where the profile carries one, and never taxes it', () => {
    withStore((db) => {
      const offsite = invoiceTotalsFor(db, 'OFFSITE');
      expect(formatMoney(offsite.gratuity)).toBe('$483.30');
      expect(offsite.tax.amount).toBeLessThan(offsite.gross.amount);
    });
  });

  it('adds up to a gross the client pays', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      const totals = invoiceTotals(db, invoice.id);
      const parts =
        totals.net.amount +
        totals.serviceCharge.amount +
        totals.tax.amount +
        totals.gratuity.amount;
      expect(totals.gross.amount).toBe(parts);
      expect(totals.balance).toEqual(totals.gross);
      expect(totals.paid.amount).toBe(0);
    });
  });

  it('leaves an untaxed line out of the tax', () => {
    withStore((db) => {
      const { slot, invoice } = billed(db);
      addCharge(db, slot.id, {
        category: 'AV',
        description: 'Screen',
        quantity: 1,
        unitMinor: 100_000,
        taxable: false,
      });
      const av = invoiceTotals(db, invoice.id).lines.find((row) => row.category === 'AV');
      expect(av?.net.amount).toBe(100_000);
      expect(av?.tax.amount).toBe(0);
    });
  });
});

function invoiceTotalsFor(db: Database, profile: string) {
  const { invoice } = billed(db, profile);
  return invoiceTotals(db, invoice.id);
}

describe('payments', () => {
  it('records a deposit and takes it off the balance', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      const before = invoiceTotals(db, invoice.id);
      recordPayment(
        db,
        invoice.id,
        { kind: 'deposit', amountMinor: 500_000, reference: 'wire 4471' },
        KITCHEN_NOW,
      );
      const after = invoiceTotals(db, invoice.id);
      expect(after.paid.amount).toBe(500_000);
      expect(after.balance.amount).toBe(before.gross.amount - 500_000);
    });
  });

  it('puts a refund back on the balance', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      recordPayment(db, invoice.id, { kind: 'PAYMENT', amountMinor: 500_000 }, KITCHEN_NOW);
      recordPayment(db, invoice.id, { kind: 'REFUND', amountMinor: 200_000 }, KITCHEN_NOW);
      expect(paidToDate(db, invoice.id).amount).toBe(300_000);
    });
  });

  it('lists payments in the order they landed', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      recordPayment(db, invoice.id, { kind: 'DEPOSIT', amountMinor: 100 }, KITCHEN_NOW);
      recordPayment(db, invoice.id, { kind: 'PAYMENT', amountMinor: 200 }, KITCHEN_NOW);
      expect(listPayments(db, invoice.id).map((row) => row.kind)).toEqual(['DEPOSIT', 'PAYMENT']);
      expect(listPayments(db, invoice.id)[1]?.amount.amount).toBe(200);
    });
  });

  it('refuses a kind it does not know and an amount that is not positive', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      expect(() =>
        recordPayment(db, invoice.id, { kind: 'CHEQUE', amountMinor: 100 }, KITCHEN_NOW),
      ).toThrow(/not a payment kind/);
      expect(() =>
        recordPayment(db, invoice.id, { kind: 'PAYMENT', amountMinor: 0 }, KITCHEN_NOW),
      ).toThrow(/positive whole number/);
      expect(() =>
        recordPayment(db, invoice.id, { kind: 'PAYMENT', amountMinor: -5 }, KITCHEN_NOW),
      ).toThrow(/positive whole number/);
    });
  });
});

describe('moving an invoice along', () => {
  it('goes draft to issued and stamps the time', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      const issued = advanceInvoice(db, invoice.id, 'issued', KITCHEN_NOW);
      expect(issued.status).toBe('ISSUED');
      expect(issued.issuedAt).toBe(KITCHEN_NOW);
    });
  });

  it('refuses to mark it paid while a balance stands', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      advanceInvoice(db, invoice.id, 'ISSUED', KITCHEN_NOW);
      expect(() => advanceInvoice(db, invoice.id, 'PAID', KITCHEN_NOW)).toThrow(
        /still has a balance outstanding/,
      );
    });
  });

  it('marks it paid once the balance is cleared', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      advanceInvoice(db, invoice.id, 'ISSUED', KITCHEN_NOW);
      const gross = invoiceTotals(db, invoice.id).gross.amount;
      recordPayment(db, invoice.id, { kind: 'PAYMENT', amountMinor: gross }, KITCHEN_NOW);
      expect(advanceInvoice(db, invoice.id, 'PAID', KITCHEN_NOW).status).toBe('PAID');
    });
  });

  it('refuses to skip a stage or to move a paid invoice', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      expect(() => advanceInvoice(db, invoice.id, 'PAID', KITCHEN_NOW)).toThrow(
        /a DRAFT invoice cannot become PAID/,
      );
      advanceInvoice(db, invoice.id, 'ISSUED', KITCHEN_NOW);
      const gross = invoiceTotals(db, invoice.id).gross.amount;
      recordPayment(db, invoice.id, { kind: 'PAYMENT', amountMinor: gross }, KITCHEN_NOW);
      advanceInvoice(db, invoice.id, 'PAID', KITCHEN_NOW);
      expect(() => advanceInvoice(db, invoice.id, 'VOID', KITCHEN_NOW)).toThrow(
        /a PAID invoice cannot become VOID/,
      );
    });
  });

  it('takes no payments once it is void', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      advanceInvoice(db, invoice.id, 'VOID', KITCHEN_NOW);
      expect(() =>
        recordPayment(db, invoice.id, { kind: 'PAYMENT', amountMinor: 100 }, KITCHEN_NOW),
      ).toThrow(/is void and takes no payments/);
    });
  });

  it('is a no operation when it is already there', () => {
    withStore((db) => {
      const { invoice } = billed(db);
      expect(advanceInvoice(db, invoice.id, 'DRAFT', KITCHEN_NOW).status).toBe('DRAFT');
      expect(() => advanceInvoice(db, invoice.id, 'SENT', KITCHEN_NOW)).toThrow(
        /not an invoice status/,
      );
    });
  });
});
