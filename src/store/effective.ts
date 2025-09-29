/**
 * Effective dated lookups.
 *
 * Three things in this build are priced by the date they were agreed rather
 * than by the date somebody asks: menu prices, package prices and labour
 * rates. All three want the same query, which is the row with the latest
 * effective date that is not after the date in question, and all three were
 * spelling it out separately. The one that mattered is the one that is easy to
 * get wrong: `<=` rather than `<`, so a rate that takes effect on the service
 * date applies on that date.
 */

import { calendarDate, type CalendarDate } from '../core/calendar.js';
import { invalidInput } from '../core/errors.js';
import type { Database } from './database.js';

export interface EffectiveTable {
  /** The table the dated rows live in. */
  readonly table: string;
  /** Columns that identify one series of dated rows. */
  readonly keys: readonly string[];
  /** The column holding the date a row takes effect. */
  readonly dateColumn: string;
  /** The column holding the value. */
  readonly valueColumn: string;
}

function assertIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw invalidInput('store.identifier', `${value} is not a column or table name`);
  }
  return value;
}

function where(table: EffectiveTable): string {
  return table.keys.map((key) => `${assertIdentifier(key)} = ?`).join(' and ');
}

/** The value in force on a date, or nothing when the series starts later. */
export function valueOn(
  db: Database,
  table: EffectiveTable,
  keys: readonly (string | number)[],
  on: CalendarDate,
): number | undefined {
  if (keys.length !== table.keys.length) {
    throw invalidInput(
      'store.keys',
      `${table.table} is keyed on ${table.keys.length} columns and ${keys.length} were given`,
    );
  }
  const row = db
    .prepare<(string | number)[], Record<string, number>>(
      `select ${assertIdentifier(table.valueColumn)} as value from ${assertIdentifier(table.table)}
       where ${where(table)} and ${assertIdentifier(table.dateColumn)} <= ?
       order by ${assertIdentifier(table.dateColumn)} desc limit 1`,
    )
    .get(...keys, on);
  return row?.value;
}

export interface EffectiveRow {
  readonly effectiveFrom: CalendarDate;
  readonly value: number;
}

/** Every dated row in a series, oldest first. */
export function seriesFor(
  db: Database,
  table: EffectiveTable,
  keys: readonly (string | number)[],
): EffectiveRow[] {
  return db
    .prepare<(string | number)[], Record<string, string | number>>(
      `select ${assertIdentifier(table.dateColumn)} as effective_from,
        ${assertIdentifier(table.valueColumn)} as value
       from ${assertIdentifier(table.table)}
       where ${where(table)}
       order by ${assertIdentifier(table.dateColumn)}`,
    )
    .all(...keys)
    .map((row) => ({
      effectiveFrom: calendarDate(String(row.effective_from)),
      value: Number(row.value),
    }));
}

/** Every series in the table, at one date, keyed by the identifying columns. */
export function tableOn(
  db: Database,
  table: EffectiveTable,
  scope: readonly (string | number)[],
  scopeColumns: readonly string[],
  on: CalendarDate,
): { keys: string[]; effectiveFrom: CalendarDate; value: number }[] {
  const grouping = table.keys.map((key) => assertIdentifier(key)).join(', ');
  const scoped = scopeColumns.map((column) => `${assertIdentifier(column)} = ?`).join(' and ');
  return db
    .prepare<(string | number)[], Record<string, string | number>>(
      `select ${grouping}, max(${assertIdentifier(table.dateColumn)}) as effective_from,
        ${assertIdentifier(table.valueColumn)} as value
       from ${assertIdentifier(table.table)}
       where ${scoped} and ${assertIdentifier(table.dateColumn)} <= ?
       group by ${grouping}
       order by ${grouping}`,
    )
    .all(...scope, on)
    .map((row) => ({
      keys: table.keys.map((key) => String(row[key])),
      effectiveFrom: calendarDate(String(row.effective_from)),
      value: Number(row.value),
    }));
}

export const PRICE_LINES: EffectiveTable = {
  table: 'price_line',
  keys: ['property_code', 'book_code', 'subject_kind', 'subject_code'],
  dateColumn: 'effective_from',
  valueColumn: 'price_minor',
};

export const LABOUR_RATES: EffectiveTable = {
  table: 'labour_rate',
  keys: ['property_code', 'role'],
  dateColumn: 'effective_from',
  valueColumn: 'hourly_minor',
};
