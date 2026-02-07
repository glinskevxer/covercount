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
import { migration008 } from './migrations/008-charges.js';
import { migration009 } from './migrations/009-orders.js';
import { migration010 } from './migrations/010-timeline.js';
import { migration011 } from './migrations/011-equipment.js';
import { migration012 } from './migrations/012-deposits.js';
import { migration013 } from './migrations/013-bar.js';
import { migration014 } from './migrations/014-production-factor.js';
import { migration015 } from './migrations/015-revenue-minimum.js';
import { migration016 } from './migrations/016-distribution.js';
import { migration017 } from './migrations/017-cancellation.js';
import { migration018 } from './migrations/018-stock.js';
import { migration019 } from './migrations/019-ingredient-cost.js';
import { migration020 } from './migrations/020-production-actual.js';
import { migration021 } from './migrations/021-credit-terms.js';
import { migration022 } from './migrations/022-space-hold.js';
import { migration023 } from './migrations/023-turn-standard.js';
import { migration024 } from './migrations/024-commission.js';
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
  migration008,
  migration009,
  migration010,
  migration011,
  migration012,
  migration013,
  migration014,
  migration015,
  migration016,
  migration017,
  migration018,
  migration019,
  migration020,
  migration021,
  migration022,
  migration023,
  migration024,
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
