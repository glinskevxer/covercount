/**
 * How the command line prints.
 *
 * Four renderings of the same value: a fixed width table for a person, JSON
 * for anything downstream, tab separated for a shell pipeline, and comma
 * separated for the accountant's spreadsheet. Every command builds a plain
 * object or a list of them and hands it here, so no command has to know which
 * the caller asked for and no command formats a number twice.
 */

import { toCsv } from '../reports/csv.js';

export type Cell = string | number | boolean | null | undefined;

export type Row = Record<string, Cell>;

export interface Column {
  readonly key: string;
  readonly label?: string;
  readonly align?: 'left' | 'right';
}

/**
 * A column list from a short spec.
 *
 * Twenty five commands were each spelling out an array of objects to say that
 * three columns exist and two of them are numbers. Written out, the shape of
 * the table is buried in punctuation; written as a spec it is one line and the
 * table reads the way it prints.
 *
 * A trailing '>' right aligns, which is what every count and every amount
 * wants. A ':' names a heading that differs from the key.
 */
export function columns(...spec: readonly string[]): Column[] {
  return spec.map((entry) => {
    const right = entry.endsWith('>');
    const body = right ? entry.slice(0, -1) : entry;
    const [key = '', label] = body.split(':');
    return {
      key,
      ...(label === undefined ? {} : { label }),
      ...(right ? { align: 'right' as const } : {}),
    };
  });
}

export type OutputFormat = 'table' | 'json' | 'plain' | 'csv';

export const OUTPUT_FORMATS: readonly OutputFormat[] = ['table', 'json', 'plain', 'csv'];

export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

export function renderCell(value: Cell): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  return String(value);
}

function columnsFor(rows: readonly Row[], columns?: readonly Column[]): Column[] {
  if (columns !== undefined) {
    return [...columns];
  }
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  return keys.map((key) => ({ key }));
}

export function renderTable(rows: readonly Row[], columns?: readonly Column[]): string {
  const resolved = columnsFor(rows, columns);
  if (resolved.length === 0) {
    return '';
  }
  const headers = resolved.map((column) => column.label ?? column.key);
  const body = rows.map((row) => resolved.map((column) => renderCell(row[column.key])));
  const widths = headers.map((header, index) =>
    body.reduce((widest, cells) => Math.max(widest, (cells[index] ?? '').length), header.length),
  );

  const lines: string[] = [];
  lines.push(
    headers
      .map((header, index) => pad(header, widths[index] ?? 0, resolved[index]?.align ?? 'left'))
      .join('  ')
      .trimEnd(),
  );
  lines.push(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const cells of body) {
    lines.push(
      cells
        .map((cell, index) => pad(cell, widths[index] ?? 0, resolved[index]?.align ?? 'left'))
        .join('  ')
        .trimEnd(),
    );
  }
  return lines.join('\n');
}

function pad(value: string, width: number, align: 'left' | 'right'): string {
  return align === 'right' ? value.padStart(width) : value.padEnd(width);
}

export function renderPlain(rows: readonly Row[], columns?: readonly Column[]): string {
  const resolved = columnsFor(rows, columns);
  return rows
    .map((row) => resolved.map((column) => renderCell(row[column.key])).join('\t'))
    .join('\n');
}

/**
 * Comma separated, with the header taken from the column list so a caller that
 * named its columns gets them in that order and nothing it did not ask for.
 */
export function renderCsv(rows: readonly Row[], columns?: readonly Column[]): string {
  const resolved = columnsFor(rows, columns);
  return toCsv(
    rows.map((row) => {
      const out: Record<string, Cell> = {};
      for (const column of resolved) {
        out[column.label ?? column.key] = row[column.key];
      }
      return out;
    }),
    { columns: resolved.map((column) => column.label ?? column.key) },
  );
}

export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export interface RenderOptions {
  readonly format: OutputFormat;
  readonly columns?: readonly Column[];
  /** What to print when there are no rows at all. */
  readonly empty?: string;
}

export function render(rows: readonly Row[], options: RenderOptions): string {
  if (options.format === 'json') {
    return renderJson(rows);
  }
  if (options.format === 'csv') {
    // A header with no rows under it is still the answer: the spreadsheet
    // wants the shape even on a quiet day.
    return renderCsv(rows, options.columns);
  }
  if (rows.length === 0) {
    return options.empty ?? 'nothing to show';
  }
  return options.format === 'plain'
    ? renderPlain(rows, options.columns)
    : renderTable(rows, options.columns);
}

/** A single record, printed as a label and value list rather than a table. */
export function renderRecord(row: Row, options: { format: OutputFormat }): string {
  if (options.format === 'json') {
    return renderJson(row);
  }
  if (options.format === 'csv') {
    return renderCsv([row]);
  }
  const keys = Object.keys(row);
  const width = keys.reduce((widest, key) => Math.max(widest, key.length), 0);
  return keys.map((key) => `${key.padEnd(width)}  ${renderCell(row[key])}`).join('\n');
}
