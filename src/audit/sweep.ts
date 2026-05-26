/**
 * The sweep somebody runs on a Monday morning.
 *
 * Every rule in this build refuses a bad write at the point it is made, which
 * catches everything except the things that were fine when they were written
 * and stopped being fine afterwards. A guarantee that was inside the room's
 * capacity until somebody moved the function to a smaller room. A sheet that
 * matched until the split changed. A deposit that was not overdue last week.
 *
 * Those are what this finds, and they are the only kind of problem it looks
 * for. It writes nothing, so it is safe to run against a live store.
 */

import { compareCalendarDates, type CalendarDate } from '../core/calendar.js';
import type { EntityId } from '../core/ids.js';
import type { CatalogCode } from '../core/ids.js';
import { functionsOnDate } from '../booking/diary.js';
import { listFunctions } from '../booking/functions.js';
import { listBookings } from '../booking/store.js';
import { holdsSpace, isFinished } from '../booking/types.js';
import { spaceCapacities } from '../property/store.js';
import { findCovers } from '../covers/guarantee.js';
import { splitProblems } from '../covers/selections.js';
import { listSpecialMeals, totalSpecialCovers } from '../covers/special.js';
import { liveRevision, revisionIsStale } from '../orders/revisions.js';
import { listShifts } from '../labour/shifts.js';
import { findRevenueMinimum, minimumStanding } from '../billing/minimum.js';
import { checkDistribution, findDistribution } from '../labour/distribution.js';
import { listInvoices } from '../billing/invoice.js';
import { cancellationBands } from '../booking/damages.js';
import { lapsedHolds } from '../property/holds.js';
import { listStockLevels } from '../production/stock.js';
import { productionVariance } from '../production/actuals.js';
import { formatMoney } from '../core/money.js';
import { padRight, row, sheet } from '../core/layout.js';
import { foreignKeyCheck, type Database } from '../store/database.js';

/** Nothing iterates the levels, so they are a union rather than a list. */
export type FindingLevel = 'error' | 'warning';

export interface Finding {
  readonly level: FindingLevel;
  readonly code: string;
  readonly subject: string;
  readonly message: string;
}

export interface SweepOptions {
  /** The date the office believes it is, for anything time sensitive. */
  readonly today: CalendarDate;
  /** Only look at functions on or after this date. */
  readonly from?: CalendarDate;
}

export function sweep(db: Database, propertyCode: CatalogCode, options: SweepOptions): Finding[] {
  const findings: Finding[] = [];

  for (const problem of foreignKeyCheck(db)) {
    findings.push({
      level: 'error',
      code: 'store.reference',
      subject: 'store',
      message: problem,
    });
  }

  for (const booking of listBookings(db, propertyCode)) {
    if (isFinished(booking.status)) {
      continue;
    }
    const slots = listFunctions(db, booking.id).filter((slot) => holdsSpace(slot.status));
    if (slots.length === 0 && booking.status !== 'INQUIRY') {
      findings.push({
        level: 'warning',
        code: 'booking.nospace',
        subject: booking.id,
        message: `${booking.id} is ${booking.status.toLowerCase()} and holds no space`,
      });
    }

    for (const slot of slots) {
      if (options.from !== undefined && compareCalendarDates(slot.serviceDate, options.from) < 0) {
        continue;
      }
      findings.push(...sweepFunction(db, slot.id, options));
    }
  }

  return findings.sort(
    (left, right) =>
      left.level.localeCompare(right.level) ||
      left.subject.localeCompare(right.subject) ||
      left.code.localeCompare(right.code),
  );
}

