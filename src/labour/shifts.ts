/**
 * Building the roster for a function.
 *
 * The shift runs from the lead in before guests arrive to the lead out after
 * they leave, and then it is stretched to whatever minimum call the property
 * pays. The stretch goes on the front, not the back: a four hour minimum on a
 * two hour lunch means the crew comes in early and sets up properly, not that
 * they sit around afterwards.
 *
 * Head counts come off the covers the room is set for, not the guarantee,
 * because the spare places still have to be poured for.
 */

import { invalidInput, notFound } from '../core/errors.js';
import { parseEntityId, type EntityId } from '../core/ids.js';
import { money, scaleMoney, sumMoney, type Money } from '../core/money.js';
import { divideRound } from '../core/rounding.js';
import { requireFunction } from '../booking/functions.js';
import { requireCovers } from '../covers/guarantee.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import { allocateEntityId } from '../store/sequence.js';
import { headCounts, findLabourRate } from './staffing.js';
import { isRole, shiftHeadHours, type Role, type Shift } from './types.js';

interface ShiftRow {
  id: string;
  function_id: string;
  role: string;
  heads: number;
  start_minute: number;
  end_minute: number;
  hourly_minor: number;
  created_at: string;
  note: string;
}

export function toShift(row: ShiftRow, currency: Money['currency']): Shift {
  return {
    id: parseEntityId('shift', row.id),
    functionId: parseEntityId('functionSlot', row.function_id),
    role: row.role as Role,
    heads: row.heads,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    hourly: money(row.hourly_minor, currency),
    note: row.note,
    createdAt: row.created_at,
  };
}

export interface ShiftWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * The block one role works. The lead in and lead out come off the rule, and
 * the whole thing is stretched backwards to reach the minimum call.
 */
export function shiftWindow(
  functionStart: number,
  functionEnd: number,
  leadInMinutes: number,
  leadOutMinutes: number,
  minimumHours: number,
): ShiftWindow {
  const end = functionEnd + leadOutMinutes;
  let start = functionStart - leadInMinutes;
  const minimumMinutes = minimumHours * 60;
  if (end - start < minimumMinutes) {
    start = end - minimumMinutes;
  }
  return { startMinute: start, endMinute: end };
}

export interface BuildRosterOptions {
  /** Take the head count off this many covers instead of what is on file. */
  readonly covers?: number;
  readonly replace?: boolean;
}

