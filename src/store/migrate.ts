/**
 * Migrations.
 *
 * A property's store outlives any one release, so every schema change is a
 * numbered step that runs once and is recorded. The runner refuses to apply a
 * step out of order, refuses to run at all against a store that is ahead of
 * the code, and puts each step in its own transaction so a half applied
 * migration is not a state the file can be left in.
 */

import { createHash } from 'node:crypto';
import { conflict, invalidInput } from '../core/errors.js';
import { inExclusiveTransaction, type Database } from './database.js';

export interface Migration {
  readonly id: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export interface AppliedMigration {
  readonly id: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

const LEDGER = `
  create table if not exists schema_migration (
    id integer primary key,
    name text not null,
    checksum text not null,
    applied_at text not null
  )
`;

/** Reformatting a statement is not a change to it, so the checksum ignores layout. */
function normaliseStatement(statement: string): string {
  return statement
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .trim();
}

export function migrationChecksum(migration: Migration): string {
  const hash = createHash('sha256');
  hash.update(`${migration.id}:${migration.name}`);
  for (const statement of migration.statements) {
    hash.update(' ');
    hash.update(normaliseStatement(statement));
  }
  return hash.digest('hex').slice(0, 16);
}

function ensureLedger(db: Database): void {
  db.exec(LEDGER);
}

export function appliedMigrations(db: Database): AppliedMigration[] {
  ensureLedger(db);
  return db
    .prepare<[], { id: number; name: string; checksum: string; applied_at: string }>(
      'select id, name, checksum, applied_at from schema_migration order by id',
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      checksum: row.checksum,
      appliedAt: row.applied_at,
    }));
}

export function schemaVersion(db: Database): number {
  const applied = appliedMigrations(db);
  return applied.length === 0 ? 0 : (applied[applied.length - 1]?.id ?? 0);
}

function assertWellFormed(migrations: readonly Migration[]): void {
  const seen = new Set<number>();
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.id) || migration.id < 1) {
      throw invalidInput('migrate.id', `migration id ${migration.id} is not a positive integer`);
    }
    if (seen.has(migration.id)) {
      throw invalidInput('migrate.duplicate', `two migrations share id ${migration.id}`);
    }
    if (migration.id <= previous) {
      throw invalidInput(
        'migrate.order',
        `migration ${migration.id} is listed after ${previous}, they must be in order`,
      );
    }
    if (migration.statements.length === 0) {
      throw invalidInput('migrate.empty', `migration ${migration.id} carries no statements`);
    }
    seen.add(migration.id);
    previous = migration.id;
  }
}

export interface MigrateResult {
  readonly applied: number[];
  readonly version: number;
}

export function migrate(db: Database, migrations: readonly Migration[]): MigrateResult {
  assertWellFormed(migrations);
  ensureLedger(db);

  const already = new Map(appliedMigrations(db).map((row) => [row.id, row]));
  const known = new Set(migrations.map((migration) => migration.id));
  for (const id of already.keys()) {
    if (!known.has(id)) {
      throw conflict(
        'migrate.ahead',
        `the store has migration ${id} applied and this build does not carry it`,
      );
    }
  }

  const applied: number[] = [];
  for (const migration of migrations) {
    const checksum = migrationChecksum(migration);
    const record = already.get(migration.id);
    if (record !== undefined) {
      if (record.checksum !== checksum) {
        throw conflict(
          'migrate.changed',
          `migration ${migration.id} ${migration.name} has changed since it was applied`,
        );
      }
      continue;
    }
    inExclusiveTransaction(db, (handle) => {
      for (const statement of migration.statements) {
        handle.exec(statement);
      }
      handle
        .prepare(
          'insert into schema_migration (id, name, checksum, applied_at) values (?, ?, ?, ?)',
        )
        .run(migration.id, migration.name, checksum, new Date().toISOString());
    });
    applied.push(migration.id);
  }

  return { applied, version: schemaVersion(db) };
}

/** Answer whether the store is at the version this build expects. */
export function isUpToDate(db: Database, migrations: readonly Migration[]): boolean {
  const target = migrations.reduce((highest, migration) => Math.max(highest, migration.id), 0);
  return schemaVersion(db) === target;
}
