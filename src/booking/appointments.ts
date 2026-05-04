/**
 * The meetings that happen before the event.
 *
 * A tasting, a site visit and a pre convention meeting are all the same shape
 * and they are not the same thing, which is why the kind is on the row rather
 * than in three tables. What differs is when each one is allowed to sit.
 *
 * A tasting has to be before the menu is locked, and the menu is locked when
 * the guarantee closes: a client who tastes the halibut two days out cannot
 * change to the beef, so the tasting was theatre. A site visit can be any time
 * up to the day itself. A pre convention meeting is the day before or the
 * morning of, and one held three weeks out is a meeting about a plan that will
 * have changed twice by the time it matters.
 *
 * Those three rules are the whole module. Everything else is a row.
 */

import { addDays, compareCalendarDates, daysBetween, type CalendarDate } from '../core/calendar.js';
import { conflict, invalidInput, notFound } from '../core/errors.js';
import { boundedText, LINE, NOTE, singleLine } from '../core/text.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { requireSpace } from '../property/store.js';
import { requireBooking } from './store.js';
import { listFunctions } from './functions.js';
import { holdsSpace } from './types.js';
import type { Database } from '../store/database.js';

export const APPOINTMENT_KINDS = ['TASTING', 'SITE-VISIT', 'PRE-CON', 'PLANNING'] as const;

export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number];

export function isAppointmentKind(value: string): value is AppointmentKind {
  return (APPOINTMENT_KINDS as readonly string[]).includes(value);
}

/**
 * How close to the first function each kind has to sit.
 *
 * Only the pre convention meeting is held to it. The others are free because
 * a client who wants to taste eleven months out is not doing anything wrong,
 * they are just doing it early.
 */
export const EARLIEST_BY_KIND: Record<AppointmentKind, number> = {
  TASTING: 0,
  'SITE-VISIT': 0,
  'PRE-CON': 2,
  PLANNING: 0,
};

export interface Appointment {
  readonly id: number;
  readonly bookingId: EntityId<'booking'>;
  readonly kind: AppointmentKind;
  readonly onDate: CalendarDate;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly spaceCode: CatalogCode | undefined;
  readonly attendees: string;
  readonly note: string;
  readonly outcome: string | undefined;
  readonly createdAt: string;
}

interface AppointmentRow {
  readonly id: number;
  readonly booking_id: string;
  readonly kind: string;
  readonly on_date: string;
  readonly start_minute: number;
  readonly end_minute: number;
  readonly space_code: string | null;
  readonly attendees: string;
  readonly note: string;
  readonly outcome: string | null;
  readonly created_at: string;
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    bookingId: row.booking_id as EntityId<'booking'>,
    kind: row.kind as AppointmentKind,
    onDate: row.on_date as CalendarDate,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    spaceCode: (row.space_code ?? undefined) as CatalogCode | undefined,
    attendees: row.attendees,
    note: row.note,
    outcome: row.outcome ?? undefined,
    createdAt: row.created_at,
  };
}

/** The first function on the booking that still holds space. */
function firstServiceDate(db: Database, bookingId: EntityId<'booking'>): CalendarDate | undefined {
  const held = listFunctions(db, bookingId).filter((slot) => holdsSpace(slot.status));
  return held[0]?.serviceDate;
}

export interface BookAppointmentInput {
  readonly kind: string;
  readonly onDate: CalendarDate;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly spaceCode?: CatalogCode;
  readonly attendees?: string;
  readonly note?: string;
}

