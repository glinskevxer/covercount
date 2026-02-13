/**
 * Looking after the file.
 *
 * The store is one SQLite file somebody copies onto a memory stick at the end
 * of a season, so the questions that matter are whether it is intact, how big
 * it has got, and what is taking up the room.
 *
 * Compacting is the interesting one. Deleting a year of finished bookings does
 * not shrink the file: SQLite keeps the pages on a free list and reuses them.
 * That is the right behaviour for a database that keeps growing and the wrong
 * answer for a file somebody is about to copy, so the free page count is
 * reported on its own rather than folded into the size.
 */

import { statSync } from 'node:fs';
import { schemaVersion } from './migrate.js';
import { foreignKeyCheck, tableNames, type Database } from './database.js';

export interface PageStats {
  readonly pageSize: number;
  readonly pageCount: number;
  readonly freePages: number;
  readonly bytes: number;
  /** Bytes sitting on the free list, which a compact would hand back. */
  readonly reclaimable: number;
}

function pragmaNumber(db: Database, name: string): number {
  const row = db.prepare(`pragma ${name}`).get() as Record<string, unknown> | undefined;
  const value = row === undefined ? undefined : Object.values(row)[0];
  return typeof value === 'number' ? value : 0;
}

export function pageStats(db: Database): PageStats {
  const pageSize = pragmaNumber(db, 'page_size');
  const pageCount = pragmaNumber(db, 'page_count');
  const freePages = pragmaNumber(db, 'freelist_count');
  return {
    pageSize,
    pageCount,
    freePages,
    bytes: pageSize * pageCount,
    reclaimable: pageSize * freePages,
  };
}

export interface TableSize {
  readonly table: string;
  readonly rows: number;
}

/**
 * Row counts, biggest first. Read off the table list rather than a hardcoded
 * set, so a table added by a migration turns up here without anybody
 * remembering to add it.
 */
export function tableSizes(db: Database): TableSize[] {
  return tableNames(db)
    .map((table) => {
      const row = db.prepare(`select count(*) as rows from "${table}"`).get() as
        | { rows: number }
        | undefined;
      return { table, rows: row?.rows ?? 0 };
    })
    .sort((left, right) => right.rows - left.rows || left.table.localeCompare(right.table));
}

export interface HealthReport {
  readonly schemaVersion: number;
  readonly tables: number;
  readonly rows: number;
  readonly pages: PageStats;
  readonly referenceProblems: string[];
  readonly integrity: string;
  readonly biggest: TableSize[];
}

export function health(db: Database): HealthReport {
  const sizes = tableSizes(db);
  const rows = db.prepare('pragma integrity_check').all() as { integrity_check?: string }[];
  const first = rows[0]?.integrity_check ?? 'unknown';
  return {
    schemaVersion: schemaVersion(db),
    tables: sizes.length,
    rows: sizes.reduce((total, size) => total + size.rows, 0),
    pages: pageStats(db),
    referenceProblems: foreignKeyCheck(db),
    integrity: first,
    biggest: sizes.slice(0, 10),
  };
}

export function isHealthy(report: HealthReport): boolean {
  return report.integrity === 'ok' && report.referenceProblems.length === 0;
}

export interface CompactResult {
  readonly before: PageStats;
  readonly after: PageStats;
  readonly bytesFreed: number;
}

/**
 * Hand the free pages back to the filesystem.
 *
 * A vacuum rewrites the whole file, so it takes a write lock and it needs room
 * for a second copy while it runs. Neither of those is a reason not to do it,
 * and both are reasons not to do it automatically, which is why nothing calls
 * this on a schedule.
 */
export function compact(db: Database): CompactResult {
  const before = pageStats(db);
  db.exec('vacuum');
  const after = pageStats(db);
  return { before, after, bytesFreed: Math.max(before.bytes - after.bytes, 0) };
}

/** Refresh the statistics the query planner reads. Cheap, and worth doing. */
export function analyse(db: Database): number {
  db.exec('analyze');
  const row = db
    .prepare("select count(*) as rows from sqlite_master where name = 'sqlite_stat1'")
    .get() as { rows: number } | undefined;
  return row?.rows ?? 0;
}

/** What the file actually takes up on disk, which is not the page count. */
export function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
