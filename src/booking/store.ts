/**
 * Reading and writing bookings.
 *
 * A booking is created as an inquiry and nothing else. Every move away from
 * that goes through the transition rules, so this file deliberately has no
 * setter for status, and the audit trail is written by the same call that
 * makes the change rather than by a caller who might forget.
 */

import { calendarDate, compareCalendarDates, type CalendarDate } from '../core/calendar.js';
import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, parseEntityId, type CatalogCode, type EntityId } from '../core/ids.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import { allocateEntityId } from '../store/sequence.js';
import { requireAccount } from './accounts.js';
import { isBookingStatus, type Booking, type BookingEvent, type BookingStatus } from './types.js';

interface BookingRow {
  id: string;
  property_code: string;
  account_code: string | null;
  post_as: string;
  sales_manager: string;
  status: string;
  arrival_date: string;
  departure_date: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  cancel_reason: string | null;
}

export function toBooking(row: BookingRow): Booking {
  return {
    id: parseEntityId('booking', row.id),
    propertyCode: catalogCode(row.property_code),
    accountCode: row.account_code === null ? undefined : catalogCode(row.account_code),
    postAs: row.post_as,
    salesManager: row.sales_manager,
    status: row.status as BookingStatus,
    arrivalDate: calendarDate(row.arrival_date),
    departureDate: calendarDate(row.departure_date),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at ?? undefined,
    cancelReason: row.cancel_reason ?? undefined,
  };
}

export interface CreateBookingInput {
  readonly postAs: string;
  readonly arrivalDate: string;
  readonly departureDate: string;
  readonly accountCode?: string;
  readonly salesManager?: string;
}

export function createBooking(
  db: Database,
  propertyCode: CatalogCode,
  input: CreateBookingInput,
  now: string,
): Booking {
  requireProperty(db, propertyCode);
  const postAs = input.postAs.trim();
  if (postAs.length === 0) {
    throw invalidInput('booking.postAs', 'a booking needs a name for the reader board');
  }
  if (postAs.length > 60) {
    throw invalidInput('booking.postAs', 'the reader board takes sixty characters, no more');
  }
  const arrival = calendarDate(input.arrivalDate);
  const departure = calendarDate(input.departureDate);
  if (compareCalendarDates(departure, arrival) < 0) {
    throw invalidInput('booking.dates', `${departure} falls before the arrival on ${arrival}`);
  }
  const accountCode = input.accountCode === undefined ? undefined : catalogCode(input.accountCode);
  if (accountCode !== undefined) {
    requireAccount(db, propertyCode, accountCode);
  }

  return inTransaction(db, (handle) => {
    const year = Number(arrival.slice(0, 4));
    const id = allocateEntityId(handle, propertyCode, 'booking', year);
    handle
      .prepare(
        `insert into booking (id, property_code, account_code, post_as, sales_manager, status,
          arrival_date, departure_date, created_at, updated_at)
         values (?, ?, ?, ?, ?, 'INQUIRY', ?, ?, ?, ?)`,
      )
      .run(
        id,
        propertyCode,
        accountCode ?? null,
        postAs,
        (input.salesManager ?? '').trim(),
        arrival,
        departure,
        now,
        now,
      );
    recordEvent(handle, id, now, input.salesManager ?? 'system', 'created', postAs);
    return requireBooking(handle, id);
  });
}

export function findBooking(db: Database, id: EntityId<'booking'>): Booking | undefined {
  const row = db.prepare<[string], BookingRow>('select * from booking where id = ?').get(id);
  return row === undefined ? undefined : toBooking(row);
}

export function requireBooking(db: Database, id: EntityId<'booking'>): Booking {
  const found = findBooking(db, id);
  if (found === undefined) {
    throw notFound('booking.missing', id, `booking ${id} is not on file`);
  }
  return found;
}

export interface BookingQuery {
  readonly status?: string;
  readonly accountCode?: string;
  readonly from?: string;
  readonly to?: string;
}

