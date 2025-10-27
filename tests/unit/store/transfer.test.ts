import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW } from '../../support/fixtures.js';
import { SETUP_TABLES, countRows, exportSetup, importSetup } from '../../../src/store/transfer.js';
import { seedDemoProperty } from '../../../src/demo/property.js';
import { listSpaces, requireProperty } from '../../../src/property/store.js';
import { listItems } from '../../../src/catalog/items.js';
import { listRecipes } from '../../../src/production/recipes.js';
import { catalogCode } from '../../../src/core/ids.js';
import { TARGET_SCHEMA_VERSION } from '../../../src/store/schema.js';
import { openInMemory } from '../../../src/store/database.js';
import { migrateToLatest } from '../../../src/store/schema.js';

describe('exporting a setup', () => {
  it('carries every setup table and none of the business', () => {
    withStore((db) => {
      seedDemoProperty(db, FIXED_NOW);
      const payload = exportSetup(db, CANYON, FIXED_NOW);
      expect(payload.format).toBe('covercount-setup');
      expect(payload.version).toBe(TARGET_SCHEMA_VERSION);
      expect(payload.propertyCode).toBe('CANYON');
      expect(Object.keys(payload.tables).sort()).toEqual([...SETUP_TABLES].sort());
      expect(payload.tables.property).toHaveLength(1);
      expect(payload.tables.function_space).toHaveLength(4);
      expect(countRows(payload)).toBeGreaterThan(80);
      expect(Object.keys(payload.tables)).not.toContain('booking');
    });
  });

  it('is empty for a property with nothing on it', () => {
    withStore((db) => {
      const payload = exportSetup(db, catalogCode('NOWHERE'), FIXED_NOW);
      expect(countRows(payload)).toBe(0);
    });
  });
});

describe('importing a setup', () => {
  it('replays it into a second store', () => {
    withStore((source) => {
      seedDemoProperty(source, FIXED_NOW);
      const payload = exportSetup(source, CANYON, FIXED_NOW);

      const target = openInMemory();
      migrateToLatest(target);
      const result = importSetup(target, payload);
      expect(result.propertyCode).toBe('CANYON');
      expect(result.rows).toBe(countRows(payload));

      expect(requireProperty(target, CANYON).name).toBe('Canyon Ridge Hotel');
      expect(listSpaces(target, CANYON)).toHaveLength(4);
      expect(listItems(target, CANYON)).toHaveLength(listItems(source, CANYON).length);
      expect(listRecipes(target, CANYON)).toHaveLength(5);
      target.close();
    });
  });

  it('brings it in under a different code when asked', () => {
    withStore((source) => {
      seedDemoProperty(source, FIXED_NOW);
      const payload = exportSetup(source, CANYON, FIXED_NOW);

      const target = openInMemory();
      migrateToLatest(target);
      const result = importSetup(target, payload, { asPropertyCode: 'summit' });
      expect(result.propertyCode).toBe('SUMMIT');
      expect(requireProperty(target, catalogCode('SUMMIT')).name).toBe('Canyon Ridge Hotel');
      expect(listSpaces(target, catalogCode('SUMMIT'))).toHaveLength(4);
      target.close();
    });
  });

  it('refuses to import over a property that is already there', () => {
    withStore((db) => {
      seedDemoProperty(db, FIXED_NOW);
      const payload = exportSetup(db, CANYON, FIXED_NOW);
      expect(() => importSetup(db, payload)).toThrow(/already on file/);
    });
  });

  it('refuses a file that is not an export and one from a newer build', () => {
    withStore((db) => {
      seedDemoProperty(db, FIXED_NOW);
      const payload = exportSetup(db, CANYON, FIXED_NOW);
      expect(() => importSetup(db, { ...payload, format: 'something-else' as never })).toThrow(
        /not a covercount setup export/,
      );
      expect(() => importSetup(db, { ...payload, version: TARGET_SCHEMA_VERSION + 1 })).toThrow(
        /and this build carries/,
      );
    });
  });

  it('leaves nothing behind when a row is refused part way through', () => {
    withStore((source) => {
      seedDemoProperty(source, FIXED_NOW);
      const payload = exportSetup(source, CANYON, FIXED_NOW);
      const broken = {
        ...payload,
        tables: {
          ...payload.tables,
          function_space: [
            ...(payload.tables.function_space ?? []),
            { property_code: 'CANYON', code: 'GRAND-A', name: 'duplicate' },
          ],
        },
      };

      const target = openInMemory();
      migrateToLatest(target);
      expect(() => importSetup(target, broken)).toThrow();
      expect(target.prepare('select count(*) as n from property').get()).toEqual({ n: 0 });
      target.close();
    });
  });
});
