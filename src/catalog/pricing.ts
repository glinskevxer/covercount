/**
 * Price books, and the date a price was in force.
 *
 * A price is never edited. Putting a new number on an item writes a line with
 * the date it takes effect, and the lookup asks which line was in force on the
 * date the contract was signed. That is what lets a function booked eleven
 * months out be quoted honestly and repriced deliberately rather than by
 * accident when the book turns over in January.
 */

import { calendarDate, compareCalendarDates, type CalendarDate } from '../core/calendar.js';
import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { isCurrencyCode, money, type CurrencyCode, type Money } from '../core/money.js';
import { requireProperty } from '../property/store.js';
import type { Database } from '../store/database.js';
import { PRICE_LINES, seriesFor, tableOn, valueOn } from '../store/effective.js';
import { requireItem } from './items.js';
import { requirePackage } from './packages.js';
import { isPriceSubject, type PriceBook, type PriceLine, type PriceSubject } from './types.js';

interface BookRow {
  property_code: string;
  code: string;
  name: string;
  currency: string;
  created_at: string;
}

function toBook(row: BookRow): PriceBook {
  return {
    propertyCode: catalogCode(row.property_code),
    code: catalogCode(row.code),
    name: row.name,
    currency: row.currency as CurrencyCode,
    createdAt: row.created_at,
  };
}

export function createPriceBook(
  db: Database,
  propertyCode: CatalogCode,
  input: { code: string; name: string; currency?: string },
  now: string,
): PriceBook {
  const property = requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  const name = input.name.trim();
  if (name.length === 0) {
    throw invalidInput('book.name', 'a price book needs a name');
  }
  const currency = (input.currency ?? property.currency).trim().toUpperCase();
  if (!isCurrencyCode(currency)) {
    throw invalidInput('book.currency', `${input.currency} is not a currency this build holds`);
  }
  if (currency !== property.currency) {
    throw invalidInput(
      'book.currency',
      `${propertyCode} invoices in ${property.currency} and cannot carry a ${currency} book`,
    );
  }

  const clash = db
    .prepare<
      [string, string],
      { code: string }
    >('select code from price_book where property_code = ? and code = ?')
    .get(propertyCode, code);
  if (clash !== undefined) {
    throw conflict('book.exists', `${propertyCode} already has a price book ${code}`, code);
  }

  db.prepare(
    'insert into price_book (property_code, code, name, currency, created_at) values (?, ?, ?, ?, ?)',
  ).run(propertyCode, code, name, currency, now);
  return requirePriceBook(db, propertyCode, code);
}

export function findPriceBook(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): PriceBook | undefined {
  const row = db
    .prepare<
      [string, string],
      BookRow
    >('select * from price_book where property_code = ? and code = ?')
    .get(propertyCode, code);
  return row === undefined ? undefined : toBook(row);
}

export function requirePriceBook(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): PriceBook {
  const found = findPriceBook(db, propertyCode, code);
  if (found === undefined) {
    throw notFound('book.missing', code, `${propertyCode} has no price book ${code}`);
  }
  return found;
}

export function listPriceBooks(db: Database, propertyCode: CatalogCode): PriceBook[] {
  return db
    .prepare<[string], BookRow>('select * from price_book where property_code = ? order by code')
    .all(propertyCode)
    .map(toBook);
}

export interface SetPriceInput {
  readonly bookCode: string;
  readonly subjectKind: string;
  readonly subjectCode: string;
  readonly effectiveFrom: string;
  readonly priceMinor: number;
}

export function setPrice(db: Database, propertyCode: CatalogCode, input: SetPriceInput): PriceLine {
  const bookCode = catalogCode(input.bookCode);
  const book = requirePriceBook(db, propertyCode, bookCode);
  const subjectKind = input.subjectKind.trim().toUpperCase();
  if (!isPriceSubject(subjectKind)) {
    throw invalidInput(
      'price.subject',
      `${input.subjectKind} is not something a price attaches to`,
    );
  }
  const subjectCode = catalogCode(input.subjectCode);
  if (subjectKind === 'ITEM') {
    requireItem(db, propertyCode, subjectCode);
  } else {
    requirePackage(db, propertyCode, subjectCode);
  }
  if (!Number.isSafeInteger(input.priceMinor)) {
    throw invalidInput('price.amount', 'a price is a whole number of minor units');
  }
  if (input.priceMinor < 0) {
    throw invalidInput('price.amount', `a price cannot be negative, got ${input.priceMinor}`);
  }
  const effectiveFrom = calendarDate(input.effectiveFrom);

  db.prepare(
    `insert into price_line (property_code, book_code, subject_kind, subject_code,
      effective_from, price_minor)
     values (?, ?, ?, ?, ?, ?)
     on conflict (property_code, book_code, subject_kind, subject_code, effective_from)
     do update set price_minor = excluded.price_minor`,
  ).run(propertyCode, bookCode, subjectKind, subjectCode, effectiveFrom, input.priceMinor);

  return {
    bookCode,
    subjectKind,
    subjectCode,
    effectiveFrom,
    price: money(input.priceMinor, book.currency),
  };
}

