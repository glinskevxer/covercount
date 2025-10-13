/**
 * Taking a copy of the store, and reading one.
 *
 * SQLite's own backup API copies a live file consistently, which a filesystem
 * copy of a write ahead logged database does not. The reader that inspects a
 * backup opens it read only and never runs a migration, because a backup taken
 * from an older build is exactly the thing somebody wants to look inside, and
 * quietly upgrading it destroys the evidence.
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { conflict, invalidInput, notFound } from '../core/errors.js';
import {
  closeDatabase,
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
