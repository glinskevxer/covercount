/**
 * Totalling an invoice.
 *
 * The order is the whole point and it is this:
 *
 *   1. net per category, from the charge lines
 *   2. service charge on the serviceable lines only
 *   3. tax on the net of each category at that category's rate
 *   4. tax on the service charge, but only where the profile says it is taxable
 *   5. gratuity, which is never taxed because it is the servers' money
 *
 * Getting step four wrong is the difference between an invoice that passes an
 * audit and one that does not, and it is the reason the flag is on the profile
 * rather than being a constant in this file.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, parseEntityId, type CatalogCode, type EntityId } from '../core/ids.js';
import { addMoney, money, subtractMoney, sumMoney, zeroMoney, type Money } from '../core/money.js';
import { applyRate } from '../core/rate.js';
import { listFunctions, requireFunction } from '../booking/functions.js';
import { requireBooking } from '../booking/store.js';
import { holdsSpace } from '../booking/types.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import { allocateEntityId } from '../store/sequence.js';
import { listCharges, lineTotal } from './charges.js';
import { requireTaxProfile, taxRateFor } from './tax.js';
import {
  isInvoiceStatus,
  isPaymentKind,
  isCredit,
  type ChargeCategory,
  type Invoice,
  type InvoiceLineTotal,
  type InvoiceStatus,
  type InvoiceTotals,
  type Payment,
  type PaymentKind,
} from './types.js';

interface InvoiceRow {
  id: string;
  property_code: string;
  booking_id: string;
  tax_profile_code: string;
  status: string;
  issued_at: string | null;
  created_at: string;
  note: string;
}

function toInvoice(row: InvoiceRow): Invoice {
  return {
    id: parseEntityId('invoice', row.id),
    propertyCode: catalogCode(row.property_code),
    bookingId: parseEntityId('booking', row.booking_id),
    taxProfileCode: catalogCode(row.tax_profile_code),
    status: row.status as InvoiceStatus,
    issuedAt: row.issued_at ?? undefined,
    note: row.note,
    createdAt: row.created_at,
  };
}

export interface RaiseInvoiceInput {
  readonly bookingId: string;
  readonly taxProfileCode: string;
  readonly functionIds?: readonly string[];
  readonly note?: string;
}

export function raiseInvoice(
  db: Database,
  propertyCode: CatalogCode,
  input: RaiseInvoiceInput,
  now: string,
): Invoice {
  requireProperty(db, propertyCode);
  const bookingId = parseEntityId('booking', input.bookingId);
  const booking = requireBooking(db, bookingId);
  const profileCode = catalogCode(input.taxProfileCode);
  requireTaxProfile(db, propertyCode, profileCode);

  const chosen =
    input.functionIds === undefined
      ? listFunctions(db, bookingId)
          .filter((slot) => holdsSpace(slot.status))
          .map((slot) => slot.id)
      : input.functionIds.map((each) => parseEntityId('functionSlot', each));
  if (chosen.length === 0) {
    throw conflict('invoice.empty', `${bookingId} has no functions to invoice`, bookingId);
  }
  for (const functionId of chosen) {
    const slot = requireFunction(db, functionId);
    if (slot.bookingId !== bookingId) {
      throw invalidInput('invoice.function', `${functionId} does not belong to ${bookingId}`);
    }
  }

  return inTransaction(db, (handle) => {
    const id = allocateEntityId(
      handle,
      propertyCode,
      'invoice',
      Number(booking.arrivalDate.slice(0, 4)),
    );
    handle
      .prepare(
        `insert into invoice (id, property_code, booking_id, tax_profile_code, status,
          created_at, note)
         values (?, ?, ?, ?, 'DRAFT', ?, ?)`,
      )
      .run(id, propertyCode, bookingId, profileCode, now, (input.note ?? '').trim());
    const link = handle.prepare(
      'insert into invoice_function (invoice_id, function_id) values (?, ?)',
    );
    for (const functionId of chosen) {
      link.run(id, functionId);
    }
    return requireInvoice(handle, id);
  });
}

export function findInvoice(db: Database, id: EntityId<'invoice'>): Invoice | undefined {
  const row = db.prepare<[string], InvoiceRow>('select * from invoice where id = ?').get(id);
  return row === undefined ? undefined : toInvoice(row);
}

export function requireInvoice(db: Database, id: EntityId<'invoice'>): Invoice {
  const found = findInvoice(db, id);
  if (found === undefined) {
    throw notFound('invoice.missing', id, `invoice ${id} is not on file`);
  }
  return found;
}

export function invoiceFunctions(
  db: Database,
  id: EntityId<'invoice'>,
): EntityId<'functionSlot'>[] {
  return db
    .prepare<[string], { function_id: string }>(
      'select function_id from invoice_function where invoice_id = ? order by function_id',
    )
    .all(id)
    .map((row) => parseEntityId('functionSlot', row.function_id));
}

export function listInvoices(
  db: Database,
  propertyCode: CatalogCode,
  options: { bookingId?: string; status?: string } = {},
): Invoice[] {
  const clauses = ['property_code = ?'];
  const params: string[] = [propertyCode];
  if (options.bookingId !== undefined) {
    clauses.push('booking_id = ?');
    params.push(parseEntityId('booking', options.bookingId));
  }
  if (options.status !== undefined) {
    const status = options.status.trim().toUpperCase();
    if (!isInvoiceStatus(status)) {
      throw invalidInput('invoice.status', `${options.status} is not an invoice status`);
    }
    clauses.push('status = ?');
    params.push(status);
  }
  return db
    .prepare<string[], InvoiceRow>(
      `select * from invoice where ${clauses.join(' and ')} order by id`,
    )
    .all(...params)
    .map(toInvoice);
}

export function invoiceTotals(db: Database, id: EntityId<'invoice'>): InvoiceTotals {
  const invoice = requireInvoice(db, id);
  const property = requireProperty(db, invoice.propertyCode);
  const currency = property.currency;
  const profile = requireTaxProfile(db, invoice.propertyCode, invoice.taxProfileCode);

  const netByCategory = new Map<ChargeCategory, Money>();
  const serviceableByCategory = new Map<ChargeCategory, Money>();
  const taxableByCategory = new Map<ChargeCategory, Money>();

  for (const functionId of invoiceFunctions(db, id)) {
    for (const line of listCharges(db, functionId)) {
      const total = lineTotal(line);
      netByCategory.set(
        line.category,
        addMoney(netByCategory.get(line.category) ?? zeroMoney(currency), total),
      );
      if (line.serviceable) {
        serviceableByCategory.set(
          line.category,
          addMoney(serviceableByCategory.get(line.category) ?? zeroMoney(currency), total),
        );
      }
      if (line.taxable) {
        taxableByCategory.set(
          line.category,
          addMoney(taxableByCategory.get(line.category) ?? zeroMoney(currency), total),
        );
      }
    }
  }

  const lines: InvoiceLineTotal[] = [];
  let serviceCharge = zeroMoney(currency);
  let tax = zeroMoney(currency);

  for (const [category, net] of [...netByCategory.entries()].sort((left, right) =>
    left[0].localeCompare(right[0]),
  )) {
    const serviceable = serviceableByCategory.get(category) ?? zeroMoney(currency);
    const lineService = applyRate(serviceable, profile.serviceCharge);
    const taxable = taxableByCategory.get(category) ?? zeroMoney(currency);
    const categoryRate = taxRateFor(db, invoice.propertyCode, invoice.taxProfileCode, category);
    let lineTax = applyRate(taxable, categoryRate);

    if (profile.serviceChargeTaxable) {
      const serviceRate = taxRateFor(db, invoice.propertyCode, invoice.taxProfileCode, 'SERVICE');
      lineTax = addMoney(lineTax, applyRate(lineService, serviceRate));
    }

    lines.push({ category, net, serviceCharge: lineService, tax: lineTax });
    serviceCharge = addMoney(serviceCharge, lineService);
    tax = addMoney(tax, lineTax);
  }

  const net = sumMoney(
    lines.map((line) => line.net),
    currency,
  );
  const gratuityBase = sumMoney(
    lines.map((line) => (line.serviceCharge.amount > 0 ? line.net : zeroMoney(currency))),
    currency,
  );
  const gratuity = applyRate(gratuityBase, profile.gratuity);
  const gross = addMoney(addMoney(addMoney(net, serviceCharge), tax), gratuity);
  const paid = paidToDate(db, id);

  return {
    lines,
    net,
    serviceCharge,
    gratuity,
    tax,
    gross,
    paid,
    balance: subtractMoney(gross, paid),
    asOf: undefined,
  };
}

export function recordPayment(
  db: Database,
  id: EntityId<'invoice'>,
  input: { kind: string; amountMinor: number; reference?: string },
  receivedAt: string,
): Payment {
  const invoice = requireInvoice(db, id);
  const property = requireProperty(db, invoice.propertyCode);
  if (invoice.status === 'VOID') {
    throw conflict('invoice.void', `${id} is void and takes no payments`, id);
  }
  const kind = input.kind.trim().toUpperCase();
  if (!isPaymentKind(kind)) {
    throw invalidInput('invoice.payment', `${input.kind} is not a payment kind`);
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw invalidInput('invoice.payment', 'a payment is a positive whole number of minor units');
  }
  const result = db
    .prepare(
      `insert into invoice_payment (invoice_id, received_at, kind, amount_minor, reference)
       values (?, ?, ?, ?, ?)`,
    )
    .run(id, receivedAt, kind, input.amountMinor, (input.reference ?? '').trim());
  const seq = Number(result.lastInsertRowid);
  return {
    seq,
    receivedAt,
    kind,
    amount: money(input.amountMinor, property.currency),
    reference: (input.reference ?? '').trim(),
  };
}

export function listPayments(db: Database, id: EntityId<'invoice'>): Payment[] {
  const invoice = requireInvoice(db, id);
  const property = requireProperty(db, invoice.propertyCode);
  return db
    .prepare<
      [string],
      { seq: number; received_at: string; kind: string; amount_minor: number; reference: string }
    >('select * from invoice_payment where invoice_id = ? order by seq')
    .all(id)
    .map((row) => ({
      seq: row.seq,
      receivedAt: row.received_at,
      kind: row.kind as PaymentKind,
      amount: money(row.amount_minor, property.currency),
      reference: row.reference,
    }));
}

/** Credits less refunds, which is what has actually landed. */
export function paidToDate(db: Database, id: EntityId<'invoice'>): Money {
  const invoice = requireInvoice(db, id);
  const property = requireProperty(db, invoice.propertyCode);
  let total = zeroMoney(property.currency);
  for (const payment of listPayments(db, id)) {
    total = isCredit(payment.kind)
      ? addMoney(total, payment.amount)
      : subtractMoney(total, payment.amount);
  }
  return total;
}

const NEXT_INVOICE_STATUS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  DRAFT: ['ISSUED', 'VOID'],
  ISSUED: ['PAID', 'VOID'],
  PAID: [],
  VOID: [],
};

export function advanceInvoice(
  db: Database,
  id: EntityId<'invoice'>,
  to: string,
  now: string,
): Invoice {
  const invoice = requireInvoice(db, id);
  const target = to.trim().toUpperCase();
  if (!isInvoiceStatus(target)) {
    throw invalidInput('invoice.status', `${to} is not an invoice status`);
  }
  if (invoice.status === target) {
    return invoice;
  }
  if (!NEXT_INVOICE_STATUS[invoice.status].includes(target)) {
    throw conflict('invoice.transition', `a ${invoice.status} invoice cannot become ${target}`, id);
  }
  if (target === 'PAID' && invoiceTotals(db, id).balance.amount > 0) {
    throw conflict('invoice.balance', `${id} still has a balance outstanding`, id);
  }
  db.prepare(
    'update invoice set status = ?, issued_at = case when ? = ? then ? else issued_at end where id = ?',
  ).run(target, target, 'ISSUED', now, id);
  return requireInvoice(db, id);
}
