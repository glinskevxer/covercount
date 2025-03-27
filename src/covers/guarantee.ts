/**
 * The guarantee.
 *
 * This is the rule the whole build turns on. The client names a number of
 * covers before a deadline. Before the deadline the number moves either way.
 * After it the number can only go up, because the kitchen has already bought
 * against it. The room is set above the guarantee by the house overset, capped,
 * and the invoice bills the greater of the guarantee and what was served.
 *
 * A cover count is opened per function rather than per booking. A three day
 * conference guarantees each of its dinners separately and they have different
 * deadlines whenever a weekend or a holiday falls between them.
 */

import { calendarDate, type CalendarDate } from '../core/calendar.js';
import { toInstant, type ZonedDateTime } from '../core/clock.js';
import { conflict, deadlinePassed, invalidInput, notFound, ruleViolation } from '../core/errors.js';
import { catalogCode, type CatalogCode, type EntityId } from '../core/ids.js';
import { PPM, type Rate } from '../core/rate.js';
import { divideRound } from '../core/rounding.js';
import { requireFunction } from '../booking/functions.js';
import { requireBooking } from '../booking/store.js';
import { isFinished } from '../booking/types.js';
import { requirePackage } from '../catalog/packages.js';
import { requirePriceBook } from '../catalog/pricing.js';
import { listCalendarEntries, requireProperty } from '../property/store.js';
import { assertFits } from '../booking/functions.js';
import { inTransaction, type Database } from '../store/database.js';
import { guaranteeDeadlineFor, officeCalendar } from './deadline.js';

export interface FunctionCovers {
  readonly functionId: EntityId<'functionSlot'>;
  readonly packageCode: CatalogCode | undefined;
  readonly priceBookCode: CatalogCode | undefined;
  readonly contractDate: CalendarDate;
  readonly guaranteeDue: ZonedDateTime;
  readonly guaranteedCovers: number | undefined;
  readonly guaranteedAt: string | undefined;
  readonly servedCovers: number | undefined;
  readonly servedAt: string | undefined;
  readonly setCovers: number | undefined;
}

export interface CoverMovement {
  readonly seq: number;
  readonly occurredAt: string;
  readonly actor: string;
  readonly fromCovers: number | undefined;
  readonly toCovers: number;
  readonly afterCutoff: boolean;
  readonly note: string;
}

interface CoverRow {
  function_id: string;
  package_code: string | null;
  price_book_code: string | null;
  contract_date: string;
  guarantee_due_date: string;
  guarantee_due_minute: number;
  guaranteed_covers: number | null;
  guaranteed_at: string | null;
  served_covers: number | null;
  served_at: string | null;
  set_covers: number | null;
}

function toCovers(row: CoverRow, zone: ZonedDateTime['zone']): FunctionCovers {
  return {
    functionId: row.function_id as EntityId<'functionSlot'>,
    packageCode: row.package_code === null ? undefined : catalogCode(row.package_code),
    priceBookCode: row.price_book_code === null ? undefined : catalogCode(row.price_book_code),
    contractDate: calendarDate(row.contract_date),
    guaranteeDue: {
      date: calendarDate(row.guarantee_due_date),
      time: row.guarantee_due_minute as ZonedDateTime['time'],
      zone,
    },
    guaranteedCovers: row.guaranteed_covers ?? undefined,
    guaranteedAt: row.guaranteed_at ?? undefined,
    servedCovers: row.served_covers ?? undefined,
    servedAt: row.served_at ?? undefined,
    setCovers: row.set_covers ?? undefined,
  };
}

export interface OpenCoversInput {
  readonly packageCode?: string;
  readonly priceBookCode?: string;
  readonly contractDate: string;
}

