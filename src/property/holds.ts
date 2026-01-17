/**
 * Tentative space.
 *
 * Nothing in a sales office is ever confirmed when it is first asked about.
 * The client wants the ballroom in March, the house says yes, and neither side
 * signs anything for a month. The room is not free and it is not sold, and a
 * diary that only knows those two states will sell it twice.
 *
 * So a hold is ranked. First hold has the room. Second hold has the right to
 * be told when somebody else wants it, and first hold then has until a stated
 * date to sign or step aside. That challenge is the whole mechanism, and it is
 * why the rank is a number rather than a flag.
 */

import { compareCalendarDates, type CalendarDate } from '../core/calendar.js';
import { conflict, invalidInput, notFound } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { requireProperty, requireSpace } from './store.js';
import { physicalFootprint } from './combinations.js';
import { absoluteMinute, windowsOverlap, type OccupiedWindow } from '../booking/diary.js';
import { requireBooking } from '../booking/store.js';
import { inTransaction, type Database } from '../store/database.js';

export interface SpaceHold {
  readonly id: number;
  readonly propertyCode: CatalogCode;
  readonly spaceCode: CatalogCode;
  readonly bookingId: EntityId<'booking'>;
  readonly serviceDate: CalendarDate;
  readonly startMinute: number;
  readonly endMinute: number;
  /** One is first hold. Two is second, and so on down. */
  readonly rank: number;
  readonly holdsUntil: CalendarDate;
  readonly releasedAt: string | undefined;
  readonly note: string;
  readonly createdAt: string;
}

interface HoldRow {
  readonly id: number;
  readonly property_code: string;
  readonly space_code: string;
  readonly booking_id: string;
  readonly service_date: string;
  readonly start_minute: number;
  readonly end_minute: number;
  readonly rank: number;
  readonly holds_until: string;
  readonly released_at: string | null;
  readonly note: string;
  readonly created_at: string;
}

function toHold(row: HoldRow): SpaceHold {
  return {
    id: row.id,
    propertyCode: row.property_code as CatalogCode,
    spaceCode: row.space_code as CatalogCode,
    bookingId: row.booking_id as EntityId<'booking'>,
    serviceDate: row.service_date as CalendarDate,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    rank: row.rank,
    holdsUntil: row.holds_until as CalendarDate,
    releasedAt: row.released_at ?? undefined,
    note: row.note,
    createdAt: row.created_at,
  };
}

function windowOf(
  db: Database,
  hold: Pick<SpaceHold, 'propertyCode' | 'spaceCode' | 'serviceDate' | 'startMinute' | 'endMinute'>,
): OccupiedWindow {
  const space = requireSpace(db, hold.propertyCode, hold.spaceCode);
  return {
    from: absoluteMinute(hold.serviceDate, hold.startMinute) - space.setupMinutes,
    to: absoluteMinute(hold.serviceDate, hold.endMinute) + space.teardownMinutes,
  };
}

/** Live holds on a date, first hold first. */
export function holdsOn(
  db: Database,
  propertyCode: CatalogCode,
  serviceDate: CalendarDate,
): SpaceHold[] {
  return db
    .prepare<[string, string], HoldRow>(
      `select * from space_hold
       where property_code = ? and service_date = ? and released_at is null
       order by rank, id`,
    )
    .all(propertyCode, serviceDate)
    .map(toHold);
}

/** Live holds that would collide with a window, whatever their rank. */
export function competingHolds(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
  serviceDate: CalendarDate,
  startMinute: number,
  endMinute: number,
): SpaceHold[] {
  const footprint = new Set(physicalFootprint(db, propertyCode, spaceCode));
  const window = windowOf(db, {
    propertyCode,
    spaceCode,
    serviceDate,
    startMinute,
    endMinute,
  });
  return holdsOn(db, propertyCode, serviceDate).filter((held) => {
    const shared = physicalFootprint(db, propertyCode, held.spaceCode).some((part) =>
      footprint.has(part),
    );
    return shared && windowsOverlap(window, windowOf(db, held));
  });
}

export interface PlaceHoldInput {
  readonly spaceCode: CatalogCode;
  readonly bookingId: EntityId<'booking'>;
  readonly serviceDate: CalendarDate;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly holdsUntil: CalendarDate;
  readonly note?: string;
}

/**
 * Take a hold, ranked behind whatever is already on the space.
 *
 * The rank is assigned rather than asked for. A salesperson who could name
 * their own rank would name first every time, and the second hold that matters
 * is the one that knows it is second.
 */