function sweepFunction(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  options: SweepOptions,
): Finding[] {
  const findings: Finding[] = [];
  const covers = findCovers(db, functionId);
  if (covers === undefined) {
    findings.push({
      level: 'warning',
      code: 'covers.unopened',
      subject: functionId,
      message: `${functionId} has no cover count open`,
    });
    return findings;
  }

  if (covers.guaranteedCovers === undefined) {
    if (compareCalendarDates(covers.guaranteeDue.date, options.today) < 0) {
      findings.push({
        level: 'error',
        code: 'covers.unguaranteed',
        subject: functionId,
        message: `the guarantee for ${functionId} closed on ${covers.guaranteeDue.date} and no count was ever given`,
      });
    }
    return findings;
  }

  findings.push(...sweepCovers(db, functionId, covers.setCovers ?? covers.guaranteedCovers));
  findings.push(...sweepPaperwork(db, functionId));
  return findings;
}

/** The room has to still hold what the guarantee grew into. */
function sweepCovers(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  setFor: number,
): Finding[] {
  const findings: Finding[] = [];
  const slot = functionsOnDate(
    db,
    requirePropertyOf(db, functionId),
    serviceDateOf(db, functionId),
  ).find((each) => each.id === functionId);
  if (slot === undefined) {
    return findings;
  }

  const capacity = spaceCapacities(db, slot.propertyCode, slot.spaceCode).find(
    (row) => row.setupStyle === slot.setupStyle,
  );
  if (capacity === undefined) {
    findings.push({
      level: 'error',
      code: 'space.nocapacity',
      subject: functionId,
      message: `${slot.spaceCode} publishes no ${slot.setupStyle} capacity, so nobody can tell whether it fits`,
    });
  } else if (setFor > capacity.capacity) {
    findings.push({
      level: 'error',
      code: 'space.overset',
      subject: functionId,
      message: `${functionId} is set for ${setFor} in a room that seats ${capacity.capacity} that way`,
    });
  }

  const guaranteed = findCovers(db, functionId)?.guaranteedCovers ?? 0;
  const special = totalSpecialCovers(db, functionId);
  if (special > guaranteed) {
    findings.push({
      level: 'error',
      code: 'covers.specials',
      subject: functionId,
      message: `${functionId} carries ${special} special covers against a guarantee of ${guaranteed}`,
    });
  }

  return findings;
}

/** The split, the substitutions, the roster and the sheet. */
function sweepPaperwork(db: Database, functionId: EntityId<'functionSlot'>): Finding[] {
  const findings: Finding[] = [];

  for (const problem of splitProblems(db, functionId)) {
    findings.push({
      level: 'warning',
      code: 'selection.total',
      subject: functionId,
      message: `the ${problem.course} split adds to ${problem.chosen} against ${problem.expected} standard covers`,
    });
  }

  const open = listSpecialMeals(db, functionId).filter(
    (meal) => meal.substituteItemCode === undefined,
  );
  if (open.length > 0) {
    findings.push({
      level: 'warning',
      code: 'special.undecided',
      subject: functionId,
      message: `${open.length} special meals on ${functionId} have no dish decided`,
    });
  }

  const shifts = listShifts(db, functionId);
  for (const shift of shifts) {
    if (shift.hourly.amount === 0) {
      findings.push({
        level: 'warning',
        code: 'labour.unpriced',
        subject: functionId,
        message: `the ${shift.role} shift on ${functionId} carries no rate`,
      });
    }
  }

  const minimum = findRevenueMinimum(db, functionId);
  if (minimum !== undefined) {
    const standing = minimumStanding(db, functionId);
    if (!standing.met) {
      findings.push({
        level: 'warning',
        code: 'minimum.short',
        subject: functionId,
        message: `${functionId} is ${formatMoney(standing.shortfall)} under its minimum and the shortfall is not on the bill`,
      });
    }
  }

  const variance = productionVariance(db, functionId);
  for (const row of variance.rows) {
    if (row.ranOut) {
      findings.push({
        level: 'warning',
        code: 'kitchen.short',
        subject: functionId,
        message: `${row.recipeCode} put out ${row.produced} against ${row.plates} plates, so somebody went without`,
      });
    }
  }

  const live = liveRevision(db, functionId);
  if (live !== undefined && live.status === 'SIGNED' && revisionIsStale(db, functionId)) {
    findings.push({
      level: 'error',
      code: 'beo.stale',
      subject: functionId,
      message: `${live.id} is signed and no longer matches ${functionId}, so a change order is owed`,
    });
  }

  return findings;
}

