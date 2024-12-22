/**
 * Test fixtures build through the real store and the real writers. Nothing
 * here reaches past a public surface, so a fixture that stops compiling is a
 * signal about the surface rather than about the fixture.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, openInMemory, type Database } from '../../src/store/database.js';
import { migrateToLatest } from '../../src/store/schema.js';

const scratchDirs: string[] = [];

export function scratchDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), 'covercount-'));
  scratchDirs.push(dir);
  return dir;
}

export function scratchStorePath(name = 'property.covercount.db'): string {
  return join(scratchDirectory(), name);
}

export function cleanScratch(): void {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export function migratedStore(): Database {
  const db = openInMemory();
  migrateToLatest(db);
  return db;
}

export function withStore<T>(work: (db: Database) => T): T {
  const db = migratedStore();
  try {
    return work(db);
  } finally {
    closeDatabase(db);
  }
}