export function openCovers(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  input: OpenCoversInput,
): FunctionCovers {
  const slot = requireFunction(db, functionId);
  const booking = requireBooking(db, slot.bookingId);
  if (isFinished(booking.status)) {
    throw conflict(
      'booking.finished',
      `booking ${booking.id} is ${booking.status.toLowerCase()}`,
      booking.id,
    );
  }
  const existing = db
    .prepare<
      [string],
      { function_id: string }
    >('select function_id from function_cover where function_id = ?')
    .get(functionId);
  if (existing !== undefined) {
    throw conflict('covers.open', `${functionId} already has a cover count open`, functionId);
  }

  const property = requireProperty(db, slot.propertyCode);
  const contractDate = calendarDate(input.contractDate);
  const packageCode = input.packageCode === undefined ? undefined : catalogCode(input.packageCode);
  if (packageCode !== undefined) {
    const chosen = requirePackage(db, slot.propertyCode, packageCode);
    if (chosen.serviceStyle !== slot.serviceStyle) {
      throw invalidInput(
        'covers.package',
        `${packageCode} is a ${chosen.serviceStyle} package and ${functionId} is ${slot.serviceStyle}`,
      );
    }
  }
  const priceBookCode =
    input.priceBookCode === undefined ? undefined : catalogCode(input.priceBookCode);
  if (priceBookCode !== undefined) {
    requirePriceBook(db, slot.propertyCode, priceBookCode);
  }

  const calendar = officeCalendar(listCalendarEntries(db, slot.propertyCode, 'office'));
  const due = guaranteeDeadlineFor(property, slot.serviceDate, calendar);

  db.prepare(
    `insert into function_cover (function_id, package_code, price_book_code, contract_date,
      guarantee_due_date, guarantee_due_minute)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(functionId, packageCode ?? null, priceBookCode ?? null, contractDate, due.date, due.time);

  return requireCovers(db, functionId);
}

export function findCovers(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): FunctionCovers | undefined {
  const row = db
    .prepare<[string], CoverRow>('select * from function_cover where function_id = ?')
    .get(functionId);
  if (row === undefined) {
    return undefined;
  }
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  return toCovers(row, property.timeZone);
}

export function requireCovers(db: Database, functionId: EntityId<'functionSlot'>): FunctionCovers {
  const found = findCovers(db, functionId);
  if (found === undefined) {
    throw notFound('covers.missing', functionId, `${functionId} has no cover count open`);
  }
  return found;
}

/**
 * How far above the guarantee the room is set. The overset is a rate on the
 * guarantee, rounded up because half a cover is a whole place setting, and
 * capped by the property so a thousand cover function does not get fifty
 * spare chairs it will never use.
 */
export function oversetFor(guaranteed: number, rate: Rate, cap: number): number {
  if (!Number.isInteger(guaranteed) || guaranteed < 0) {
    throw invalidInput('covers.count', 'a guarantee is a whole count of covers');
  }
  return Math.min(divideRound(guaranteed * rate.ppm, PPM, 'up'), cap);
}

export function setCoversFor(guaranteed: number, rate: Rate, cap: number): number {
  return guaranteed + oversetFor(guaranteed, rate, cap);
}

export interface SetGuaranteeOptions {
  readonly note?: string;
  /** Let a manager lower the count after the deadline, on the record. */
  readonly overrideCutoff?: boolean;
}

/**
 * Move the guarantee. Before the deadline it goes either way. After it the
 * number may only rise, unless somebody with the authority to do it says
 * otherwise and the movement records that they did.
 */
export function setGuarantee(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  covers: number,
  now: string,
  actor = 'system',
  options: SetGuaranteeOptions = {},
): FunctionCovers {
  const current = requireCovers(db, functionId);
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);

  if (!Number.isInteger(covers) || covers < 0) {
    throw invalidInput('covers.count', 'a guarantee is a whole count of covers');
  }
  if (slot.status === 'CANCELLED' || slot.status === 'RELEASED') {
    throw conflict(
      'covers.released',
      `${functionId} is ${slot.status.toLowerCase()} and takes no guarantee`,
      functionId,
    );
  }

  const setCovers = setCoversFor(covers, property.oversetRate, property.oversetCap);
  assertFits(db, slot.propertyCode, slot.spaceCode, slot.setupStyle, setCovers);

  const passed = Date.parse(now) >= toInstant(current.guaranteeDue);
  const previous = current.guaranteedCovers;
  if (passed && previous !== undefined && covers < previous && options.overrideCutoff !== true) {
    throw deadlinePassed(
      'covers.lower',
      `the guarantee for ${functionId} closed on ${current.guaranteeDue.date} and cannot be lowered from ${previous} to ${covers}`,
      'raise it instead, or override the cutoff on the record',
    );
  }

  return inTransaction(db, (handle) => {
    handle
      .prepare(
        `update function_cover set guaranteed_covers = ?, guaranteed_at = ?, set_covers = ?
         where function_id = ?`,
      )
      .run(covers, now, setCovers, functionId);
    handle
      .prepare(
        `insert into cover_movement (function_id, occurred_at, actor, from_covers, to_covers,
          after_cutoff, note)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        functionId,
        now,
        actor.trim() || 'system',
        previous ?? null,
        covers,
        passed ? 1 : 0,
        options.note ?? '',
      );
    return requireCovers(handle, functionId);
  });
}

