/**
 * What the planner is owed.
 *
 * A third party planner brings the business and takes a cut, and the whole
 * argument is always about what the cut is a cut of. Three answers are in use
 * and they differ by thousands on a large event.
 *
 * Food and beverage only is the house's preferred reading: the planner earns
 * on what they influenced. Net is everything the house charged before service
 * and tax, which sweeps in room rental and audio visual. Gross is the whole
 * bill, tax included, which means the house pays commission on money it
 * collected for a state government and never kept. That last one gets signed
 * more often than anybody would like, so it is supported and it is flagged.
 */

import { invalidInput, notFound } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { addMoney, zeroMoney, type Money } from '../core/money.js';
import { applyRate, PPM, rate, type Rate } from '../core/rate.js';
import { requireProperty } from '../property/store.js';
import { requireAccount } from '../booking/accounts.js';
import { requireBooking } from '../booking/store.js';
import { invoiceTotals, requireInvoice } from './invoice.js';
import type { ChargeCategory } from './types.js';
import type { Database } from '../store/database.js';

const COMMISSION_BASES = ['FOOD-BEVERAGE', 'NET', 'GROSS'] as const;

export type CommissionBase = (typeof COMMISSION_BASES)[number];

export function isCommissionBase(value: string): value is CommissionBase {
  return (COMMISSION_BASES as readonly string[]).includes(value);
}

/** Whether a base pays commission on money the house never keeps. */
export function paysOnTax(base: CommissionBase): boolean {
  return base === 'GROSS';
}

export interface CommissionAgreement {
  readonly accountCode: CatalogCode;
  readonly planner: string;
  readonly commission: Rate;
  readonly base: CommissionBase;
  readonly note: string;
}

export interface SetCommissionInput {
  readonly planner: string;
  readonly ratePpm: number;
  readonly base: string;
  readonly note?: string;
}

export function setCommission(
  db: Database,
  propertyCode: CatalogCode,
  accountCode: CatalogCode,
  input: SetCommissionInput,
): CommissionAgreement {
  requireProperty(db, propertyCode);
  requireAccount(db, propertyCode, accountCode);
  const base = input.base.trim().toUpperCase();
  if (!isCommissionBase(base)) {
    throw invalidInput(
      'commission.base',
      `${input.base} is not a commission base, use food-beverage, net or gross`,
    );
  }
  if (input.planner.trim().length === 0) {
    throw invalidInput('commission.planner', 'a commission is owed to somebody by name');
  }
  if (!Number.isSafeInteger(input.ratePpm) || input.ratePpm <= 0 || input.ratePpm > PPM / 2) {
    throw invalidInput(
      'commission.rate',
      'a commission runs from something to half the bill, and half is already extraordinary',
    );
  }
  db.prepare(
    `insert into commission_agreement (property_code, account_code, planner, rate_ppm, base, note)
     values (?, ?, ?, ?, ?, ?)
     on conflict (property_code, account_code) do update set
       planner = excluded.planner,
       rate_ppm = excluded.rate_ppm,
       base = excluded.base,
       note = excluded.note`,
  ).run(
    propertyCode,
    accountCode,
    input.planner.trim(),
    input.ratePpm,
    base,
    (input.note ?? '').trim(),
  );
  return {
    accountCode,
    planner: input.planner.trim(),
    commission: rate(input.ratePpm),
    base,
    note: (input.note ?? '').trim(),
  };
}

export function findCommission(
  db: Database,
  propertyCode: CatalogCode,
  accountCode: CatalogCode,
): CommissionAgreement | undefined {
  const row = db
    .prepare<
      [string, string],
      { planner: string; rate_ppm: number; base: string; note: string }
    >('select * from commission_agreement where property_code = ? and account_code = ?')
    .get(propertyCode, accountCode);
  return row === undefined
    ? undefined
    : {
        accountCode,
        planner: row.planner,
        commission: rate(row.rate_ppm),
        base: row.base as CommissionBase,
        note: row.note,
      };
}

export function clearCommission(
  db: Database,
  propertyCode: CatalogCode,
  accountCode: CatalogCode,
): boolean {
  return (
    db
      .prepare('delete from commission_agreement where property_code = ? and account_code = ?')
      .run(propertyCode, accountCode).changes > 0
  );
}

const EARNING_CATEGORIES: readonly ChargeCategory[] = ['FOOD', 'BEVERAGE'];

export interface CommissionDue {
  readonly invoiceId: EntityId<'invoice'>;
  readonly planner: string;
  readonly agreement: CommissionAgreement;
  /** The amount the rate was applied to. */
  readonly base: Money;
  readonly due: Money;
  /** True when the base includes tax the house collected for somebody else. */
  readonly includesTax: boolean;
}

/**
 * What the planner earns on one invoice.
 *
 * The base is worked out from the invoice's own line totals rather than from
 * the charges, so a category with a nil net still contributes nothing and the
 * three bases stay comparable. Every one of them is computed off the same
 * totals object, which is the only way the three can be argued about without
 * somebody recomputing one of them differently.
 */
export function commissionOn(db: Database, invoiceId: EntityId<'invoice'>): CommissionDue {
  const invoice = requireInvoice(db, invoiceId);
  const property = requireProperty(db, invoice.propertyCode);
  const booking = requireBooking(db, invoice.bookingId);
  if (booking.accountCode === undefined) {
    throw notFound(
      'commission.account',
      invoiceId,
      `booking ${booking.id} is not on an account, so nobody is owed a commission`,
    );
  }
  const agreement = findCommission(db, invoice.propertyCode, booking.accountCode);
  if (agreement === undefined) {
    throw notFound(
      'commission.agreement',
      booking.accountCode,
      `${booking.accountCode} has no commission agreement`,
    );
  }

  const totals = invoiceTotals(db, invoiceId);
  let base = zeroMoney(property.currency);
  if (agreement.base === 'FOOD-BEVERAGE') {
    for (const line of totals.lines) {
      if (EARNING_CATEGORIES.includes(line.category)) {
        base = addMoney(base, line.net);
      }
    }
  } else if (agreement.base === 'NET') {
    base = totals.net;
  } else {
    base = totals.gross;
  }

  return {
    invoiceId,
    planner: agreement.planner,
    agreement,
    base,
    due: applyRate(base, agreement.commission),
    includesTax: paysOnTax(agreement.base),
  };
}

/** The same figure under each of the three bases, for arguing about at signing. */
export function compareBases(
  db: Database,
  invoiceId: EntityId<'invoice'>,
  commission: Rate,
): { base: CommissionBase; amount: Money; due: Money }[] {
  const invoice = requireInvoice(db, invoiceId);
  const property = requireProperty(db, invoice.propertyCode);
  const totals = invoiceTotals(db, invoiceId);

  let foodBeverage = zeroMoney(property.currency);
  for (const line of totals.lines) {
    if (EARNING_CATEGORIES.includes(line.category)) {
      foodBeverage = addMoney(foodBeverage, line.net);
    }
  }

  return [
    { base: 'FOOD-BEVERAGE' as const, amount: foodBeverage },
    { base: 'NET' as const, amount: totals.net },
    { base: 'GROSS' as const, amount: totals.gross },
  ].map((entry) => ({ ...entry, due: applyRate(entry.amount, commission) }));
}