export function bookAppointment(
  db: Database,
  bookingId: EntityId<'booking'>,
  input: BookAppointmentInput,
  now: string,
): Appointment {
  const booking = requireBooking(db, bookingId);
  const kind = input.kind.trim().toUpperCase();
  if (!isAppointmentKind(kind)) {
    throw invalidInput(
      'appointment.kind',
      `${input.kind} is not a kind of appointment, use tasting, site-visit, pre-con or planning`,
    );
  }
  if (input.endMinute <= input.startMinute) {
    throw invalidInput('appointment.window', 'an appointment ends after it starts');
  }
  if (input.spaceCode !== undefined) {
    requireSpace(db, booking.propertyCode, input.spaceCode);
  }

  const attendees = singleLine('the attendees', input.attendees ?? '', LINE);
  const note = boundedText('the note', input.note ?? '', NOTE);

  const first = firstServiceDate(db, bookingId);
  if (first !== undefined) {
    if (compareCalendarDates(input.onDate, first) > 0) {
      throw conflict(
        'appointment.late',
        `${kind} on ${input.onDate} falls after the first function on ${first}`,
        bookingId,
      );
    }
    const daysOut = daysBetween(input.onDate, first);
    const earliest = EARLIEST_BY_KIND[kind];
    if (kind === 'PRE-CON' && daysOut > earliest) {
      throw conflict(
        'appointment.early',
        `a pre convention meeting sits within ${earliest} days of the first function, not ${daysOut}`,
        bookingId,
      );
    }
  }

  const result = db
    .prepare(
      `insert into appointment
         (booking_id, kind, on_date, start_minute, end_minute, space_code, attendees, note,
          outcome, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, null, ?)`,
    )
    .run(
      bookingId,
      kind,
      input.onDate,
      input.startMinute,
      input.endMinute,
      input.spaceCode ?? null,
      attendees,
      note,
      now,
    );
  return requireAppointment(db, Number(result.lastInsertRowid));
}

export function findAppointment(db: Database, id: number): Appointment | undefined {
  const row = db
    .prepare<[number], AppointmentRow>('select * from appointment where id = ?')
    .get(id);
  return row === undefined ? undefined : toAppointment(row);
}

export function requireAppointment(db: Database, id: number): Appointment {
  const found = findAppointment(db, id);
  if (found === undefined) {
    throw notFound('appointment.missing', String(id), `appointment ${id} is not on file`);
  }
  return found;
}

export function listAppointments(db: Database, bookingId: EntityId<'booking'>): Appointment[] {
  return db
    .prepare<
      [string],
      AppointmentRow
    >('select * from appointment where booking_id = ? order by on_date, start_minute, id')
    .all(bookingId)
    .map(toAppointment);
}

/** Write down what came out of it, which is the only reason to keep the row. */
export function recordOutcome(db: Database, id: number, outcome: string): Appointment {
  requireAppointment(db, id);
  const said = boundedText('an outcome', outcome, NOTE, {
    required: true,
    code: 'appointment.outcome',
  });
  db.prepare('update appointment set outcome = ? where id = ?').run(said, id);
  return requireAppointment(db, id);
}

export function cancelAppointment(db: Database, id: number): boolean {
  return db.prepare('delete from appointment where id = ?').run(id).changes > 0;
}

export interface TastingWindow {
  readonly bookingId: EntityId<'booking'>;
  readonly firstService: CalendarDate;
  /** The last date a tasting still changes anything. */
  readonly closesOn: CalendarDate;
  readonly booked: Appointment[];
  readonly tooLate: Appointment[];
}

/**
 * When a tasting still means something.
 *
 * The window closes with the guarantee, because after that the menu is what
 * the kitchen has already ordered against. A tasting inside the window is
 * useful; one outside it is a nice lunch.
 */
export function tastingWindow(db: Database, bookingId: EntityId<'booking'>): TastingWindow {
  const booking = requireBooking(db, bookingId);
  const first = firstServiceDate(db, bookingId);
  if (first === undefined) {
    throw conflict(
      'appointment.nofunction',
      `booking ${bookingId} holds no space, so there is nothing to taste for`,
      bookingId,
    );
  }
  const property = db
    .prepare<
      [string],
      { guarantee_lead_days: number }
    >('select guarantee_lead_days from property where code = ?')
    .get(booking.propertyCode);
  const lead = property?.guarantee_lead_days ?? 0;
  const closesOn = addDays(first, -lead);
  const tastings = listAppointments(db, bookingId).filter((row) => row.kind === 'TASTING');
  return {
    bookingId,
    firstService: first,
    closesOn,
    booked: tastings,
    tooLate: tastings.filter((row) => compareCalendarDates(row.onDate, closesOn) > 0),
  };
}
