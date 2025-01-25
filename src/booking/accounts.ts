/**
 * The accounts a property books business from.
 *
 * Credit status is the field that matters downstream. An account on hold can
 * still be quoted and can still hold space, but it cannot turn a booking
 * definite, because the hotel is not going to buy the food for a client the
 * controller has stopped. The rule lives in the booking transitions, not here,
 * but it is why credit status is on the account rather than on the deal.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { requireProperty } from '../property/store.js';
import type { Database } from '../store/database.js';
import {
  isAccountKind,
  isCreditStatus,
  type Account,
  type AccountKind,
  type CreditStatus,
} from './types.js';

interface AccountRow {
  property_code: string;
  code: string;
  name: string;
  kind: string;
  billing_email: string;
  credit_status: string;
  tax_exempt_id: string;
  created_at: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toAccount(row: AccountRow): Account {
  return {
    propertyCode: catalogCode(row.property_code),
    code: catalogCode(row.code),
    name: row.name,
    kind: row.kind as AccountKind,
    billingEmail: row.billing_email,
    creditStatus: row.credit_status as CreditStatus,
    taxExemptId: row.tax_exempt_id,
    createdAt: row.created_at,
  };
}

export interface CreateAccountInput {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly billingEmail?: string;
  readonly creditStatus?: string;
  readonly taxExemptId?: string;
}

export function createAccount(
  db: Database,
  propertyCode: CatalogCode,
  input: CreateAccountInput,
  now: string,
): Account {
  requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  const name = input.name.trim();
  if (name.length === 0) {
    throw invalidInput('account.name', 'an account needs a name');
  }
  const kind = input.kind.trim().toUpperCase();
  if (!isAccountKind(kind)) {
    throw invalidInput('account.kind', `${input.kind} is not an account kind this build knows`);
  }
  const creditStatus = (input.creditStatus ?? 'APPROVED').trim().toUpperCase();
  if (!isCreditStatus(creditStatus)) {
    throw invalidInput('account.credit', `${input.creditStatus} is not a credit status`);
  }
  const email = (input.billingEmail ?? '').trim();
  if (email.length > 0 && !EMAIL.test(email)) {
    throw invalidInput('account.email', `${email} does not look like a billing address`);
  }
  const taxExemptId = (input.taxExemptId ?? '').trim();
  if (taxExemptId.length > 0 && kind === 'SOCIAL') {
    throw invalidInput(
      'account.exempt',
      'a social account cannot carry a tax exemption, that is a body with a certificate',
    );
  }

  const existing = db
    .prepare<
      [string, string],
      { code: string }
    >('select code from account where property_code = ? and code = ?')
    .get(propertyCode, code);
  if (existing !== undefined) {
    throw conflict('account.exists', `${propertyCode} already has an account ${code}`, code);
  }

  db.prepare(
    `insert into account (property_code, code, name, kind, billing_email, credit_status,
      tax_exempt_id, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(propertyCode, code, name, kind, email, creditStatus, taxExemptId, now);

  return requireAccount(db, propertyCode, code);
}

export function findAccount(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): Account | undefined {
  const row = db
    .prepare<
      [string, string],
      AccountRow
    >('select * from account where property_code = ? and code = ?')
    .get(propertyCode, code);
  return row === undefined ? undefined : toAccount(row);
}

export function requireAccount(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): Account {
  const found = findAccount(db, propertyCode, code);
  if (found === undefined) {
    throw notFound('account.missing', code, `${propertyCode} has no account ${code}`);
  }
  return found;
}

export function listAccounts(db: Database, propertyCode: CatalogCode): Account[] {
  return db
    .prepare<[string], AccountRow>('select * from account where property_code = ? order by code')
    .all(propertyCode)
    .map(toAccount);
}

export function setCreditStatus(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
  status: string,
): Account {
  requireAccount(db, propertyCode, code);
  const normalised = status.trim().toUpperCase();
  if (!isCreditStatus(normalised)) {
    throw invalidInput('account.credit', `${status} is not a credit status`);
  }
  db.prepare('update account set credit_status = ? where property_code = ? and code = ?').run(
    normalised,
    propertyCode,
    code,
  );
  return requireAccount(db, propertyCode, code);
}

export function setBillingEmail(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
  email: string,
): Account {
  requireAccount(db, propertyCode, code);
  const trimmed = email.trim();
  if (trimmed.length > 0 && !EMAIL.test(trimmed)) {
    throw invalidInput('account.email', `${email} does not look like a billing address`);
  }
  db.prepare('update account set billing_email = ? where property_code = ? and code = ?').run(
    trimmed,
    propertyCode,
    code,
  );
  return requireAccount(db, propertyCode, code);
}

/** An account the controller has stopped cannot commit the hotel to spend. */
export function canCommitBusiness(account: Account): boolean {
  return account.creditStatus !== 'HOLD';
}

/** Whether tax should come off this account's invoices. */
export function isTaxExempt(account: Account): boolean {
  return account.taxExemptId.length > 0;
}
