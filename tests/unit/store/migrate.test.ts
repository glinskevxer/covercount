import { describe, expect, it } from 'vitest';
import { closeDatabase, openInMemory, tableExists } from '../../../src/store/database.js';
import {
  appliedMigrations,
  isUpToDate,
  migrate,
  migrationChecksum,
  schemaVersion,
  type Migration,
} from '../../../src/store/migrate.js';
import { DomainError } from '../../../src/core/errors.js';

const first: Migration = {
  id: 1,
  name: 'properties and spaces',
  statements: ['create table property (code text primary key, name text not null)'],
};

const second: Migration = {
  id: 2,
  name: 'bookings',
  statements: [
    'create table booking (id text primary key, property_code text not null references property(code))',
    'create index booking_property on booking (property_code)',
  ],
};

describe('running migrations', () => {
  it('applies every step and records the version', () => {
    const db = openInMemory();
    const result = migrate(db, [first, second]);
    expect(result.applied).toEqual([1, 2]);
    expect(result.version).toBe(2);
    expect(tableExists(db, 'property')).toBe(true);
    expect(tableExists(db, 'booking')).toBe(true);
    closeDatabase(db);
  });

  it('is idempotent when run again', () => {
    const db = openInMemory();
    migrate(db, [first, second]);
    const again = migrate(db, [first, second]);
    expect(again.applied).toEqual([]);
    expect(again.version).toBe(2);
    closeDatabase(db);
  });

  it('applies only the steps that are new', () => {
    const db = openInMemory();
    migrate(db, [first]);
    const result = migrate(db, [first, second]);
    expect(result.applied).toEqual([2]);
    closeDatabase(db);
  });

  it('reports the version and the applied list', () => {
    const db = openInMemory();
    expect(schemaVersion(db)).toBe(0);
    migrate(db, [first, second]);
    expect(schemaVersion(db)).toBe(2);
    const applied = appliedMigrations(db);
    expect(applied.map((row) => row.id)).toEqual([1, 2]);
    expect(applied[0]?.name).toBe('properties and spaces');
    expect(applied[0]?.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    closeDatabase(db);
  });

  it('answers whether the store matches the build', () => {
    const db = openInMemory();
    migrate(db, [first]);
    expect(isUpToDate(db, [first])).toBe(true);
    expect(isUpToDate(db, [first, second])).toBe(false);
    closeDatabase(db);
  });
});

describe('refusing a migration set that would corrupt the store', () => {
  it('refuses two steps sharing an id', () => {
    const db = openInMemory();
    expect(() => migrate(db, [first, { ...second, id: 1 }])).toThrow(/two migrations share id 1/);
    closeDatabase(db);
  });

  it('refuses steps that are out of order', () => {
    const db = openInMemory();
    expect(() => migrate(db, [second, first])).toThrow(/must be in order/);
    closeDatabase(db);
  });

  it('refuses a non positive id and an empty step', () => {
    const db = openInMemory();
    expect(() => migrate(db, [{ ...first, id: 0 }])).toThrow(/not a positive integer/);
    expect(() => migrate(db, [{ ...first, statements: [] }])).toThrow(/carries no statements/);
    closeDatabase(db);
  });

  it('refuses to run against a store that is ahead of the code', () => {
    const db = openInMemory();
    migrate(db, [first, second]);
    expect(() => migrate(db, [first])).toThrow(/has migration 2 applied/);
    closeDatabase(db);
  });

  it('refuses a step whose body changed after it was applied', () => {
    const db = openInMemory();
    migrate(db, [first]);
    const edited: Migration = {
      ...first,
      statements: ['create table property (code text primary key, name text not null, note text)'],
    };
    expect(() => migrate(db, [edited])).toThrow(/has changed since it was applied/);
    closeDatabase(db);
  });

  it('leaves nothing behind when a step throws part way through', () => {
    const db = openInMemory();
    const broken: Migration = {
      id: 1,
      name: 'broken',
      statements: ['create table good (a integer)', 'create table bad (a integer) nonsense'],
    };
    expect(() => migrate(db, [broken])).toThrow();
    expect(tableExists(db, 'good')).toBe(false);
    expect(schemaVersion(db)).toBe(0);
    closeDatabase(db);
  });
});

describe('the checksum', () => {
  it('ignores whitespace so a reformat is not a change', () => {
    const spaced: Migration = {
      ...first,
      statements: ['create table property (\n  code text primary key,\n  name text not null\n)'],
    };
    expect(migrationChecksum(spaced)).toBe(migrationChecksum(first));
  });

  it('changes when the name or the body changes', () => {
    expect(migrationChecksum({ ...first, name: 'other' })).not.toBe(migrationChecksum(first));
    expect(migrationChecksum({ ...first, statements: ['create table x (a integer)'] })).not.toBe(
      migrationChecksum(first),
    );
  });

  it('is short enough to read in a log line', () => {
    expect(migrationChecksum(first)).toHaveLength(16);
  });

  it('raises a domain error rather than a bare one', () => {
    const db = openInMemory();
    try {
      migrate(db, [{ ...first, id: -1 }]);
      expect.unreachable('the migration set should have been refused');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
    }
    closeDatabase(db);
  });
});
