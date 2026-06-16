import { scratchDirectory } from '../../support/store.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  IN_MEMORY,
  closeDatabase,
  foreignKeyCheck,
  inExclusiveTransaction,
  inTransaction,
  integrityCheck,
  openDatabase,
  openInMemory,
  tableExists,
  tableNames,
} from '../../../src/store/database.js';
import { DomainError, isDomainError } from '../../../src/core/errors.js';

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'covercount-'));
  scratchDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('opening a store', () => {
  it('opens in memory and reports no tables', () => {
    const db = openInMemory();
    expect(tableNames(db)).toEqual([]);
    closeDatabase(db);
    expect(db.open).toBe(false);
  });

  it('closes twice without complaint', () => {
    const db = openInMemory();
    closeDatabase(db);
    expect(() => closeDatabase(db)).not.toThrow();
  });

  it('turns foreign keys on', () => {
    const db = openInMemory();
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    closeDatabase(db);
  });

  it('refuses a blank path', () => {
    expect(() => openDatabase('   ')).toThrow(/cannot be blank/);
    expect(() => openDatabase('')).toThrow(DomainError);
  });

  it('creates the containing directory when asked', () => {
    const path = join(scratch(), 'nested', 'deeper', 'property.covercount.db');
    const db = openDatabase(path, { createDirectory: true });
    db.exec('create table t (a integer)');
    closeDatabase(db);
    const reader = openDatabase(path, { readOnly: true });
    expect(tableExists(reader, 't')).toBe(true);
    closeDatabase(reader);
  });

  it('refuses to open a store that is not there for reading', () => {
    const path = join(scratch(), 'missing.covercount.db');
    expect(() => openDatabase(path, { readOnly: true })).toThrow(/there is no store at/);
  });

  it('will not write through a read only handle', () => {
    const path = join(scratch(), 'property.covercount.db');
    const writer = openDatabase(path);
    writer.exec('create table t (a integer)');
    closeDatabase(writer);
    const reader = openDatabase(path, { readOnly: true });
    expect(() => reader.exec('insert into t (a) values (1)')).toThrow();
    closeDatabase(reader);
  });

  it('names the in memory path once', () => {
    expect(IN_MEMORY).toBe(':memory:');
  });
});

describe('transactions', () => {
  it('rolls the whole unit back on a throw', () => {
    const db = openInMemory();
    db.exec('create table booking (id text primary key)');
    expect(() =>
      inTransaction(db, (handle) => {
        handle.prepare('insert into booking (id) values (?)').run('BK-2025-0001');
        throw new Error('the client cancelled');
      }),
    ).toThrow('the client cancelled');
    expect(db.prepare('select count(*) as n from booking').get()).toEqual({ n: 0 });
    closeDatabase(db);
  });

  it('commits and hands the value back', () => {
    const db = openInMemory();
    db.exec('create table booking (id text primary key)');
    const result = inTransaction(db, (handle) => {
      handle.prepare('insert into booking (id) values (?)').run('BK-2025-0001');
      return 'done';
    });
    expect(result).toBe('done');
    expect(db.prepare('select count(*) as n from booking').get()).toEqual({ n: 1 });
    closeDatabase(db);
  });

  it('joins a transaction that is already open rather than nesting', () => {
    const db = openInMemory();
    db.exec('create table booking (id text primary key)');
    inTransaction(db, (outer) => {
      inTransaction(outer, (inner) => {
        inner.prepare('insert into booking (id) values (?)').run('BK-2025-0001');
      });
      expect(outer.inTransaction).toBe(true);
    });
    expect(db.prepare('select count(*) as n from booking').get()).toEqual({ n: 1 });
    closeDatabase(db);
  });

  it('takes an exclusive transaction the same way', () => {
    const db = openInMemory();
    db.exec('create table booking (id text primary key)');
    const result = inExclusiveTransaction(db, (handle) => {
      handle.prepare('insert into booking (id) values (?)').run('BK-2025-0002');
      return inExclusiveTransaction(handle, () => 'nested');
    });
    expect(result).toBe('nested');
    closeDatabase(db);
  });
});

describe('checking a store', () => {
  it('lists tables in name order and skips the sqlite ones', () => {
    const db = openInMemory();
    db.exec('create table zeta (a integer)');
    db.exec('create table alpha (a integer primary key autoincrement)');
    expect(tableNames(db)).toEqual(['alpha', 'zeta']);
    closeDatabase(db);
  });

  it('reports a broken reference', () => {
    const db = openInMemory();
    db.exec('create table parent (id integer primary key)');
    db.exec('create table child (id integer primary key, parent_id integer references parent(id))');
    db.pragma('foreign_keys = OFF');
    db.prepare('insert into child (id, parent_id) values (1, 99)').run();
    const problems = foreignKeyCheck(db);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('child');
    closeDatabase(db);
  });

  it('passes an integrity check on a healthy store', () => {
    const db = openInMemory();
    db.exec('create table t (a integer)');
    expect(() => integrityCheck(db)).not.toThrow();
    expect(foreignKeyCheck(db)).toEqual([]);
    closeDatabase(db);
  });
});

describe('a store that cannot be opened', () => {
  it('refuses rather than crashing, and says what to check', () => {
    // A path whose parent does not exist is the same class of failure as a
    // bind mount the process cannot write to: SQLite says only "unable to
    // open database file", and neither is a bug in this program.
    const nowhere = join(scratchDirectory(), 'no', 'such', 'place', 'property.covercount.db');
    let raised: unknown;
    try {
      openDatabase(nowhere);
    } catch (error) {
      raised = error;
    }
    expect(isDomainError(raised)).toBe(true);
    expect((raised as DomainError).code).toBe('store.unopenable');
    expect((raised as DomainError).kind).toBe('not-permitted');
    expect((raised as DomainError).message).toContain('can write to it');
  });

  it('still refuses a blank path for the reason it always did', () => {
    expect(() => openDatabase('   ')).toThrow(/cannot be blank/);
  });
});