export function listBookings(
  db: Database,
  propertyCode: CatalogCode,
  query: BookingQuery = {},
): Booking[] {
  const clauses = ['property_code = ?'];
  const params: (string | number)[] = [propertyCode];

  if (query.status !== undefined) {
    const status = query.status.trim().toUpperCase();
    if (!isBookingStatus(status)) {
      throw invalidInput('booking.status', `${query.status} is not a booking status`);
    }
    clauses.push('status = ?');
    params.push(status);
  }
  if (query.accountCode !== undefined) {
    clauses.push('account_code = ?');
    params.push(catalogCode(query.accountCode));
  }
  if (query.from !== undefined) {
    clauses.push('departure_date >= ?');
    params.push(calendarDate(query.from));
  }
  if (query.to !== undefined) {
    clauses.push('arrival_date <= ?');
    params.push(calendarDate(query.to));
  }

  return db
    .prepare<(string | number)[], BookingRow>(
      `select * from booking where ${clauses.join(' and ')} order by arrival_date, id`,
    )
    .all(...params)
    .map(toBooking);
}

export interface UpdateBookingInput {
  readonly postAs?: string;
  readonly salesManager?: string;
  readonly accountCode?: string | null;
  readonly arrivalDate?: string;
  readonly departureDate?: string;
}

export function updateBooking(
  db: Database,
  id: EntityId<'booking'>,
  input: UpdateBookingInput,
  now: string,
  actor = 'system',
): Booking {
  const booking = requireBooking(db, id);
  if (booking.status === 'CANCELLED' || booking.status === 'CLOSED') {
    throw conflict(
      'booking.finished',
      `booking ${id} is ${booking.status.toLowerCase()} and cannot be edited`,
      id,
    );
  }

  const postAs = input.postAs === undefined ? booking.postAs : input.postAs.trim();
  if (postAs.length === 0) {
    throw invalidInput('booking.postAs', 'a booking needs a name for the reader board');
  }
  if (postAs.length > 60) {
    throw invalidInput('booking.postAs', 'the reader board takes sixty characters, no more');
  }

  const arrival =
    input.arrivalDate === undefined ? booking.arrivalDate : calendarDate(input.arrivalDate);
  const departure =
    input.departureDate === undefined ? booking.departureDate : calendarDate(input.departureDate);
  if (compareCalendarDates(departure, arrival) < 0) {
    throw invalidInput('booking.dates', `${departure} falls before the arrival on ${arrival}`);
  }

  let accountCode = booking.accountCode ?? null;
  if (input.accountCode !== undefined) {
    if (input.accountCode === null) {
      accountCode = null;
    } else {
      const code = catalogCode(input.accountCode);
      requireAccount(db, booking.propertyCode, code);
      accountCode = code;
    }
  }

  return inTransaction(db, (handle) => {
    handle
      .prepare(
        `update booking set post_as = ?, sales_manager = ?, account_code = ?,
          arrival_date = ?, departure_date = ?, updated_at = ? where id = ?`,
      )
      .run(
        postAs,
        input.salesManager === undefined ? booking.salesManager : input.salesManager.trim(),
        accountCode,
        arrival,
        departure,
        now,
        id,
      );
    recordEvent(
      handle,
      id,
      now,
      actor,
      'edited',
      describeChange(booking, { postAs, arrival, departure }),
    );
    return requireBooking(handle, id);
  });
}

function describeChange(
  before: Booking,
  after: { postAs: string; arrival: CalendarDate; departure: CalendarDate },
): string {
  const notes: string[] = [];
  if (before.postAs !== after.postAs) {
    notes.push(`post as ${before.postAs} to ${after.postAs}`);
  }
  if (before.arrivalDate !== after.arrival) {
    notes.push(`arrival ${before.arrivalDate} to ${after.arrival}`);
  }
  if (before.departureDate !== after.departure) {
    notes.push(`departure ${before.departureDate} to ${after.departure}`);
  }
  return notes.join(', ');
}

export function recordEvent(
  db: Database,
  bookingId: EntityId<'booking'>,
  occurredAt: string,
  actor: string,
  kind: string,
  detail = '',
): void {
  db.prepare(
    'insert into booking_event (booking_id, occurred_at, actor, kind, detail) values (?, ?, ?, ?, ?)',
  ).run(bookingId, occurredAt, actor.trim() || 'system', kind, detail);
}

export function listEvents(db: Database, bookingId: EntityId<'booking'>): BookingEvent[] {
  return db
    .prepare<
      [string],
      {
        seq: number;
        booking_id: string;
        occurred_at: string;
        actor: string;
        kind: string;
        detail: string;
      }
    >('select * from booking_event where booking_id = ? order by seq')
    .all(bookingId)
    .map((row) => ({
      seq: row.seq,
      bookingId: parseEntityId('booking', row.booking_id),
      occurredAt: row.occurred_at,
      actor: row.actor,
      kind: row.kind,
      detail: row.detail,
    }));
}