export function buildRoster(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  now: string,
  options: BuildRosterOptions = {},
): Shift[] {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);

  let covers = options.covers;
  if (covers === undefined) {
    const counted = requireCovers(db, functionId);
    covers = counted.setCovers ?? counted.guaranteedCovers ?? slot.expectedCovers;
  }

  const counts = headCounts(db, slot.propertyCode, slot.serviceStyle, covers);
  if (counts.length === 0) {
    throw notFound(
      'staffing.missing',
      slot.serviceStyle,
      `${slot.propertyCode} has no staffing rules for ${slot.serviceStyle} service`,
    );
  }

  return inTransaction(db, (handle) => {
    if (options.replace !== false) {
      handle.prepare('delete from shift where function_id = ?').run(functionId);
    }
    const out: Shift[] = [];
    for (const count of counts) {
      if (count.heads === 0) {
        continue;
      }
      const window = shiftWindow(
        slot.startMinute,
        slot.endMinute,
        count.rule.leadInMinutes,
        count.rule.leadOutMinutes,
        count.rule.minimumHours,
      );
      const hourly = findLabourRate(handle, slot.propertyCode, count.role, slot.serviceDate);
      const id = allocateEntityId(
        handle,
        slot.propertyCode,
        'shift',
        Number(slot.serviceDate.slice(0, 4)),
      );
      handle
        .prepare(
          `insert into shift (id, function_id, role, heads, start_minute, end_minute,
            hourly_minor, created_at, note)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          functionId,
          count.role,
          count.heads,
          window.startMinute,
          window.endMinute,
          hourly?.amount ?? 0,
          now,
          hourly === undefined ? 'no rate in force on the service date' : '',
        );
      out.push(requireShift(handle, id, property.currency));
    }
    return out;
  });
}

export function findShift(
  db: Database,
  id: EntityId<'shift'>,
  currency: Money['currency'],
): Shift | undefined {
  const row = db.prepare<[string], ShiftRow>('select * from shift where id = ?').get(id);
  return row === undefined ? undefined : toShift(row, currency);
}

export function requireShift(
  db: Database,
  id: EntityId<'shift'>,
  currency: Money['currency'],
): Shift {
  const found = findShift(db, id, currency);
  if (found === undefined) {
    throw notFound('shift.missing', id, `shift ${id} is not on file`);
  }
  return found;
}

export function listShifts(db: Database, functionId: EntityId<'functionSlot'>): Shift[] {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  return db
    .prepare<[string], ShiftRow>('select * from shift where function_id = ? order by role, id')
    .all(functionId)
    .map((row) => toShift(row, property.currency));
}

export interface AddShiftInput {
  readonly role: string;
  readonly heads: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly hourlyMinor?: number;
  readonly note?: string;
}

/** Add a shift the rules did not produce, for a carver or a coat check. */
export function addShift(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  input: AddShiftInput,
  now: string,
): Shift {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const role = input.role.trim().toUpperCase();
  if (!isRole(role)) {
    throw invalidInput('shift.role', `${input.role} is not a role this property rosters`);
  }
  if (!Number.isInteger(input.heads) || input.heads < 1) {
    throw invalidInput('shift.heads', 'a shift is for at least one head');
  }
  if (input.endMinute <= input.startMinute) {
    throw invalidInput('shift.block', 'a shift has to end after it starts');
  }
  const hourly =
    input.hourlyMinor ?? findLabourRate(db, slot.propertyCode, role, slot.serviceDate)?.amount ?? 0;
  if (!Number.isSafeInteger(hourly) || hourly < 0) {
    throw invalidInput('shift.rate', 'an hourly rate is a whole number of minor units');
  }

  return inTransaction(db, (handle) => {
    const id = allocateEntityId(
      handle,
      slot.propertyCode,
      'shift',
      Number(slot.serviceDate.slice(0, 4)),
    );
    handle
      .prepare(
        `insert into shift (id, function_id, role, heads, start_minute, end_minute,
          hourly_minor, created_at, note)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        functionId,
        role,
        input.heads,
        input.startMinute,
        input.endMinute,
        hourly,
        now,
        (input.note ?? '').trim(),
      );
    return requireShift(handle, id, property.currency);
  });
}

export function removeShift(db: Database, id: EntityId<'shift'>): boolean {
  return db.prepare('delete from shift where id = ?').run(id).changes > 0;
}

/** The cost of one shift: head hours at the hourly rate, rounded half up. */
export function shiftCost(shift: Shift): Money {
  const minutes = (shift.endMinute - shift.startMinute) * shift.heads;
  return money(divideRound(shift.hourly.amount * minutes, 60, 'half-up'), shift.hourly.currency);
}

export interface RosterSummary {
  readonly heads: number;
  readonly headHours: number;
  readonly cost: Money;
  readonly unpriced: Role[];
}

export function rosterSummary(db: Database, functionId: EntityId<'functionSlot'>): RosterSummary {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const shifts = listShifts(db, functionId);
  return {
    heads: shifts.reduce((total, shift) => total + shift.heads, 0),
    headHours: shifts.reduce((total, shift) => total + shiftHeadHours(shift), 0),
    cost: sumMoney(shifts.map(shiftCost), property.currency),
    unpriced: shifts.filter((shift) => shift.hourly.amount === 0).map((shift) => shift.role),
  };
}

/** What one more head of a role would cost on this function. */
export function marginalHeadCost(shift: Shift): Money {
  return scaleMoney(shiftCost({ ...shift, heads: 1 }), 1);
}
