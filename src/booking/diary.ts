/**
 * The diary, and what stops two functions sitting on top of each other.
 *
 * A function occupies its room for longer than it runs. The crew needs the
 * setup time in front of it and the teardown time behind it, and the airwall
 * means a booking in the combined ballroom occupies both halves. Two functions
 * clash when those two things are both true at once: their rooms share a
 * physical space, and their occupied windows overlap.
 *
 * Windows are held as absolute minutes from a fixed date so a reception that
 * runs to one in the morning compares correctly with a breakfast the next day.
 */

import { addDays, calendarDate, daysBetween, type CalendarDate } from '../core/calendar.js';
import { conflict } from '../core/errors.js';
import { catalogCode, type CatalogCode, type EntityId } from '../core/ids.js';
import { physicalFootprint } from '../property/combinations.js';
import { requireSpace } from '../property/store.js';
import type { Database } from '../store/database.js';
import { holdsSpace, type FunctionSlot } from './types.js';

const EPOCH = calendarDate('2000-01-01');

export interface OccupiedWindow {
  readonly from: number;
  readonly to: number;
}

export function absoluteMinute(date: CalendarDate, minute: number): number {
  return daysBetween(EPOCH, date) * 1440 + minute;
}

/**
 * The block the room is actually unavailable for, setup and teardown included.
 */
export function occupiedWindow(
  db: Database,
  slot: Pick<
    FunctionSlot,
    'propertyCode' | 'spaceCode' | 'serviceDate' | 'startMinute' | 'endMinute'
  >,
): OccupiedWindow {
  const space = requireSpace(db, slot.propertyCode, slot.spaceCode);
  return {
    from: absoluteMinute(slot.serviceDate, slot.startMinute) - space.setupMinutes,
    to: absoluteMinute(slot.serviceDate, slot.endMinute) + space.teardownMinutes,
  };
}

export function windowsOverlap(left: OccupiedWindow, right: OccupiedWindow): boolean {
  return left.from < right.to && right.from < left.to;
}

interface SlotRow {
  id: string;
  booking_id: string;
  property_code: string;
  space_code: string;
  name: string;
  service_date: string;
  start_minute: number;
  end_minute: number;
  setup_style: string;
  service_style: string;
  expected_covers: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowsForWindow(db: Database, propertyCode: CatalogCode, date: CalendarDate): SlotRow[] {
  // A function on the previous day can run into this one, and a function on
  // this one can run into the next, so the query has to reach a day either way.
  return db
    .prepare<[string, string, string], SlotRow>(
      `select * from function_slot
       where property_code = ? and service_date between ? and ?
       order by service_date, start_minute, id`,
    )
    .all(propertyCode, addDays(date, -1), addDays(date, 1));
}

export interface DiaryClash {
  readonly slotId: EntityId<'functionSlot'>;
  readonly bookingId: EntityId<'booking'>;
  readonly spaceCode: CatalogCode;
  readonly sharedSpaces: CatalogCode[];
  readonly name: string;
}

export interface ProposedFunction {
  readonly propertyCode: CatalogCode;
  readonly spaceCode: CatalogCode;
  readonly serviceDate: CalendarDate;
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * Everything already in the diary that a proposed function would collide with.
 * `ignoreSlotId` lets a function be moved without clashing with itself.
 */
export function findClashes(
  db: Database,
  proposed: ProposedFunction,
  ignoreSlotId?: EntityId<'functionSlot'>,
): DiaryClash[] {
  const footprint = new Set(physicalFootprint(db, proposed.propertyCode, proposed.spaceCode));
  const window = occupiedWindow(db, proposed);
  const clashes: DiaryClash[] = [];

  for (const row of rowsForWindow(db, proposed.propertyCode, proposed.serviceDate)) {
    if (row.id === ignoreSlotId) {
      continue;
    }
    if (!holdsSpace(row.status as FunctionSlot['status'])) {
      continue;
    }
    const otherCode = catalogCode(row.space_code);
    const shared = physicalFootprint(db, proposed.propertyCode, otherCode).filter((part) =>
      footprint.has(part),
    );
    if (shared.length === 0) {
      continue;
    }
    const otherWindow = occupiedWindow(db, {
      propertyCode: proposed.propertyCode,
      spaceCode: otherCode,
      serviceDate: calendarDate(row.service_date),
      startMinute: row.start_minute,
      endMinute: row.end_minute,
    });
    if (!windowsOverlap(window, otherWindow)) {
      continue;
    }
    clashes.push({
      slotId: row.id as EntityId<'functionSlot'>,
      bookingId: row.booking_id as EntityId<'booking'>,
      spaceCode: otherCode,
      sharedSpaces: shared,
      name: row.name,
    });
  }

  return clashes;
}

export function assertNoClash(
  db: Database,
  proposed: ProposedFunction,
  ignoreSlotId?: EntityId<'functionSlot'>,
): void {
  const clashes = findClashes(db, proposed, ignoreSlotId);
  if (clashes.length === 0) {
    return;
  }
  const first = clashes[0];
  if (first === undefined) {
    return;
  }
  throw conflict(
    'diary.clash',
    `${proposed.spaceCode} on ${proposed.serviceDate} is already taken by ${first.slotId} (${first.name}) in ${first.spaceCode}`,
    proposed.spaceCode,
  );
}

/** Everything in the diary on one date, in the order a function board prints it. */
export function functionsOnDate(
  db: Database,
  propertyCode: CatalogCode,
  date: CalendarDate,
): FunctionSlot[] {
  return db
    .prepare<[string, string], SlotRow>(
      `select * from function_slot
       where property_code = ? and service_date = ?
       order by start_minute, space_code, id`,
    )
    .all(propertyCode, date)
    .map((row) => ({
      id: row.id as EntityId<'functionSlot'>,
      bookingId: row.booking_id as EntityId<'booking'>,
      propertyCode: catalogCode(row.property_code),
      spaceCode: catalogCode(row.space_code),
      name: row.name,
      serviceDate: calendarDate(row.service_date),
      startMinute: row.start_minute,
      endMinute: row.end_minute,
      setupStyle: row.setup_style as FunctionSlot['setupStyle'],
      serviceStyle: row.service_style as FunctionSlot['serviceStyle'],
      expectedCovers: row.expected_covers,
      status: row.status as FunctionSlot['status'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}
