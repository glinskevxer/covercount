import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import {
  HOT_QUERIES,
  planProblems,
  queryPlan,
  renderPlan,
  scannedTables,
  seeksOnly,
  usedIndexes,
} from '../../../src/store/plans.js';

describe('reading a plan', () => {
  it('hands back the steps SQLite says it will take', () => {
    withStore((db) => {
      const plan = queryPlan(db, 'select * from function_slot where id = ?', ['FN-2025-0001']);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan[0]?.detail).toContain('function_slot');
    });
  });

  it('refuses anything that is not a select', () => {
    withStore((db) => {
      expect(() => queryPlan(db, 'delete from function_slot')).toThrow(/only a select/);
      expect(() => queryPlan(db, '  update booking set post_as = ?', ['x'])).toThrow(
        /only a select/,
      );
    });
  });

  it('tells a seek from a scan', () => {
    withStore((db) => {
      const seek = queryPlan(db, 'select * from charge_line where function_id = ?', [
        'FN-2025-0001',
      ]);
      expect(seeksOnly(seek)).toBe(true);
      expect(scannedTables(seek)).toEqual([]);

      const scan = queryPlan(db, 'select * from charge_line where description = ?', ['dinner']);
      expect(seeksOnly(scan)).toBe(false);
      expect(scannedTables(scan)).toEqual(['charge_line']);
    });
  });

  it('names the index a seek went through', () => {
    withStore((db) => {
      const plan = queryPlan(db, 'select * from charge_line where function_id = ?', [
        'FN-2025-0001',
      ]);
      expect(usedIndexes(plan)).toContain('charge_line_by_function');
    });
  });

  it('prints one line a step', () => {
    withStore((db) => {
      const plan = queryPlan(db, 'select * from function_slot where id = ?', ['FN-2025-0001']);
      expect(renderPlan(plan).split('\n')).toHaveLength(plan.length);
    });
  });
});

describe('the reads that run on every screen', () => {
  it('all seek rather than scan', () => {
    withStore((db) => {
      const problems = planProblems(db);
      const named = problems.map(
        (problem) =>
          `${problem.name} scans ${problem.scanned.join(', ')}\n${renderPlan(problem.plan)}`,
      );
      expect(named).toEqual([]);
    });
  });

  it('covers the queries the office actually runs in a loop', () => {
    expect(HOT_QUERIES.length).toBeGreaterThanOrEqual(8);
    for (const query of HOT_QUERIES) {
      expect(query.name.length).toBeGreaterThan(0);
      expect(query.sql).toMatch(/^\s*select/i);
      expect((query.sql.match(/\?/g) ?? []).length).toBe(query.params.length);
    }
  });

  it('would notice if an index were dropped', () => {
    withStore((db) => {
      expect(planProblems(db)).toEqual([]);
      db.exec('drop index charge_line_by_function');
      const problems = planProblems(db);
      expect(problems.map((problem) => problem.scanned.flat())).toContainEqual(['charge_line']);
    });
  });
});
