import { afterEach, describe, expect, it } from 'vitest';
import {
  MIGRATIONS,
  TARGET_SCHEMA_VERSION,
  migrateToLatest,
  openStore,
  storeVersion,
} from '../../../src/store/schema.js';
import { closeDatabase, openInMemory, tableNames } from '../../../src/store/database.js';
import { migrationChecksum } from '../../../src/store/migrate.js';
import { cleanScratch, scratchStorePath, withStore } from '../../support/store.js';

afterEach(cleanScratch);

describe('the migration list', () => {
  it('is numbered from one with no gaps', () => {
    MIGRATIONS.forEach((migration, index) => {
      expect(migration.id).toBe(index + 1);
    });
  });

  it('names the version the build expects', () => {
    expect(TARGET_SCHEMA_VERSION).toBe(MIGRATIONS.length);
    expect(TARGET_SCHEMA_VERSION).toBeGreaterThan(0);
  });

  it('gives every step a distinct name and checksum', () => {
    const names = MIGRATIONS.map((migration) => migration.name);
    const sums = MIGRATIONS.map((migration) => migrationChecksum(migration));
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(sums).size).toBe(sums.length);
  });
});

describe('a migrated store', () => {
  it('carries every table the build needs', () => {
    withStore((db) => {
      expect(tableNames(db)).toEqual([
        'account',
        'booking',
        'booking_event',
        'cover_movement',
        'function_cover',
        'function_slot',
        'function_space',
        'house_calendar',
        'id_sequence',
        'menu_item',
        'menu_item_allergen',
        'menu_item_diet',
        'menu_package',
        'package_course',
        'package_course_item',
        'price_book',
        'price_line',
        'property',
        'schema_migration',
        'space_capacity',
        'space_component',
        'special_meal',
      ]);
    });
  });

  it('reports the version it reached', () => {
    withStore((db) => {
      expect(storeVersion(db)).toBe(TARGET_SCHEMA_VERSION);
    });
  });

  it('is idempotent when migrated twice', () => {
    const db = openInMemory();
    migrateToLatest(db);
    expect(migrateToLatest(db).applied).toEqual([]);
    closeDatabase(db);
  });
});

describe('openStore', () => {
  it('creates the file, the directory and the schema', () => {
    const path = scratchStorePath();
    const db = openStore(path);
    expect(storeVersion(db)).toBe(TARGET_SCHEMA_VERSION);
    closeDatabase(db);

    const reader = openStore(path, { readOnly: true });
    expect(storeVersion(reader)).toBe(TARGET_SCHEMA_VERSION);
    closeDatabase(reader);
  });

  it('does not migrate through a read only handle', () => {
    const path = scratchStorePath();
    closeDatabase(openStore(path));
    const reader = openStore(path, { readOnly: true });
    expect(() => reader.exec('create table t (a integer)')).toThrow();
    closeDatabase(reader);
  });
});

describe('the property schema', () => {
  it('holds a property and cascades its rooms away with it', () => {
    withStore((db) => {
      db.prepare(
        `insert into property (code, name, time_zone, currency, guarantee_lead_days,
          guarantee_due_minute, overset_ppm, overset_cap, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run('CANYON', 'Canyon Ridge Hotel', 'America/Denver', 'USD', 3, 720, 50000, 25, 'now');

      db.prepare(
        `insert into function_space (property_code, code, name, area_sq_ft, fire_capacity,
          setup_minutes, teardown_minutes)
         values (?, ?, ?, ?, ?, ?, ?)`,
      ).run('CANYON', 'GRAND', 'Grand Ballroom', 6400, 700, 180, 90);

      db.prepare(
        'insert into space_capacity (property_code, space_code, setup_style, capacity) values (?, ?, ?, ?)',
      ).run('CANYON', 'GRAND', 'ROUNDS-10', 400);

      db.prepare('delete from property where code = ?').run('CANYON');
      expect(db.prepare('select count(*) as n from function_space').get()).toEqual({ n: 0 });
      expect(db.prepare('select count(*) as n from space_capacity').get()).toEqual({ n: 0 });
    });
  });

  it('refuses a room in a property that is not there', () => {
    withStore((db) => {
      expect(() =>
        db
          .prepare(
            `insert into function_space (property_code, code, name, area_sq_ft, fire_capacity,
              setup_minutes, teardown_minutes)
             values (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run('NOWHERE', 'GRAND', 'Grand Ballroom', 6400, 700, 180, 90),
      ).toThrow(/FOREIGN KEY/);
    });
  });
});
