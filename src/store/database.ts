/**
 * The store handle.
 *
 * One SQLite file per property. It sits on a shared drive in the back office,
 * so foreign keys are on, the journal is write ahead, and a busy timeout
 * covers the banquet manager opening the production sheet while the sales
 * office is writing a change order.
 */

import BetterSqlite3 from 'better-sqlite3';
import { dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { conflict, invalidInput } from '../core/errors.js';

export type Database = BetterSqlite3.Database;

export interface OpenDatabaseOptions {
  /** Open without taking a write lock. A reader must not create the file. */
  readonly readOnly?: boolean;
  /** Create the containing directory if it is missing. */
  readonly createDirectory?: boolean;
  /** Milliseconds to wait behind another writer. */
  readonly busyTimeoutMs?: number;
}

export const IN_MEMORY = ':memory:';

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): Database {
  if (path.trim().length === 0) {
    throw invalidInput('store.path', 'a store path cannot be blank');
  }
  const inMemory = path === IN_MEMORY;
  if (!inMemory && options.readOnly === true && !existsSync(path)) {
    throw invalidInput('store.missing', `there is no store at ${path}`);
  }
  if (!inMemory && options.createDirectory === true) {
    const parent = dirname(path);
    if (!existsSync(parent)) {
      mkdirSync(parent, { recursive: true });
    }
  }

  const db = new BetterSqlite3(path, {
    readonly: options.readOnly === true,
    fileMustExist: options.readOnly === true && !inMemory,
  });

  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
  db.pragma('foreign_keys = ON');
  if (options.readOnly !== true) {
    if (!inMemory) {
      db.pragma('journal_mode = WAL');
    }
    db.pragma('synchronous = NORMAL');
  }
  return db;
}

export function openInMemory(): Database {
  return openDatabase(IN_MEMORY);
}

export function closeDatabase(db: Database): void {
  if (db.open) {
    db.close();
  }
}

/**
 * Run a unit of work in a transaction. better-sqlite3 transactions are
 * synchronous, which is the whole reason this system is synchronous.
 */
export function inTransaction<T>(db: Database, work: (db: Database) => T): T {
  if (db.inTransaction) {
    return work(db);
  }
  const wrapped = db.transaction(work);
  return wrapped(db);
}

/** Take an exclusive transaction, for the sequence allocation and migrations. */
export function inExclusiveTransaction<T>(db: Database, work: (db: Database) => T): T {
  if (db.inTransaction) {
    return work(db);
  }
  const wrapped = db.transaction(work);
  return wrapped.exclusive(db);
}

export function tableExists(db: Database, name: string): boolean {
  const row = db
    .prepare<
      [string],
      { name: string }
    >("select name from sqlite_master where type = 'table' and name = ?")
    .get(name);
  return row !== undefined;
}

export function tableNames(db: Database): string[] {
  return db
    .prepare<[], { name: string }>(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
    )
    .all()
    .map((row) => row.name);
}

export function foreignKeyCheck(db: Database): string[] {
  const rows = db.prepare<[], { table: string; rowid: number; parent: string }>(
    'pragma foreign_key_check',
  );
  return rows.all().map((row) => `${row.table} row ${row.rowid} does not match ${row.parent}`);
}

export function integrityCheck(db: Database): void {
  const rows = db.prepare<[], { integrity_check: string }>('pragma integrity_check').all();
  const problems = rows.map((row) => row.integrity_check).filter((line) => line !== 'ok');
  if (problems.length > 0) {
    throw conflict('store.corrupt', `the store failed its integrity check: ${problems.join('; ')}`);
  }
}