/**
 * The price in force on a date. The line with the latest effective date that
 * is not in the future wins; a book with no line on or before the date has no
 * price, which is different from a price of zero.
 */
export function findPriceOn(
  db: Database,
  propertyCode: CatalogCode,
  bookCode: CatalogCode,
  subjectKind: PriceSubject,
  subjectCode: CatalogCode,
  on: CalendarDate,
): Money | undefined {
  const book = requirePriceBook(db, propertyCode, bookCode);
  const minor = valueOn(db, PRICE_LINES, [propertyCode, bookCode, subjectKind, subjectCode], on);
  return minor === undefined ? undefined : money(minor, book.currency);
}

export function requirePriceOn(
  db: Database,
  propertyCode: CatalogCode,
  bookCode: CatalogCode,
  subjectKind: PriceSubject,
  subjectCode: CatalogCode,
  on: CalendarDate,
): Money {
  const found = findPriceOn(db, propertyCode, bookCode, subjectKind, subjectCode, on);
  if (found === undefined) {
    throw notFound(
      'price.missing',
      subjectCode,
      `${bookCode} carries no price for ${subjectCode} on ${on}`,
    );
  }
  return found;
}

export function priceHistory(
  db: Database,
  propertyCode: CatalogCode,
  bookCode: CatalogCode,
  subjectKind: PriceSubject,
  subjectCode: CatalogCode,
): PriceLine[] {
  const book = requirePriceBook(db, propertyCode, bookCode);
  return seriesFor(db, PRICE_LINES, [propertyCode, bookCode, subjectKind, subjectCode]).map(
    (row) => ({
      bookCode,
      subjectKind,
      subjectCode,
      effectiveFrom: row.effectiveFrom,
      price: money(row.value, book.currency),
    }),
  );
}

/** Every price a book carries on one date, for printing the book itself. */
export function bookOn(
  db: Database,
  propertyCode: CatalogCode,
  bookCode: CatalogCode,
  on: CalendarDate,
): PriceLine[] {
  const book = requirePriceBook(db, propertyCode, bookCode);
  return tableOn(db, PRICE_LINES, [propertyCode, bookCode], ['property_code', 'book_code'], on).map(
    (row) => ({
      bookCode,
      subjectKind: (row.keys[2] ?? 'ITEM') as PriceSubject,
      subjectCode: catalogCode(row.keys[3] ?? ''),
      effectiveFrom: row.effectiveFrom,
      price: money(row.value, book.currency),
    }),
  );
}

export function removePrice(
  db: Database,
  propertyCode: CatalogCode,
  bookCode: CatalogCode,
  subjectKind: PriceSubject,
  subjectCode: CatalogCode,
  effectiveFrom: CalendarDate,
): boolean {
  requirePriceBook(db, propertyCode, bookCode);
  const result = db
    .prepare(
      `delete from price_line
       where property_code = ? and book_code = ? and subject_kind = ? and subject_code = ?
         and effective_from = ?`,
    )
    .run(propertyCode, bookCode, subjectKind, subjectCode, effectiveFrom);
  return result.changes > 0;
}

/**
 * Copy a book forward. A property that raises everything by a rate for the new
 * year does it once, and the old lines stay where they are so last year's
 * contracts still price the way they were signed.
 */
export function rollForward(
  db: Database,
  propertyCode: CatalogCode,
  bookCode: CatalogCode,
  from: CalendarDate,
  to: CalendarDate,
  adjust: (price: Money) => Money,
): number {
  if (compareCalendarDates(to, from) <= 0) {
    throw invalidInput(
      'price.roll',
      `${to} is not after ${from}, so there is nothing to roll into`,
    );
  }
  const lines = bookOn(db, propertyCode, bookCode, from);
  let written = 0;
  for (const line of lines) {
    const next = adjust(line.price);
    setPrice(db, propertyCode, {
      bookCode: line.bookCode,
      subjectKind: line.subjectKind,
      subjectCode: line.subjectCode,
      effectiveFrom: to,
      priceMinor: next.amount,
    });
    written += 1;
  }
  return written;
}
