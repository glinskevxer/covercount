/**
 * Handing the service charge back out.
 *
 * The service charge is collected from the client as one number on one
 * invoice, and it is owed to the people who worked. Two things decide a share:
 * how long somebody was on the floor, and what the house pays that role
 * relative to the others. Neither on its own is enough. Hours alone pay a
 * coat check the same as a captain; points alone pay a captain who left at
 * nine the same as one who stayed to two.
 *
 * So the weight is hours times points, and the pool is split by largest
 * remainder. That last part is the whole reason this is not a division: the
 * shares have to add back to the pool exactly, because the pool is money that
 * has already been billed.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import type { EntityId } from '../core/ids.js';
import { money, zeroMoney, type Money } from '../core/money.js';
import { allocateByWeight } from '../core/rounding.js';
import { requireProperty } from '../property/store.js';
import { invoiceFunctions, requireInvoice } from '../billing/invoice.js';
import { invoiceTotals } from '../billing/invoice.js';
import { listShifts } from './shifts.js';
import { isRole, shiftHeadHours, type Role } from './types.js';
import { inTransaction } from '../store/database.js';
import type { Database } from '../store/database.js';

/** Head hours are held in thousandths so a twenty minute shift stays exact. */
const HOUR_THOUSANDTHS = 1000;

export interface DistributionPoint {
  readonly role: Role;
  readonly points: number;
}

export function setDistributionPoints(
  db: Database,
  propertyCode: Parameters<typeof requireProperty>[1],
  roleName: string,
  points: number,
): DistributionPoint {
  requireProperty(db, propertyCode);
  const role = roleName.trim().toUpperCase();
  if (!isRole(role)) {
    throw invalidInput('distribution.role', `${roleName} is not a role this house rosters`);
  }
  if (!Number.isSafeInteger(points) || points < 0) {
    throw invalidInput('distribution.points', 'points are a whole number, nil or more');
  }
  db.prepare(
    `insert into distribution_point (property_code, role, points) values (?, ?, ?)
     on conflict (property_code, role) do update set points = excluded.points`,
  ).run(propertyCode, role, points);
  return { role, points };
}

export function listDistributionPoints(
  db: Database,
  propertyCode: Parameters<typeof requireProperty>[1],
): DistributionPoint[] {
  return db
    .prepare<[string], { role: string; points: number }>(
      'select role, points from distribution_point where property_code = ? order by role',
    )
    .all(propertyCode)
    .map((row) => ({ role: row.role as Role, points: row.points }));
}

/**
 * The points a role earns. A house that has published nothing for a role pays
 * it one point, which keeps a new role in the enum from silently earning
 * nothing the first time somebody rosters it.
 */
export function pointsFor(
  db: Database,
  propertyCode: Parameters<typeof requireProperty>[1],
  role: Role,
): number {
  const row = db
    .prepare<
      [string, string],
      { points: number }
    >('select points from distribution_point where property_code = ? and role = ?')
    .get(propertyCode, role);
  return row?.points ?? 1;
}

export interface DistributionLine {
  readonly role: Role;
  /** Head hours in thousandths, so twenty minutes is 333 and not 0.33. */
  readonly headHoursThousandths: number;
  readonly points: number;
  readonly weight: number;
  readonly share: Money;
}

export interface Distribution {
  readonly invoiceId: EntityId<'invoice'>;
  readonly pool: Money;
  readonly lines: DistributionLine[];
  readonly runAt: string;
}

/**
 * Roll the shifts on every function the invoice covers up by role. Two
 * functions that both rostered four servers come out as one server line: the
 * split is per person by role, not per event.
 */
function weighRoles(
  db: Database,
  invoiceId: EntityId<'invoice'>,
  propertyCode: Parameters<typeof requireProperty>[1],
): { role: Role; hours: number; points: number; weight: number }[] {
  const hoursByRole = new Map<Role, number>();
  for (const functionId of invoiceFunctions(db, invoiceId)) {
    for (const shift of listShifts(db, functionId)) {
      const thousandths = Math.round(shiftHeadHours(shift) * HOUR_THOUSANDTHS);
      hoursByRole.set(shift.role, (hoursByRole.get(shift.role) ?? 0) + thousandths);
    }
  }
  return [...hoursByRole.entries()]
    .map(([role, hours]) => {
      const points = pointsFor(db, propertyCode, role);
      return { role, hours, points, weight: hours * points };
    })
    .filter((entry) => entry.weight > 0)
    .sort((left, right) => left.role.localeCompare(right.role));
}

/**
 * Split the service charge and write the split down.
 *
 * A run replaces the one before it. That matters because a shift added after
 * the first run has to change everybody's share, not just its own: the pool
 * did not get bigger, so somebody else's share got smaller.
 */
