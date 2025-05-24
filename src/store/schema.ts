/**
 * Every migration this build carries, in the order they run.
 *
 * Nothing else imports the individual migration files. Adding one means
 * appending it here, and the runner refuses the list if the numbering is
 * wrong, so the mistake shows up in the first test that opens a store.
 */

import type { Migration } from './migrate.js';
import { migration001 } from './migrations/001-property-and-spaces.js';
import { migration002 } from './migrations/002-bookings-and-functions.js';
import { migration003 } from './migrations/003-catalog.js';
import { migration004 } from './migrations/004-covers.js';
import { migration005 } from './migrations/005-production.js';
import { migration006 } from './migrations/006-selections.js';
import { migration007 } from './migrations/007-labour.js';
import { migrate, schemaVersion, type MigrateResult } from './migrate.js';
import { openDatabase, type Database, type OpenDatabaseOptions } from './database.js';

export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
];

export const TARGET_SCHEMA_VERSION = MIGRATIONS.reduce(
  (highest, migration) => Math.max(highest, migration.id),
  0,
);

export function migrateToLatest(db: Database): MigrateResult {
  return migrate(db, MIGRATIONS);
}

/** Open a store and bring it to the version this build expects. */
export function openStore(path: string, options: OpenDatabaseOptions = {}): Database {
  const db = openDatabase(path, { createDirectory: true, ...options });
  if (options.readOnly !== true) {
    migrateToLatest(db);
  }
  return db;
}

export function storeVersion(db: Database): number {
  return schemaVersion(db);
}
