/**
 * Comma separated output, for the accountant who wants it in a spreadsheet.
 *
 * Three things make this less trivial than joining strings with commas. A
 * value can contain a comma, a quote or a newline, and all three have to
 * survive the round trip. A spreadsheet treats a leading equals, plus, minus
 * or at sign as the start of a formula, so a room called "-ANNEX" becomes a
 * cell error or worse. And an empty column is not the same as a missing one,
 * because the header row decides the shape.
 *
 * The formula guard is the one worth spelling out. It prefixes a single quote
 * rather than stripping the character, because the value is data and a report
 * that quietly edits the data it prints is a report nobody can reconcile.
 */

import { invalidInput } from '../core/errors.js';

export type CsvCell = string | number | boolean | null | undefined;

export interface CsvOptions {
  /** Columns to write, in order. Defaults to the keys of the first row. */
  readonly columns?: readonly string[];
  /** Whether to write the header row at all. */
  readonly header?: boolean;
  /** Line ending. Excel on Windows wants the pair; everything else does not. */
  readonly newline?: '\n' | '\r\n';
}

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  const text = String(value);
  const guarded = FORMULA_START.test(text) ? `'${text}` : text;
  if (!NEEDS_QUOTING.test(guarded)) {
    return guarded;
  }
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly Record<string, CsvCell>[], options: CsvOptions = {}): string {
  const newline = options.newline ?? '\n';
  const columns = options.columns ?? Object.keys(rows[0] ?? {});
  if (columns.length === 0) {
    return '';
  }
  const lines: string[] = [];
  if (options.header !== false) {
    lines.push(columns.map((column) => csvCell(column)).join(','));
  }
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(','));
  }
  return lines.join(newline);
}

/**
 * Read a comma separated block back. Only used by the import side and by the
 * round trip test, which is the only honest way to know the writer is right.
 */
export function fromCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  const header = rows[0];
  if (header === undefined) {
    return [];
  }
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((name, index) => {
      record[name] = cells[index] ?? '';
    });
    return record;
  });
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let index = 0;

  const endCell = (): void => {
    cells.push(cell);
    cell = '';
  };
  const endRow = (): void => {
    endCell();
    rows.push(cells);
    cells = [];
  };

  while (index < text.length) {
    const char = text[index] ?? '';
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += char;
      index += 1;
      continue;
    }
    if (char === '"') {
      if (cell.length > 0) {
        throw invalidInput('csv.quote', 'a quote can only open at the start of a cell');
      }
      quoted = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      endCell();
      index += 1;
      continue;
    }
    if (char === '\r' && text[index + 1] === '\n') {
      endRow();
      index += 2;
      continue;
    }
    if (char === '\n') {
      endRow();
      index += 1;
      continue;
    }
    cell += char;
    index += 1;
  }

  if (quoted) {
    throw invalidInput('csv.quote', 'the last cell opens a quote that never closes');
  }
  if (cell.length > 0 || cells.length > 0) {
    endRow();
  }
  return rows;
}
