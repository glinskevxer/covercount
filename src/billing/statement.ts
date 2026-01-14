/**
 * What an account owes, and how long it has owed it.
 *
 * Ageing is measured from the date the invoice was issued plus the terms the
 * account was given, and never from today backwards to some fixed window. A
 * corporate account on net sixty and a social client paying on the day are
 * both thirty days out from issue, and only one of them is late.
 *
 * A draft invoice is not a debt. It is left out of the ageing entirely rather
 * than filed under current, because a house that counts its drafts as
 * receivable is lying to itself about its own book.
 */

import { addDays, daysBetween, type CalendarDate } from '../core/calendar.js';
import { invalidInput, notFound } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { addMoney, zeroMoney, type Money } from '../core/money.js';
import { requireProperty } from '../property/store.js';
import { requireAccount } from '../booking/accounts.js';
import { listBookings } from '../booking/store.js';
import { invoiceTotals, listInvoices } from './invoice.js';
import type { InvoiceStatus } from './types.js';
import type { Database } from '../store/database.js';

export const DEFAULT_NET_DAYS = 30;

export const AGE_BUCKETS = ['CURRENT', '1-30', '31-60', '61-90', 'OVER-90'] as const;

export type AgeBucket = (typeof AGE_BUCKETS)[number];

export interface CreditTerms {
  readonly accountCode: CatalogCode;
  readonly netDays: number;
  readonly creditLimit: Money;
}

export function setCreditTerms(
  db: Database,
  propertyCode: CatalogCode,
  accountCode: CatalogCode,
  netDays: number,
  creditLimitMinor = 0,
): CreditTerms {
  const property = requireProperty(db, propertyCode);
  requireAccount(db, propertyCode, accountCode);
  if (!Number.isSafeInteger(netDays) || netDays < 0 || netDays > 365) {
    throw invalidInput('terms.net', 'terms run from nil days to a year');
  }
  if (!Number.isSafeInteger(creditLimitMinor) || creditLimitMinor < 0) {
    throw invalidInput('terms.limit', 'a credit limit is nil or more');
  }
  db.prepare(
    `insert into credit_terms (property_code, account_code, net_days, credit_limit_minor)
     values (?, ?, ?, ?)
     on conflict (property_code, account_code) do update set
       net_days = excluded.net_days, credit_limit_minor = excluded.credit_limit_minor`,
  ).run(propertyCode, accountCode, netDays, creditLimitMinor);
  return {
    accountCode,
    netDays,
    creditLimit: { amount: creditLimitMinor, currency: property.currency },
  };
}

export function findCreditTerms(
  db: Database,
  propertyCode: CatalogCode,
  accountCode: CatalogCode,
): CreditTerms | undefined {
  const property = requireProperty(db, propertyCode);
  const row = db
    .prepare<
      [string, string],
      { net_days: number; credit_limit_minor: number }
    >('select * from credit_terms where property_code = ? and account_code = ?')
    .get(propertyCode, accountCode);
  return row === undefined
    ? undefined
    : {
        accountCode,
        netDays: row.net_days,
        creditLimit: { amount: row.credit_limit_minor, currency: property.currency },
      };
}

/** The terms in force, which for an account nobody set is the house default. */
export function netDaysFor(
  db: Database,
  propertyCode: CatalogCode,
  accountCode: CatalogCode,
): number {
  return findCreditTerms(db, propertyCode, accountCode)?.netDays ?? DEFAULT_NET_DAYS;
}

export function bucketFor(daysPastDue: number): AgeBucket {
  if (daysPastDue <= 0) return 'CURRENT';
  if (daysPastDue <= 30) return '1-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  return 'OVER-90';
}

export interface StatementLine {
  readonly invoiceId: EntityId<'invoice'>;
  readonly bookingId: EntityId<'booking'>;
  readonly postAs: string;
  readonly status: InvoiceStatus;
  readonly issuedOn: CalendarDate;
  readonly dueOn: CalendarDate;
  readonly daysPastDue: number;
  readonly bucket: AgeBucket;
  readonly gross: Money;
  readonly paid: Money;
  readonly balance: Money;
}