/**
 * The checks that belong to the property rather than to one function: the
 * shelf, the sales office's holds, the cancellation scale and the pools that
 * have drifted since they were split.
 */
export function sweepProperty(
  db: Database,
  propertyCode: CatalogCode,
  options: SweepOptions,
): Finding[] {
  const findings: Finding[] = [];

  for (const level of listStockLevels(db, propertyCode)) {
    if (level.par.milli > 0 && level.onHand.milli < level.par.milli) {
      findings.push({
        level: 'warning',
        code: 'stock.underpar',
        subject: level.ingredientCode,
        message: `${level.ingredientCode} is under its par and nothing is on order`,
      });
    }
  }

  for (const lapsed of lapsedHolds(db, propertyCode, options.today)) {
    findings.push({
      level: 'warning',
      code: 'hold.lapsed',
      subject: String(lapsed.id),
      message: `hold ${lapsed.id} on ${lapsed.spaceCode} ran out on ${lapsed.holdsUntil} and is still live`,
    });
  }

  const bands = cancellationBands(db, propertyCode);
  if (bands.length > 0 && !bands.some((band) => band.daysBefore === 0)) {
    findings.push({
      level: 'error',
      code: 'damages.hole',
      subject: propertyCode,
      message: `${propertyCode} publishes a cancellation scale with no band at nil days, so a walkaway on the day cannot be priced`,
    });
  }

  for (const invoice of listInvoices(db, propertyCode)) {
    if (findDistribution(db, invoice.id) === undefined) {
      continue;
    }
    const check = checkDistribution(db, invoice.id);
    if (check.stale) {
      findings.push({
        level: 'warning',
        code: 'pool.stale',
        subject: invoice.id,
        message: `the service charge on ${invoice.id} was split at ${formatMoney(check.recordedPool)} and now stands at ${formatMoney(check.currentPool)}`,
      });
    }
    if (!check.addsUp) {
      findings.push({
        level: 'error',
        code: 'pool.short',
        subject: invoice.id,
        message: `the shares on ${invoice.id} add to ${formatMoney(check.sharesTotal)} against a pool of ${formatMoney(check.recordedPool)}`,
      });
    }
  }

  return findings;
}

/** Both halves of the sweep, which is what the command line runs. */
export function sweepAll(
  db: Database,
  propertyCode: CatalogCode,
  options: SweepOptions,
): Finding[] {
  return [...sweep(db, propertyCode, options), ...sweepProperty(db, propertyCode, options)];
}

function requirePropertyOf(db: Database, functionId: EntityId<'functionSlot'>): CatalogCode {
  const row = db
    .prepare<
      [string],
      { property_code: string }
    >('select property_code from function_slot where id = ?')
    .get(functionId);
  return (row?.property_code ?? '') as CatalogCode;
}

function serviceDateOf(db: Database, functionId: EntityId<'functionSlot'>): CalendarDate {
  const row = db
    .prepare<
      [string],
      { service_date: string }
    >('select service_date from function_slot where id = ?')
    .get(functionId);
  return (row?.service_date ?? '1970-01-01') as CalendarDate;
}

export function countByLevel(findings: readonly Finding[]): Record<FindingLevel, number> {
  return {
    error: findings.filter((row) => row.level === 'error').length,
    warning: findings.filter((row) => row.level === 'warning').length,
  };
}

export function renderFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return 'nothing to look at';
  }
  const counts = countByLevel(findings);
  return sheet({
    heading: `${counts.error} errors, ${counts.warning} warnings`,
    sections: [
      {
        title: '',
        rows: findings.map((finding) =>
          row(padRight(finding.level, 8), padRight(finding.subject, 14), finding.message),
        ),
      },
    ],
  });
}
