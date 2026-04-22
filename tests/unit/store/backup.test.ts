import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanScratch, scratchDirectory, scratchStorePath } from '../../support/store.js';
import { closeDatabase, openDatabase } from '../../../src/store/database.js';
import { TARGET_SCHEMA_VERSION, migrateToLatest, openStore } from '../../../src/store/schema.js';
import {
  backupIsCurrent,
  backupTo,
  checkRestore,
  readBackup,
  restoreFrom,
} from '../../../src/store/backup.js';
import { createProperty } from '../../../src/property/store.js';
import { FIXED_NOW } from '../../support/fixtures.js';

afterEach(cleanScratch);

function liveStore() {
  const path = scratchStorePath();
  const db = openStore(path);
  createProperty(
    db,
    {
      code: 'CANYON',
      name: 'Canyon Ridge Hotel',
      timeZone: 'America/Denver',
      currency: 'USD',
      guaranteeLeadDays: 3,
      guaranteeDueMinute: 720,
      oversetPpm: 50_000,
      oversetCap: 25,
    },
    FIXED_NOW,
  );
  return { path, db };
}

describe('taking a backup', () => {
  it('copies the store and reports what it copied', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.covercount.db');
    const result = await backupTo(db, target);
    expect(existsSync(target)).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.version).toBe(TARGET_SCHEMA_VERSION);
    expect(result.tables).toBeGreaterThan(20);
    closeDatabase(db);
  });

  it('creates the directory it is asked to write into', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'nested', 'deeper', 'backup.db');
    await backupTo(db, target);
    expect(existsSync(target)).toBe(true);
    closeDatabase(db);
  });

  it('never overwrites', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.db');
    await backupTo(db, target);
    await expect(backupTo(db, target)).rejects.toThrow(/never overwrites/);
    closeDatabase(db);
  });

  it('refuses a blank path', async () => {
    const { db } = liveStore();
    await expect(backupTo(db, '   ')).rejects.toThrow(/cannot be blank/);
    closeDatabase(db);
  });

  it('copies what was written, not what was there when the file was made', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.db');
    await backupTo(db, target);
    const reader = openDatabase(target, { readOnly: true });
    const row = reader.prepare<[], { code: string }>('select code from property limit 1').get();
    expect(row?.code).toBe('CANYON');
    closeDatabase(reader);
    closeDatabase(db);
  });
});

describe('reading a backup', () => {
  it('reports the version and what is in it without migrating', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.db');
    await backupTo(db, target);
    closeDatabase(db);

    const summary = readBackup(target);
    expect(summary.version).toBe(TARGET_SCHEMA_VERSION);
    expect(summary.behindBy).toBe(0);
    expect(summary.tables).toContain('property');
    expect(summary.migrations).toHaveLength(TARGET_SCHEMA_VERSION);
    expect(summary.migrations[0]?.name).toBe('property and spaces');
    expect(backupIsCurrent(target)).toBe(true);
  });

  it('leaves an older backup at the version it was taken at', () => {
    const path = scratchStorePath('old.covercount.db');
    const db = openDatabase(path, { createDirectory: true });
    db.exec(
      'create table schema_migration (id integer primary key, name text not null, checksum text not null, applied_at text not null)',
    );
    db.prepare('insert into schema_migration values (1, ?, ?, ?)').run(
      'property and spaces',
      'x',
      'then',
    );
    closeDatabase(db);

    const summary = readBackup(path);
    expect(summary.version).toBe(1);
    expect(summary.behindBy).toBe(TARGET_SCHEMA_VERSION - 1);
    expect(backupIsCurrent(path)).toBe(false);
    expect(readBackup(path).version).toBe(1);
  });

  it('refuses a backup that is not there', () => {
    expect(() => readBackup(join(scratchDirectory(), 'nothing.db'))).toThrow(
      /there is no backup at/,
    );
  });
});

describe('checking a backup before putting it back', () => {
  it('says a fresh backup is fit to restore', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.covercount.db');
    await backupTo(db, target);
    closeDatabase(db);

    const check = checkRestore(target);
    expect(check.ok).toBe(true);
    expect(check.integrity).toBe('ok');
    expect(check.referenceProblems).toEqual([]);
    expect(check.behindBy).toBe(0);
    expect(check.properties).toEqual(['CANYON']);
    expect(check.rows).toBeGreaterThan(0);
  });

  it('says so when there is nothing there', () => {
    expect(() => checkRestore(join(scratchDirectory(), 'nothing.db'))).toThrow(/no backup at/);
  });
});

describe('putting a backup back', () => {
  it('writes it where it is told and reports the size', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.covercount.db');
    await backupTo(db, target);
    closeDatabase(db);

    const destination = join(scratchDirectory(), 'restored.covercount.db');
    const result = restoreFrom(target, destination, migrateToLatest);
    expect(existsSync(destination)).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.migrated).toBe(false);
    expect(result.version).toBe(TARGET_SCHEMA_VERSION);
    expect(readBackup(destination).tables.length).toBeGreaterThan(20);
  });

  it('refuses to write over a store unless it is told plainly', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.covercount.db');
    await backupTo(db, target);
    closeDatabase(db);

    const destination = scratchStorePath();
    closeDatabase(openStore(destination));
    expect(() => restoreFrom(target, destination, migrateToLatest)).toThrow(
      /already holds a store/,
    );
    expect(restoreFrom(target, destination, migrateToLatest, { overwrite: true }).to).toBe(
      destination,
    );
  });

  it('refuses a destination that is not one', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.covercount.db');
    await backupTo(db, target);
    closeDatabase(db);
    expect(() => restoreFrom(target, '   ', migrateToLatest)).toThrow(/somewhere to go/);
  });

  it('leaves the schema alone unless it is asked to migrate', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.covercount.db');
    await backupTo(db, target);
    closeDatabase(db);

    const destination = join(scratchDirectory(), 'restored.covercount.db');
    const migrated = restoreFrom(target, destination, migrateToLatest, { migrate: true });
    expect(migrated.migrated).toBe(true);
    expect(migrated.version).toBe(TARGET_SCHEMA_VERSION);
  });

  it('refuses a file that will not stand up to a look', async () => {
    const { db } = liveStore();
    const target = join(scratchDirectory(), 'backup.covercount.db');
    await backupTo(db, target);
    closeDatabase(db);

    // A store with a dangling reference in it is not fit to put back, however
    // cleanly it opens.
    const wounded = openDatabase(target);
    wounded.pragma('foreign_keys = OFF');
    wounded.prepare("delete from property where code = 'CANYON'").run();
    wounded
      .prepare(
        `insert into booking (id, property_code, account_code, post_as, sales_manager, status,
           arrival_date, departure_date, created_at, updated_at, closed_at, cancel_reason)
         values ('BK-2025-0001', 'CANYON', null, 'Orphan', 'nobody', 'INQUIRY',
           '2025-04-17', '2025-04-19', ?, ?, null, null)`,
      )
      .run(FIXED_NOW, FIXED_NOW);
    closeDatabase(wounded);

    const check = checkRestore(target);
    expect(check.ok).toBe(false);
    expect(check.referenceProblems.length).toBeGreaterThan(0);
    expect(() => restoreFrom(target, join(scratchDirectory(), 'no.db'), migrateToLatest)).toThrow(
      /not fit to restore/,
    );
  });
});