export interface Statement {
  readonly accountCode: CatalogCode;
  readonly accountName: string;
  readonly asOf: CalendarDate;
  readonly netDays: number;
  readonly lines: StatementLine[];
  readonly buckets: { bucket: AgeBucket; balance: Money }[];
  readonly balance: Money;
  readonly creditLimit: Money | undefined;
  readonly overLimit: boolean;
  /** Invoices left out because they are still a draft or already void. */
  readonly excluded: number;
}

/**
 * Everything outstanding on one account.
 *
 * A paid invoice stays on the statement at a nil balance. The client asked
 * what happened, not what is left, and a statement that silently drops the
 * settled half of the account gets queried every single time.
 */
export function accountStatement(
  db: Database,
  propertyCode: CatalogCode,
  accountCode: CatalogCode,
  asOf: CalendarDate,
): Statement {
  const property = requireProperty(db, propertyCode);
  const account = requireAccount(db, propertyCode, accountCode);
  const netDays = netDaysFor(db, propertyCode, accountCode);
  const bookings = new Map(
    listBookings(db, propertyCode, { accountCode }).map(
      (booking) => [booking.id, booking] as const,
    ),
  );

  const lines: StatementLine[] = [];
  let excluded = 0;
  for (const invoice of listInvoices(db, propertyCode)) {
    const booking = bookings.get(invoice.bookingId);
    if (booking === undefined) {
      continue;
    }
    if (invoice.status === 'DRAFT' || invoice.status === 'VOID' || invoice.issuedAt === undefined) {
      excluded += 1;
      continue;
    }
    const issuedOn = invoice.issuedAt.slice(0, 10) as CalendarDate;
    const dueOn = addDays(issuedOn, netDays);
    const daysPastDue = daysBetween(dueOn, asOf);
    const totals = invoiceTotals(db, invoice.id);
    lines.push({
      invoiceId: invoice.id,
      bookingId: invoice.bookingId,
      postAs: booking.postAs,
      status: invoice.status,
      issuedOn,
      dueOn,
      daysPastDue,
      bucket: bucketFor(daysPastDue),
      gross: totals.gross,
      paid: totals.paid,
      balance: totals.balance,
    });
  }

  lines.sort(
    (left, right) =>
      left.issuedOn.localeCompare(right.issuedOn) || left.invoiceId.localeCompare(right.invoiceId),
  );

  const byBucket = new Map<AgeBucket, Money>();
  let balance = zeroMoney(property.currency);
  for (const line of lines) {
    balance = addMoney(balance, line.balance);
    byBucket.set(
      line.bucket,
      addMoney(byBucket.get(line.bucket) ?? zeroMoney(property.currency), line.balance),
    );
  }

  const terms = findCreditTerms(db, propertyCode, accountCode);
  return {
    accountCode,
    accountName: account.name,
    asOf,
    netDays,
    lines,
    buckets: AGE_BUCKETS.map((bucket) => ({
      bucket,
      balance: byBucket.get(bucket) ?? zeroMoney(property.currency),
    })),
    balance,
    creditLimit: terms?.creditLimit,
    overLimit:
      terms !== undefined &&
      terms.creditLimit.amount > 0 &&
      balance.amount > terms.creditLimit.amount,
    excluded,
  };
}

/** Every account carrying a balance, worst first, for a collections call. */
export function ageingSummary(
  db: Database,
  propertyCode: CatalogCode,
  accountCodes: readonly CatalogCode[],
  asOf: CalendarDate,
): Statement[] {
  if (accountCodes.length === 0) {
    throw notFound('statement.accounts', propertyCode, 'no accounts were named to age');
  }
  return accountCodes
    .map((code) => accountStatement(db, propertyCode, code, asOf))
    .filter((statement) => statement.balance.amount !== 0)
    .sort((left, right) => right.balance.amount - left.balance.amount);
}
