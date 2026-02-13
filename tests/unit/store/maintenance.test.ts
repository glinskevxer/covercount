import { describe, expect, it } from 'vitest';
import { withStore, withStoreFile } from '../../support/store.js';
import { readyFunction } from '../../support/production.js';
import {
  analyse,
  compact,
  fileBytes,
  health,
  isHealthy,
  pageStats,
  tableSizes,
} from '../../../src/store/maintenance.js';
import { MIGRATIONS } from '../../../src/store/schema.js';

describe('the page statistics', () => {
  it('reports a size that is the page size times the count', () => {
    withStore((db) => {
      const stats = pageStats(db);
      expect(stats.pageSize).toBeGreaterThan(0);
      expect(stats.pageCount).toBeGreaterThan(0);
      expect(stats.bytes).toBe(stats.pageSize * stats.pageCount);
      expect(stats.reclaimable).toBe(stats.pageSize * stats.freePages);
    });
  });
});

describe('the table sizes', () => {
  it('counts every table the migrations made, biggest first', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const sizes = tableSizes(db);
      expect(sizes.length).toBeGreaterThan(MIGRATIONS.length);
      for (let index = 1; index < sizes.length; index += 1) {
        expect(sizes[index - 1]?.rows).toBeGreaterThanOrEqual(sizes[index]?.rows ?? 0);
      }
      expect(sizes.find((size) => size.table === 'function_slot')?.rows).toBe(1);
    });
  });

  it('reads a table nobody wrote to as empty rather than missing', () => {
    withStore((db) => {
      expect(tableSizes(db).find((size) => size.table === 'space_hold')?.rows).toBe(0);
    });
  });
});

describe('the health report', () => {
  it('is clean on a fresh store', () => {
    withStore((db) => {
      const report = health(db);
      expect(report.integrity).toBe('ok');
      expect(report.referenceProblems).toEqual([]);
      expect(report.schemaVersion).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.id);
      expect(isHealthy(report)).toBe(true);
    });
  });

  it('counts the rows it found across every table', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const report = health(db);
      expect(report.rows).toBe(tableSizes(db).reduce((total, size) => total + size.rows, 0));
      expect(report.biggest.length).toBeLessThanOrEqual(10);
      expect(report.tables).toBeGreaterThan(20);
    });
  });
});

describe('compacting', () => {
  it('hands the free pages back', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      db.exec('delete from function_slot');
      const result = compact(db);
      expect(result.after.freePages).toBe(0);
      expect(result.after.bytes).toBeLessThanOrEqual(result.before.bytes);
      expect(result.bytesFreed).toBe(Math.max(result.before.bytes - result.after.bytes, 0));
    });
  });

  it('leaves the store readable and intact', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      compact(db);
      expect(isHealthy(health(db))).toBe(true);
      expect(tableSizes(db).find((size) => size.table === 'function_slot')?.rows).toBe(1);
    });
  });
});

describe('the planner statistics', () => {
  it('writes a statistics table it can read back', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      expect(analyse(db)).toBe(1);
    });
  });
});

describe('the file on disk', () => {
  it('measures what is actually there, and nothing for a path that is not', () => {
    withStoreFile((db, path) => {
      readyFunction(db, { guarantee: 180 });
      expect(fileBytes(path)).toBeGreaterThan(0);
      expect(fileBytes(`${path}.nothing`)).toBe(0);
    });
  });
});