/** What the kitchen actually served, counted at the pass on the night. */
export function recordServed(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  covers: number,
  now: string,
): FunctionCovers {
  const current = requireCovers(db, functionId);
  if (!Number.isInteger(covers) || covers < 0) {
    throw invalidInput('covers.served', 'a served count is a whole count of covers');
  }
  if (current.guaranteedCovers === undefined) {
    throw ruleViolation(
      'covers.ungaranteed',
      `${functionId} was never guaranteed, so there is nothing to reconcile the served count against`,
    );
  }
  db.prepare(
    'update function_cover set served_covers = ?, served_at = ? where function_id = ?',
  ).run(covers, now, functionId);
  return requireCovers(db, functionId);
}

/** The number the invoice bills: the greater of the guarantee and what went out. */
export function billedCovers(covers: FunctionCovers): number {
  if (covers.guaranteedCovers === undefined) {
    throw ruleViolation('covers.unguaranteed', 'a function with no guarantee cannot be billed');
  }
  return Math.max(covers.guaranteedCovers, covers.servedCovers ?? 0);
}

/** Covers served over the guarantee, which is what the kitchen absorbed. */
export function overageCovers(covers: FunctionCovers): number {
  if (covers.guaranteedCovers === undefined || covers.servedCovers === undefined) {
    return 0;
  }
  return Math.max(0, covers.servedCovers - covers.guaranteedCovers);
}

/** Covers guaranteed that never turned up, which the client pays for anyway. */
export function shortfallCovers(covers: FunctionCovers): number {
  if (covers.guaranteedCovers === undefined || covers.servedCovers === undefined) {
    return 0;
  }
  return Math.max(0, covers.guaranteedCovers - covers.servedCovers);
}

export function listMovements(db: Database, functionId: EntityId<'functionSlot'>): CoverMovement[] {
  return db
    .prepare<
      [string],
      {
        seq: number;
        occurred_at: string;
        actor: string;
        from_covers: number | null;
        to_covers: number;
        after_cutoff: number;
        note: string;
      }
    >('select * from cover_movement where function_id = ? order by seq')
    .all(functionId)
    .map((row) => ({
      seq: row.seq,
      occurredAt: row.occurred_at,
      actor: row.actor,
      fromCovers: row.from_covers ?? undefined,
      toCovers: row.to_covers,
      afterCutoff: row.after_cutoff === 1,
      note: row.note,
    }));
}

/** The guarantee as it stood when the deadline passed, for the controller. */
export function guaranteeAtCutoff(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): number | undefined {
  const covers = requireCovers(db, functionId);
  const cutoff = toInstant(covers.guaranteeDue);
  let standing: number | undefined;
  for (const movement of listMovements(db, functionId)) {
    if (Date.parse(movement.occurredAt) < cutoff) {
      standing = movement.toCovers;
    }
  }
  return standing;
}