export function distributeServiceCharge(
  db: Database,
  invoiceId: EntityId<'invoice'>,
  now: string,
): Distribution {
  const invoice = requireInvoice(db, invoiceId);
  if (invoice.status === 'VOID') {
    throw conflict(
      'distribution.void',
      `invoice ${invoiceId} is void, there is nothing to hand out`,
      invoiceId,
    );
  }
  const property = requireProperty(db, invoice.propertyCode);
  const pool = invoiceTotals(db, invoiceId).serviceCharge;
  const weighed = weighRoles(db, invoiceId, invoice.propertyCode);
  if (weighed.length === 0) {
    throw conflict(
      'distribution.nobody',
      `nobody is rostered against invoice ${invoiceId}, so the service charge has nowhere to go`,
      invoiceId,
    );
  }

  const shares =
    pool.amount === 0
      ? weighed.map(() => 0)
      : allocateByWeight(
          pool.amount,
          weighed.map((entry) => entry.weight),
        );

  const lines: DistributionLine[] = weighed.map((entry, index) => ({
    role: entry.role,
    headHoursThousandths: entry.hours,
    points: entry.points,
    weight: entry.weight,
    share: money(shares[index] ?? 0, property.currency),
  }));

  inTransaction(db, (handle) => {
    handle.prepare('delete from distribution_line where invoice_id = ?').run(invoiceId);
    handle.prepare('delete from distribution_run where invoice_id = ?').run(invoiceId);
    handle
      .prepare('insert into distribution_run (invoice_id, pool_minor, run_at) values (?, ?, ?)')
      .run(invoiceId, pool.amount, now);
    const insert = handle.prepare(
      `insert into distribution_line
         (invoice_id, role, head_hours_thousandths, points, weight, share_minor)
       values (?, ?, ?, ?, ?, ?)`,
    );
    for (const line of lines) {
      insert.run(
        invoiceId,
        line.role,
        line.headHoursThousandths,
        line.points,
        line.weight,
        line.share.amount,
      );
    }
    return true;
  });

  return { invoiceId, pool, lines, runAt: now };
}

export function findDistribution(
  db: Database,
  invoiceId: EntityId<'invoice'>,
): Distribution | undefined {
  const invoice = requireInvoice(db, invoiceId);
  const property = requireProperty(db, invoice.propertyCode);
  const run = db
    .prepare<
      [string],
      { pool_minor: number; run_at: string }
    >('select pool_minor, run_at from distribution_run where invoice_id = ?')
    .get(invoiceId);
  if (run === undefined) {
    return undefined;
  }
  const lines = db
    .prepare<
      [string],
      {
        role: string;
        head_hours_thousandths: number;
        points: number;
        weight: number;
        share_minor: number;
      }
    >('select * from distribution_line where invoice_id = ? order by role')
    .all(invoiceId)
    .map((row) => ({
      role: row.role as Role,
      headHoursThousandths: row.head_hours_thousandths,
      points: row.points,
      weight: row.weight,
      share: money(row.share_minor, property.currency),
    }));
  return {
    invoiceId,
    pool: money(run.pool_minor, property.currency),
    lines,
    runAt: run.run_at,
  };
}

export function requireDistribution(db: Database, invoiceId: EntityId<'invoice'>): Distribution {
  const found = findDistribution(db, invoiceId);
  if (found === undefined) {
    throw notFound(
      'distribution.missing',
      invoiceId,
      `the service charge on invoice ${invoiceId} has not been handed out yet`,
    );
  }
  return found;
}

/**
 * Whether a recorded split still adds to the pool it was drawn from, and
 * whether that pool is still the one the invoice carries. A charge added after
 * the run moves the second answer without touching the first.
 */
export interface DistributionCheck {
  readonly recordedPool: Money;
  readonly currentPool: Money;
  readonly sharesTotal: Money;
  readonly addsUp: boolean;
  readonly stale: boolean;
}

export function checkDistribution(db: Database, invoiceId: EntityId<'invoice'>): DistributionCheck {
  const recorded = requireDistribution(db, invoiceId);
  const invoice = requireInvoice(db, invoiceId);
  const property = requireProperty(db, invoice.propertyCode);
  let total = zeroMoney(property.currency);
  for (const line of recorded.lines) {
    total = money(total.amount + line.share.amount, property.currency);
  }
  const current = invoiceTotals(db, invoiceId).serviceCharge;
  return {
    recordedPool: recorded.pool,
    currentPool: current,
    sharesTotal: total,
    addsUp: total.amount === recorded.pool.amount,
    stale: current.amount !== recorded.pool.amount,
  };
}