export function placeHold(
  db: Database,
  propertyCode: CatalogCode,
  input: PlaceHoldInput,
  now: string,
): SpaceHold {
  requireProperty(db, propertyCode);
  requireSpace(db, propertyCode, input.spaceCode);
  const booking = requireBooking(db, input.bookingId);
  if (booking.propertyCode !== propertyCode) {
    throw invalidInput('hold.property', `booking ${booking.id} is not at ${propertyCode}`);
  }
  if (input.endMinute <= input.startMinute) {
    throw invalidInput('hold.window', 'a hold ends after it starts');
  }
  if (compareCalendarDates(input.holdsUntil, input.serviceDate) > 0) {
    throw invalidInput(
      'hold.until',
      'a hold cannot run past the date it is holding, there would be nothing left to sign',
    );
  }

  return inTransaction(db, (handle) => {
    const competing = competingHolds(
      handle,
      propertyCode,
      input.spaceCode,
      input.serviceDate,
      input.startMinute,
      input.endMinute,
    );
    if (competing.some((held) => held.bookingId === input.bookingId)) {
      throw conflict(
        'hold.duplicate',
        `booking ${input.bookingId} already holds that space on ${input.serviceDate}`,
        input.bookingId,
      );
    }
    const rank = competing.length + 1;
    const result = handle
      .prepare(
        `insert into space_hold
           (property_code, space_code, booking_id, service_date, start_minute, end_minute,
            rank, holds_until, released_at, note, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?)`,
      )
      .run(
        propertyCode,
        input.spaceCode,
        input.bookingId,
        input.serviceDate,
        input.startMinute,
        input.endMinute,
        rank,
        input.holdsUntil,
        (input.note ?? '').trim(),
        now,
      );
    return requireHold(handle, Number(result.lastInsertRowid));
  });
}

export function findHold(db: Database, id: number): SpaceHold | undefined {
  const row = db.prepare<[number], HoldRow>('select * from space_hold where id = ?').get(id);
  return row === undefined ? undefined : toHold(row);
}

export function requireHold(db: Database, id: number): SpaceHold {
  const found = findHold(db, id);
  if (found === undefined) {
    throw notFound('hold.missing', String(id), `hold ${id} is not on file`);
  }
  return found;
}

export interface ReleaseResult {
  readonly released: SpaceHold;
  readonly promoted: SpaceHold[];
}

/**
 * Let a hold go, and move everybody behind it up one.
 *
 * The promotion is the point. A second hold that stays second after first hold
 * walks away is a room the house believes is taken and nobody has.
 */
export function releaseHold(db: Database, id: number, now: string): ReleaseResult {
  const hold = requireHold(db, id);
  if (hold.releasedAt !== undefined) {
    throw conflict('hold.released', `hold ${id} was already released`, String(id));
  }
  return inTransaction(db, (handle) => {
    handle.prepare('update space_hold set released_at = ? where id = ?').run(now, id);
    const behind = competingHolds(
      handle,
      hold.propertyCode,
      hold.spaceCode,
      hold.serviceDate,
      hold.startMinute,
      hold.endMinute,
    ).filter((each) => each.rank > hold.rank);
    for (const each of behind) {
      handle.prepare('update space_hold set rank = ? where id = ?').run(each.rank - 1, each.id);
    }
    return {
      released: requireHold(handle, id),
      promoted: behind.map((each) => requireHold(handle, each.id)),
    };
  });
}

export interface Challenge {
  readonly challenger: SpaceHold;
  readonly incumbent: SpaceHold | undefined;
  readonly decideBy: CalendarDate;
}

/**
 * Second hold wants the room. First hold is told, and given until a date to
 * sign. Nothing moves here; the clock is the whole of it, and the release is a
 * separate decision somebody has to make.
 */
export function challengeHold(db: Database, id: number, decideBy: CalendarDate): Challenge {
  const challenger = requireHold(db, id);
  if (challenger.rank === 1) {
    throw conflict(
      'hold.first',
      `hold ${id} is already first on that space, there is nobody to challenge`,
      String(id),
    );
  }
  const incumbent = competingHolds(
    db,
    challenger.propertyCode,
    challenger.spaceCode,
    challenger.serviceDate,
    challenger.startMinute,
    challenger.endMinute,
  ).find((each) => each.rank === challenger.rank - 1);
  if (incumbent !== undefined && compareCalendarDates(decideBy, incumbent.serviceDate) > 0) {
    throw invalidInput('hold.decide', 'a decision date cannot fall after the function itself');
  }
  return { challenger, incumbent, decideBy };
}

/** Holds whose own date has run out, for the sales office to sweep up. */
export function lapsedHolds(
  db: Database,
  propertyCode: CatalogCode,
  asOf: CalendarDate,
): SpaceHold[] {
  return db
    .prepare<[string, string], HoldRow>(
      `select * from space_hold
       where property_code = ? and released_at is null and holds_until < ?
       order by holds_until, rank, id`,
    )
    .all(propertyCode, asOf)
    .map(toHold);
}
