/**
 * Loading a spreadsheet somebody sent over.
 *
 * A price book arrives once a year as a file with a hundred and forty rows in
 * it, and the rows are not all good. The rule this module exists to enforce is
 * that a partial import is worse than no import: half a price book loaded is a
 * book where some items are this year's and some are last year's, and nobody
 * can tell which by looking.
 *
 * So every row is read and checked before a single one is written, the whole
 * lot goes in one transaction, and a dry run does exactly what a real run does
 * except for the writing. That last part matters: a dry run that takes a
 * different path through the code is a dry run that reports a clean file and
 * then fails on the real one.
 */

import { calendarDate, isCalendarDate } from '../core/calendar.js';
import { invalidInput } from '../core/errors.js';
import type { CatalogCode } from '../core/ids.js';
import { parseMoney } from '../core/money.js';
import { requireProperty } from '../property/store.js';
import { setPrice } from '../catalog/pricing.js';
import { createIngredient } from '../production/ingredients.js';
import { fromCsv } from '../reports/csv.js';
import { inTransaction, type Database } from './database.js';

export interface ImportProblem {
  /** The line in the file, counting the header as line one. */
  readonly line: number;
  readonly message: string;
}

export interface ImportReport {
  readonly read: number;
  readonly written: number;
  readonly problems: ImportProblem[];
  readonly dryRun: boolean;
}

export interface ImportOptions {
  readonly dryRun?: boolean;
}

function requireColumns(rows: readonly Record<string, string>[], needed: readonly string[]): void {
  const first = rows[0];
  if (first === undefined) {
    return;
  }
  const missing = needed.filter((column) => !(column in first));
  if (missing.length > 0) {
    throw invalidInput('import.columns', `the file is missing the ${missing.join(', ')} column(s)`);
  }
}

const PRICE_COLUMNS = ['subject', 'code', 'from', 'price'] as const;

/**
 * Load a price book. Every row is validated first, then the whole lot is
 * written under one transaction, so a bad row on line ninety leaves the book
 * exactly as it was.
 */
export function importPrices(
  db: Database,
  propertyCode: CatalogCode,
  bookCode: CatalogCode,
  text: string,
  options: ImportOptions = {},
): ImportReport {
  const property = requireProperty(db, propertyCode);
  const rows = fromCsv(text);
  requireColumns(rows, PRICE_COLUMNS);

  const problems: ImportProblem[] = [];
  const staged: {
    subjectKind: string;
    subjectCode: string;
    effectiveFrom: string;
    priceMinor: number;
  }[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const line = index + 2;
    const subject = (row.subject ?? '').trim().toUpperCase();
    const code = (row.code ?? '').trim().toUpperCase();
    const from = (row.from ?? '').trim();
    const price = (row.price ?? '').trim();

    if (code.length === 0) {
      problems.push({ line, message: 'no code on the row' });
      return;
    }
    if (subject !== 'ITEM' && subject !== 'PACKAGE') {
      problems.push({ line, message: `${row.subject ?? ''} is neither an item nor a package` });
      return;
    }
    if (!isCalendarDate(from)) {
      problems.push({ line, message: `${from} is not a date` });
      return;
    }
    let minor: number;
    try {
      minor = parseMoney(price, property.currency).amount;
    } catch {
      problems.push({ line, message: `${price} is not a ${property.currency} amount` });
      return;
    }
    const key = `${subject}:${code}:${from}`;
    if (seen.has(key)) {
      problems.push({ line, message: `${code} is priced twice from ${from} in this file` });
      return;
    }
    seen.add(key);
    staged.push({
      subjectKind: subject,
      subjectCode: code,
      effectiveFrom: from,
      priceMinor: minor,
    });
  });

  if (problems.length > 0 || options.dryRun === true) {
    return { read: rows.length, written: 0, problems, dryRun: options.dryRun === true };
  }

  inTransaction(db, (handle) => {
    for (const entry of staged) {
      setPrice(handle, propertyCode, {
        bookCode,
        subjectKind: entry.subjectKind,
        subjectCode: entry.subjectCode,
        effectiveFrom: calendarDate(entry.effectiveFrom),
        priceMinor: entry.priceMinor,
      });
    }
    return true;
  });

  return { read: rows.length, written: staged.length, problems: [], dryRun: false };
}

const LARDER_COLUMNS = ['code', 'name', 'store', 'unit', 'pack'] as const;

/**
 * Load the larder. The same rule applies, with one addition: an ingredient
 * already on file is reported rather than overwritten, because a purchase unit
 * that changes underneath a recipe silently rewrites every quantity that
 * recipe asks for.
 */
export function importLarder(
  db: Database,
  propertyCode: CatalogCode,
  text: string,
  now: string,
  options: ImportOptions = {},
): ImportReport {
  requireProperty(db, propertyCode);
  const rows = fromCsv(text);
  requireColumns(rows, LARDER_COLUMNS);

  const problems: ImportProblem[] = [];
  const staged: {
    code: string;
    name: string;
    store: string;
    purchaseUnit: string;
    packSize: number;
  }[] = [];
  const seen = new Set<string>();
  const onFile = new Set(
    db
      .prepare<[string], { code: string }>('select code from ingredient where property_code = ?')
      .all(propertyCode)
      .map((row) => row.code),
  );

  rows.forEach((row, index) => {
    const line = index + 2;
    const code = (row.code ?? '').trim().toUpperCase();
    const name = (row.name ?? '').trim();
    const store = (row.store ?? '').trim().toUpperCase();
    const unit = (row.unit ?? '').trim().toUpperCase();
    const pack = Number((row.pack ?? '').trim());

    if (code.length === 0 || name.length === 0) {
      problems.push({ line, message: 'an ingredient needs a code and a name' });
      return;
    }
    if (onFile.has(code)) {
      problems.push({ line, message: `${code} is already on file` });
      return;
    }
    if (seen.has(code)) {
      problems.push({ line, message: `${code} appears twice in this file` });
      return;
    }
    if (!Number.isFinite(pack) || pack <= 0) {
      problems.push({ line, message: `${row.pack ?? ''} is not a pack size` });
      return;
    }
    seen.add(code);
    staged.push({ code, name, store, purchaseUnit: unit, packSize: pack });
  });

  if (problems.length > 0 || options.dryRun === true) {
    return { read: rows.length, written: 0, problems, dryRun: options.dryRun === true };
  }

  inTransaction(db, (handle) => {
    for (const entry of staged) {
      createIngredient(handle, propertyCode, entry, now);
    }
    return true;
  });

  return { read: rows.length, written: staged.length, problems: [], dryRun: false };
}

export function renderImportReport(report: ImportReport): string {
  const lines: string[] = [];
  lines.push(
    report.dryRun
      ? `${report.read} row(s) read, nothing written`
      : `${report.read} row(s) read, ${report.written} written`,
  );
  if (report.problems.length > 0) {
    lines.push('');
    lines.push(`${report.problems.length} problem(s), so nothing was written:`);
    for (const problem of report.problems) {
      lines.push(`  line ${String(problem.line).padStart(4)}  ${problem.message}`);
    }
  }
  return lines.join('\n');
}
