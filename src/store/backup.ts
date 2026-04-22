/**
 * Taking a copy of the store, and reading one.
 *
 * SQLite's own backup API copies a live file consistently, which a filesystem
 * copy of a write ahead logged database does not. The reader that inspects a
 * backup opens it read only and never runs a migration, because a backup taken
 * from an older build is exactly the thing somebody wants to look inside, and
 * quietly upgrading it destroys the evidence.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { conflict, invalidInput, notFound } from '../core/errors.js';
import {
  closeDatabase,
  foreignKeyCheck,
  integrityCheck,
  openDatabase,
  tableNames,
  type Database,
} from './database.js';
import { appliedMigrations, schemaVersion } from './migrate.js';
import { TARGET_SCHEMA_VERSION } from './schema.js';

export interface BackupResult {
  readonly path: string;
  readonly bytes: number;
  readonly version: number;
  readonly tables: number;
}

export async function backupTo(db: Database, path: string): Promise<BackupResult> {
  if (path.trim().length === 0) {
    throw invalidInput('backup.path', 'a backup path cannot be blank');
  }
  if (existsSync(path)) {
    throw conflict('backup.exists', `${path} is already there, and a backup never overwrites`);
  }
  const parent = dirname(path);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }

  await db.backup(path);

  const reader = openDatabase(path, { readOnly: true });
  try {
    integrityCheck(reader);
    return {
      path,
      bytes: statSync(path).size,
      version: schemaVersion(reader),
      tables: tableNames(reader).length,
    };
  } finally {
    closeDatabase(reader);
  }
}

export interface BackupSummary {
  readonly path: string;
  readonly bytes: number;
  readonly version: number;
  readonly behindBy: number;
  readonly tables: string[];
  readonly migrations: { id: number; name: string; appliedAt: string }[];
}

/**
 * Look inside a backup without touching it. Deliberately does not use the
 * store opener, because that migrates, and migrating a backup is how an
 * investigation turns into an incident.
 */
export function readBackup(path: string): BackupSummary {
  if (!existsSync(path)) {
    throw notFound('backup.missing', path, `there is no backup at ${path}`);
  }
  const reader = openDatabase(path, { readOnly: true });
  try {
    const version = schemaVersion(reader);
    return {
      path,
      bytes: statSync(path).size,
      version,
      behindBy: TARGET_SCHEMA_VERSION - version,
      tables: tableNames(reader),
      migrations: appliedMigrations(reader).map((row) => ({
        id: row.id,
        name: row.name,
        appliedAt: row.appliedAt,
      })),
    };
  } finally {
    closeDatabase(reader);
  }
}

/** Whether a backup can be opened by this build without a migration. */
export function backupIsCurrent(path: string): boolean {
  return readBackup(path).behindBy === 0;
}

export interface RestoreCheck {
  readonly path: string;
  readonly version: number;
  readonly behindBy: number;
  readonly integrity: string;
  readonly referenceProblems: string[];
  readonly rows: number;
  readonly properties: string[];
  readonly ok: boolean;
}

/**
 * Everything worth knowing before a backup is put back.
 *
 * A backup that opens is not a backup that is usable. It can be behind the
 * build, it can have a reference the schema no longer allows, and it can be a
 * file somebody copied halfway. All three look identical from the outside, so
 * all three are checked here and none of them stops the read: the caller gets
 * the whole picture and decides.
 */
export function checkRestore(path: string): RestoreCheck {
  if (!existsSync(path)) {
    throw notFound('backup.missing', path, `there is no backup at ${path}`);
  }
  const reader = openDatabase(path, { readOnly: true });
  try {
    const version = schemaVersion(reader);
    const integrity =
      (reader.prepare('pragma integrity_check').get() as { integrity_check?: string } | undefined)
        ?.integrity_check ?? 'unknown';
    const referenceProblems = foreignKeyCheck(reader);
    let rows = 0;
    for (const table of tableNames(reader)) {
      const row = reader.prepare(`select count(*) as rows from "${table}"`).get() as
        | { rows: number }
        | undefined;
      rows += row?.rows ?? 0;
    }
    const properties = reader
      .prepare<[], { code: string }>('select code from property order by code')
      .all()
      .map((each) => each.code);
    return {
      path,
      version,
      behindBy: TARGET_SCHEMA_VERSION - version,
      integrity,
      referenceProblems,
      rows,
      properties,
      ok: integrity === 'ok' && referenceProblems.length === 0 && version <= TARGET_SCHEMA_VERSION,
    };
  } finally {
    closeDatabase(reader);
  }
}

export interface RestoreResult {
  readonly from: string;
  readonly to: string;
  readonly bytes: number;
  readonly version: number;
  readonly migrated: boolean;
}

export interface RestoreOptions {
  /** Bring the restored file up to this build. Off by default. */
  readonly migrate?: boolean;
  /** Write over a store that is already there. Off by default, deliberately. */
  readonly overwrite?: boolean;
}

/**
 * Put a backup back.
 *
 * The default refuses to write over an existing store, because the moment
 * somebody reaches for a restore is exactly the moment they are least likely
 * to have checked what is at the destination. Migrating is off by default for
 * the same reason as reading: a restore that silently upgrades has destroyed
 * the state somebody was restoring in order to look at.
 */
export function restoreFrom(
  path: string,
  destination: string,
  migrateUp: (db: Database) => unknown,
  options: RestoreOptions = {},
): RestoreResult {
  const check = checkRestore(path);
  if (!check.ok) {
    throw conflict(
      'backup.unusable',
      `${path} is not fit to restore: integrity ${check.integrity}, ${check.referenceProblems.length} reference problem(s), ${check.behindBy < 0 ? 'newer than this build' : 'schema ' + String(check.version)}`,
      path,
    );
  }
  if (destination.trim().length === 0) {
    throw invalidInput('backup.destination', 'a restore needs somewhere to go');
  }
  if (existsSync(destination) && options.overwrite !== true) {
    throw conflict(
      'backup.occupied',
      `${destination} already holds a store, so say so plainly before writing over it`,
      destination,
    );
  }

  const parent = dirname(destination);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  copyFileSync(path, destination);

  let version = check.version;
  if (options.migrate === true) {
    const db = openDatabase(destination);
    try {
      migrateUp(db);
      version = schemaVersion(db);
    } finally {
      closeDatabase(db);
    }
  }

  return {
    from: path,
    to: destination,
    bytes: statSync(destination).size,
    version,
    migrated: options.migrate === true,
  };
}
