import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedTaxProfiles } from '../../support/billing.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { drawPackageCharges } from '../../../src/billing/charges.js';
import { advanceInvoice, raiseInvoice, recordPayment } from '../../../src/billing/invoice.js';
import {
  DEFAULT_NET_DAYS,
  accountStatement,
  ageingSummary,
  bucketFor,
  findCreditTerms,
  netDaysFor,
  setCreditTerms,
} from '../../../src/billing/statement.js';
import type { Database } from '../../../src/store/database.js';

const FENWICK = code('FENWICK');

function issued(db: Database, issuedAt = '2025-02-01T10:00:00.000Z') {
  const slot = readyFunction(db, { guarantee: 180 });
  seedTaxProfiles(db);
  drawPackageCharges(db, slot.id);
  const invoice = raiseInvoice(
    db,
    CANYON,
    { bookingId: slot.bookingId, taxProfileCode: 'DENVER' },
    KITCHEN_NOW,
  );
  advanceInvoice(db, invoice.id, 'ISSUED', issuedAt);
  return { slot, invoice };
}

describe('credit terms', () => {
  it('default to the house terms until the account is given its own', () => {
    withStore((db) => {
      issued(db);
      expect(netDaysFor(db, CANYON, FENWICK)).toBe(DEFAULT_NET_DAYS);
      expect(findCreditTerms(db, CANYON, FENWICK)).toBeUndefined();
      setCreditTerms(db, CANYON, FENWICK, 60, 5_000_000);
      expect(netDaysFor(db, CANYON, FENWICK)).toBe(60);
      expect(findCreditTerms(db, CANYON, FENWICK)?.creditLimit.amount).toBe(5_000_000);
    });
  });

  it('refuse terms outside a year and a negative limit', () => {
    withStore((db) => {
      issued(db);
      expect(() => setCreditTerms(db, CANYON, FENWICK, 400)).toThrow(/nil days to a year/);
      expect(() => setCreditTerms(db, CANYON, FENWICK, -1)).toThrow(/nil days to a year/);
      expect(() => setCreditTerms(db, CANYON, FENWICK, 30, -1)).toThrow(/nil or more/);
    });
  });
});

describe('the age bucket', () => {
  it('puts anything not yet due in current', () => {
    expect(bucketFor(-10)).toBe('CURRENT');
    expect(bucketFor(0)).toBe('CURRENT');
  });

  it('steps at thirty, sixty and ninety', () => {
    expect(bucketFor(1)).toBe('1-30');
    expect(bucketFor(30)).toBe('1-30');
    expect(bucketFor(31)).toBe('31-60');
    expect(bucketFor(60)).toBe('31-60');
    expect(bucketFor(61)).toBe('61-90');
    expect(bucketFor(90)).toBe('61-90');
    expect(bucketFor(91)).toBe('OVER-90');
  });
});

describe('the statement', () => {
  it('ages from the issue date plus the terms, not from today', () => {
    withStore((db) => {
      const { invoice } = issued(db);
      setCreditTerms(db, CANYON, FENWICK, 60);
      const statement = accountStatement(db, CANYON, FENWICK, calendarDate('2025-04-15'));
      const line = statement.lines.find((row) => row.invoiceId === invoice.id);
      expect(line?.issuedOn).toBe('2025-02-01');
      expect(line?.dueOn).toBe('2025-04-02');
      expect(line?.daysPastDue).toBe(13);
      expect(line?.bucket).toBe('1-30');
    });
  });

  it('reads the same invoice as current under longer terms', () => {
    withStore((db) => {
      issued(db);
      setCreditTerms(db, CANYON, FENWICK, 120);
      const statement = accountStatement(db, CANYON, FENWICK, calendarDate('2025-04-15'));
      expect(statement.lines[0]?.bucket).toBe('CURRENT');
      expect(statement.lines[0]?.daysPastDue).toBeLessThan(0);
    });
  });

  it('leaves a draft out of the ageing entirely', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedTaxProfiles(db);
      drawPackageCharges(db, slot.id);
      raiseInvoice(
        db,
        CANYON,
        { bookingId: slot.bookingId, taxProfileCode: 'DENVER' },
        KITCHEN_NOW,
      );
      const statement = accountStatement(db, CANYON, FENWICK, calendarDate('2025-04-15'));
      expect(statement.lines).toEqual([]);
      expect(statement.excluded).toBe(1);
      expect(statement.balance.amount).toBe(0);
    });
  });

  it('keeps a settled invoice on the statement at nil', () => {
    withStore((db) => {
      const { invoice } = issued(db);
      const statement = accountStatement(db, CANYON, FENWICK, calendarDate('2025-04-15'));
      const owed = statement.lines[0]?.balance.amount ?? 0;
      expect(owed).toBeGreaterThan(0);

      recordPayment(db, invoice.id, { kind: 'PAYMENT', amountMinor: owed }, KITCHEN_NOW);
      const settled = accountStatement(db, CANYON, FENWICK, calendarDate('2025-04-15'));
      expect(settled.lines).toHaveLength(1);
      expect(settled.lines[0]?.balance.amount).toBe(0);
      expect(settled.balance.amount).toBe(0);
    });
  });

  it('totals the buckets to the balance', () => {
    withStore((db) => {
      issued(db);
      const statement = accountStatement(db, CANYON, FENWICK, calendarDate('2025-04-15'));
      const summed = statement.buckets.reduce((total, entry) => total + entry.balance.amount, 0);
      expect(summed).toBe(statement.balance.amount);
      expect(statement.buckets.map((entry) => entry.bucket)).toEqual([
        'CURRENT',
        '1-30',
        '31-60',
        '61-90',
        'OVER-90',
      ]);
    });
  });

  it('flags an account over its limit', () => {
    withStore((db) => {
      issued(db);
      setCreditTerms(db, CANYON, FENWICK, 30, 100);
      expect(accountStatement(db, CANYON, FENWICK, calendarDate('2025-04-15')).overLimit).toBe(
        true,
      );
      setCreditTerms(db, CANYON, FENWICK, 30, 99_999_999);
      expect(accountStatement(db, CANYON, FENWICK, calendarDate('2025-04-15')).overLimit).toBe(
        false,
      );
    });
  });

  it('drops an account with nothing outstanding from the ageing sweep', () => {
    withStore((db) => {
      issued(db);
      expect(ageingSummary(db, CANYON, [FENWICK], calendarDate('2025-04-15'))).toHaveLength(1);
      expect(() => ageingSummary(db, CANYON, [], calendarDate('2025-04-15'))).toThrow(
        /no accounts were named/,
      );
    });
  });
});
