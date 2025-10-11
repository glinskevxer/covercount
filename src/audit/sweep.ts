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
import { foreignKeyCheck, type Database } from '../store/database.js';

export const FINDING_LEVELS = ['error', 'warning'] as const;

export type FindingLevel = (typeof FINDING_LEVELS)[number];

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
  const lines = findings.map(
    (finding) => `  ${finding.level.padEnd(8)}${finding.subject.padEnd(14)}${finding.message}`,
  );
  return [`${counts.error} errors, ${counts.warning} warnings`, '', ...lines].join('\n');
}
