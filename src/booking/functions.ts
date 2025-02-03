/**
 * The individual functions inside a booking.
 *
 * A function names a room, a date, a block of the clock and a service style,
 * and everything downstream keys off it. The expected covers here are the
 * salesperson's number, which is not the guarantee and is not what the kitchen
 * cooks to; it exists so the room can be checked against its capacity before
 * anybody has committed to anything.
 */

import { calendarDate } from '../core/calendar.js';
import { capacityExceeded, conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, parseEntityId, type CatalogCode, type EntityId } from '../core/ids.js';
import { requireSpace, spaceCapacities } from '../property/store.js';
import { isServiceStyle, isSetupStyle } from '../property/types.js';
import type { ServiceStyle, SetupStyle } from '../property/types.js';
import { inTransaction, type Database } from '../store/database.js';
import { allocateEntityId } from '../store/sequence.js';
import { assertNoClash } from './diary.js';
import { recordEvent, requireBooking } from './store.js';
import { isFinished, type FunctionSlot, type FunctionStatus } from './types.js';

export const MAX_END_MINUTE = 2160;

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

function toSlot(row: SlotRow): FunctionSlot {
  return {
    id: parseEntityId('functionSlot', row.id),
    bookingId: parseEntityId('booking', row.booking_id),
    propertyCode: catalogCode(row.property_code),
    spaceCode: catalogCode(row.space_code),
    name: row.name,
    serviceDate: calendarDate(row.service_date),
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    setupStyle: row.setup_style as SetupStyle,
    serviceStyle: row.service_style as ServiceStyle,
    expectedCovers: row.expected_covers,
    status: row.status as FunctionStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface AddFunctionInput {
  readonly spaceCode: string;
  readonly name: string;
  readonly serviceDate: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly setupStyle: string;
  readonly serviceStyle: string;
  readonly expectedCovers: number;
}

function validateBlock(input: AddFunctionInput): void {
  if (!Number.isInteger(input.startMinute) || input.startMinute < 0 || input.startMinute > 1439) {
    throw invalidInput('function.start', `${input.startMinute} is not a minute of the day`);
  }
  if (!Number.isInteger(input.endMinute)) {
    throw invalidInput('function.end', 'the end of a function is a whole minute');
  }
  if (input.endMinute <= input.startMinute) {
    throw invalidInput('function.block', 'a function has to end after it starts');
  }
  if (input.endMinute > MAX_END_MINUTE) {
    throw invalidInput(
      'function.end',
      `a function cannot run past ${MAX_END_MINUTE - 1440} minutes into the following day`,
    );
  }
  if (input.name.trim().length === 0) {
    throw invalidInput('function.name', 'a function needs a name');
  }
  if (!Number.isInteger(input.expectedCovers) || input.expectedCovers < 0) {
    throw invalidInput('function.covers', 'expected covers is a whole count');
  }
}

export function addFunction(
  db: Database,
  bookingId: EntityId<'booking'>,
  input: AddFunctionInput,
  now: string,
  actor = 'system',
): FunctionSlot {
  const booking = requireBooking(db, bookingId);
  if (isFinished(booking.status)) {
    throw conflict(
      'booking.finished',
      `booking ${bookingId} is ${booking.status.toLowerCase()} and takes no more functions`,
      bookingId,
    );
  }
  validateBlock(input);

  const setupStyle = input.setupStyle.trim().toUpperCase();
  if (!isSetupStyle(setupStyle)) {
    throw invalidInput('function.setup', `${input.setupStyle} is not a setup style`);
  }
  const serviceStyle = input.serviceStyle.trim().toUpperCase();
  if (!isServiceStyle(serviceStyle)) {
    throw invalidInput('function.service', `${input.serviceStyle} is not a service style`);
  }

  const spaceCode = catalogCode(input.spaceCode);
  const space = requireSpace(db, booking.propertyCode, spaceCode);
  if (!space.active) {
    throw conflict('space.inactive', `${spaceCode} is out of service`, spaceCode);
  }
  assertFits(db, booking.propertyCode, spaceCode, setupStyle, input.expectedCovers);

  const date = calendarDate(input.serviceDate);

  assertNoClash(db, {
    propertyCode: booking.propertyCode,
    spaceCode,
    serviceDate: date,
    startMinute: input.startMinute,
    endMinute: input.endMinute,
  });

  return inTransaction(db, (handle) => {
    const id = allocateEntityId(
      handle,
      booking.propertyCode,
      'functionSlot',
      Number(date.slice(0, 4)),
    );
    handle
      .prepare(
        `insert into function_slot (id, booking_id, property_code, space_code, name, service_date,
          start_minute, end_minute, setup_style, service_style, expected_covers, status,
          created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'HELD', ?, ?)`,
      )
      .run(
        id,
        bookingId,
        booking.propertyCode,
        spaceCode,
        input.name.trim(),
        date,
        input.startMinute,
        input.endMinute,
        setupStyle,
        serviceStyle,
        input.expectedCovers,
        now,
        now,
      );
    recordEvent(handle, bookingId, now, actor, 'function-added', `${id} ${spaceCode} ${date}`);
    return requireFunction(handle, id);
  });
}

/** A setup that does not fit the room is refused before the space is held. */
export function assertFits(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
  setupStyle: SetupStyle,
  covers: number,
): void {
  const space = requireSpace(db, propertyCode, spaceCode);
  if (covers > space.fireCapacity) {
    throw capacityExceeded(
      'function.fire',
      `${covers} covers is over the fire capacity of ${space.fireCapacity} in ${spaceCode}`,
      spaceCode,
    );
  }
  const capacity = spaceCapacities(db, propertyCode, spaceCode).find(
    (row) => row.setupStyle === setupStyle,
  );
  if (capacity === undefined) {
    throw invalidInput(
      'function.setup',
      `${spaceCode} has no published capacity for ${setupStyle}, so it cannot be set that way`,
    );
  }
  if (covers > capacity.capacity) {
    throw capacityExceeded(
      'function.capacity',
      `${covers} covers is over the ${setupStyle} capacity of ${capacity.capacity} in ${spaceCode}`,
      spaceCode,
    );
  }
}

export function findFunction(db: Database, id: EntityId<'functionSlot'>): FunctionSlot | undefined {
  const row = db.prepare<[string], SlotRow>('select * from function_slot where id = ?').get(id);
  return row === undefined ? undefined : toSlot(row);
}

export function requireFunction(db: Database, id: EntityId<'functionSlot'>): FunctionSlot {
  const found = findFunction(db, id);
  if (found === undefined) {
    throw notFound('function.missing', id, `function ${id} is not on file`);
  }
  return found;
}

export function listFunctions(db: Database, bookingId: EntityId<'booking'>): FunctionSlot[] {
  return db
    .prepare<
      [string],
      SlotRow
    >('select * from function_slot where booking_id = ? order by service_date, start_minute, id')
    .all(bookingId)
    .map(toSlot);
}

export interface EditFunctionInput {
  readonly name?: string;
  readonly startMinute?: number;
  readonly endMinute?: number;
  readonly setupStyle?: string;
  readonly serviceStyle?: string;
  readonly expectedCovers?: number;
  readonly spaceCode?: string;
  readonly serviceDate?: string;
}

export function editFunction(
  db: Database,
  id: EntityId<'functionSlot'>,
  input: EditFunctionInput,
  now: string,
  actor = 'system',
): FunctionSlot {
  const slot = requireFunction(db, id);
  if (slot.status === 'CANCELLED') {
    throw conflict('function.cancelled', `function ${id} is cancelled`, id);
  }
  const booking = requireBooking(db, slot.bookingId);
  if (isFinished(booking.status)) {
    throw conflict(
      'booking.finished',
      `booking ${slot.bookingId} is ${booking.status.toLowerCase()}`,
      slot.bookingId,
    );
  }

  const merged: AddFunctionInput = {
    spaceCode: input.spaceCode ?? slot.spaceCode,
    name: input.name ?? slot.name,
    serviceDate: input.serviceDate ?? slot.serviceDate,
    startMinute: input.startMinute ?? slot.startMinute,
    endMinute: input.endMinute ?? slot.endMinute,
    setupStyle: input.setupStyle ?? slot.setupStyle,
    serviceStyle: input.serviceStyle ?? slot.serviceStyle,
    expectedCovers: input.expectedCovers ?? slot.expectedCovers,
  };
  validateBlock(merged);

  const setupStyle = merged.setupStyle.trim().toUpperCase();
  if (!isSetupStyle(setupStyle)) {
    throw invalidInput('function.setup', `${merged.setupStyle} is not a setup style`);
  }
  const serviceStyle = merged.serviceStyle.trim().toUpperCase();
  if (!isServiceStyle(serviceStyle)) {
    throw invalidInput('function.service', `${merged.serviceStyle} is not a service style`);
  }
  const spaceCode = catalogCode(merged.spaceCode);
  const space = requireSpace(db, slot.propertyCode, spaceCode);
  if (!space.active) {
    throw conflict('space.inactive', `${spaceCode} is out of service`, spaceCode);
  }
  assertFits(db, slot.propertyCode, spaceCode, setupStyle, merged.expectedCovers);
  const date = calendarDate(merged.serviceDate);

  assertNoClash(
    db,
    {
      propertyCode: slot.propertyCode,
      spaceCode,
      serviceDate: date,
      startMinute: merged.startMinute,
      endMinute: merged.endMinute,
    },
    id,
  );

  return inTransaction(db, (handle) => {
    handle
      .prepare(
        `update function_slot set space_code = ?, name = ?, service_date = ?, start_minute = ?,
          end_minute = ?, setup_style = ?, service_style = ?, expected_covers = ?, updated_at = ?
         where id = ?`,
      )
      .run(
        spaceCode,
        merged.name.trim(),
        date,
        merged.startMinute,
        merged.endMinute,
        setupStyle,
        serviceStyle,
        merged.expectedCovers,
        now,
        id,
      );
    recordEvent(handle, slot.bookingId, now, actor, 'function-edited', id);
    return requireFunction(handle, id);
  });
}

export function setFunctionStatus(
  db: Database,
  id: EntityId<'functionSlot'>,
  status: FunctionStatus,
  now: string,
  actor = 'system',
): FunctionSlot {
  const slot = requireFunction(db, id);
  if (slot.status === status) {
    return slot;
  }
  if (slot.status === 'CANCELLED') {
    throw conflict('function.cancelled', `function ${id} is cancelled and cannot move again`, id);
  }
  return inTransaction(db, (handle) => {
    handle
      .prepare('update function_slot set status = ?, updated_at = ? where id = ?')
      .run(status, now, id);
    recordEvent(
      handle,
      slot.bookingId,
      now,
      actor,
      'function-status',
      `${id} ${slot.status} to ${status}`,
    );
    return requireFunction(handle, id);
  });
}

/** Covers the room has to be set for before anyone guarantees anything. */
export function expectedCoversForBooking(db: Database, bookingId: EntityId<'booking'>): number {
  return listFunctions(db, bookingId)
    .filter((slot) => slot.status === 'HELD' || slot.status === 'DEFINITE')
    .reduce((total, slot) => Math.max(total, slot.expectedCovers), 0);
}
