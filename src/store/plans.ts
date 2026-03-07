/**
 * What SQLite says it is going to do.
 *
 * The store is a single file on a shared drive, so nothing here is ever going
 * to be slow enough to notice on a laptop with three bookings in it. That is
 * exactly the problem: a full table scan on `charge_line` is invisible until a
 * property has four seasons of history in the file, and by then the query is
 * in fifteen places.
 *
 * So the plan is read explicitly and asserted on. A query that scans a table
 * it should be seeking into is a test failure now rather than a support call
 * in two years.
 */

import { invalidInput } from '../core/errors.js';
import type { Database } from './database.js';

export interface PlanStep {
  readonly id: number;
  readonly parent: number;
  readonly detail: string;
}

/** The plan for one statement. Parameters are bound so the plan is the real one. */
export function queryPlan(
  db: Database,
  sql: string,
  params: readonly (string | number)[] = [],
): PlanStep[] {
  const trimmed = sql.trim();
  if (!/^select\b/i.test(trimmed)) {
    throw invalidInput('plan.select', 'only a select has a plan worth reading');
  }
  return db
    .prepare<(string | number)[], { id: number; parent: number; detail: string }>(
      `explain query plan ${trimmed}`,
    )
    .all(...[...params])
    .map((row) => ({ id: row.id, parent: row.parent, detail: row.detail }));
}

/** True when every table the plan touches is reached through an index. */
export function seeksOnly(plan: readonly PlanStep[]): boolean {
  return !plan.some((step) => /^SCAN\b/.test(step.detail));
}

/** The tables the plan reads end to end rather than seeking into. */
export function scannedTables(plan: readonly PlanStep[]): string[] {
  return plan
    .map((step) => /^SCAN (?:TABLE )?([A-Za-z0-9_]+)/.exec(step.detail)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** The indexes the plan names, for asserting on the one that matters. */
export function usedIndexes(plan: readonly PlanStep[]): string[] {
  return plan
    .map((step) => /USING (?:COVERING )?INDEX ([A-Za-z0-9_]+)/.exec(step.detail)?.[1])
    .filter((name): name is string => name !== undefined);
}

export function renderPlan(plan: readonly PlanStep[]): string {
  return plan.map((step) => `  ${step.detail}`).join('\n');
}

export interface HotQuery {
  readonly name: string;
  readonly sql: string;
  readonly params: readonly (string | number)[];
}

/**
 * The reads that run on every screen in the building.
 *
 * Each one is here because something in the office calls it in a loop: the
 * board sweeps a date, the production sheet sweeps a function, the sweep runs
 * the lot. A scan in any of them multiplies by however many rows the loop has.
 */
export const HOT_QUERIES: readonly HotQuery[] = [
  {
    name: 'the diary for a date',
    sql: 'select * from function_slot where property_code = ? and service_date = ?',
    params: ['CANYON', '2025-04-18'],
  },
  {
    name: 'the charges on a function',
    sql: 'select * from charge_line where function_id = ? order by position',
    params: ['FN-2025-0001'],
  },
  {
    name: 'the functions on a booking',
    sql: 'select * from function_slot where booking_id = ? order by service_date',
    params: ['BK-2025-0001'],
  },
  {
    name: 'the shifts on a function',
    sql: 'select * from shift where function_id = ?',
    params: ['FN-2025-0001'],
  },
  {
    name: 'the movements against an ingredient',
    sql: 'select * from stock_movement where property_code = ? and ingredient_code = ? order by id',
    params: ['CANYON', 'SHORT-RIB'],
  },
  {
    name: 'the live holds on a date',
    sql: 'select * from space_hold where property_code = ? and service_date = ? and released_at is null',
    params: ['CANYON', '2025-04-18'],
  },
  {
    name: 'who was sent a revision',
    sql: 'select * from beo_delivery where beo_id = ? order by id',
    params: ['BEO-2025-0001'],
  },
  {
    name: 'the price in force on a date',
    sql: `select price_minor from price_line
          where property_code = ? and book_code = ? and subject_kind = ? and subject_code = ?
            and effective_from <= ?
          order by effective_from desc limit 1`,
    params: ['CANYON', 'RACK-2025', 'ITEM', 'BEET-TART', '2025-04-18'],
  },
];

export interface PlanProblem {
  readonly name: string;
  readonly scanned: string[];
  readonly plan: PlanStep[];
}

/** Every hot query that scans something. Empty is the only passing answer. */
export function planProblems(db: Database): PlanProblem[] {
  const problems: PlanProblem[] = [];
  for (const query of HOT_QUERIES) {
    const plan = queryPlan(db, query.sql, query.params);
    const scanned = scannedTables(plan);
    if (scanned.length > 0) {
      problems.push({ name: query.name, scanned, plan });
    }
  }
  return problems;
}
