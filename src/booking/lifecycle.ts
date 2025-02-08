/**
 * How a booking moves, and what has to be true before it does.
 *
 * The move that matters is tentative to definite, because that is the point
 * the hotel starts spending money. It needs an account on the deal, a credit
 * status the controller has not stopped, and at least one function still
 * holding space. Everything held becomes definite in the same breath, so the
 * diary and the deal never disagree about what is sold.
 */

import { compareCalendarDates, type CalendarDate } from '../core/calendar.js';
import { conflict, invalidInput, notPermitted, ruleViolation } from '../core/errors.js';
import type { EntityId } from '../core/ids.js';
import { inTransaction, type Database } from '../store/database.js';
import { canCommitBusiness, requireAccount } from './accounts.js';
import { listFunctions, setFunctionStatus } from './functions.js';
import { recordEvent, requireBooking } from './store.js';
import { holdsSpace, type Booking, type BookingStatus } from './types.js';

export const ALLOWED_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  INQUIRY: ['TENTATIVE', 'CANCELLED'],
  TENTATIVE: ['DEFINITE', 'INQUIRY', 'CANCELLED'],
  DEFINITE: ['CLOSED', 'CANCELLED'],
  CANCELLED: [],
  CLOSED: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] as readonly string[]).includes(to);
}

export interface TransitionOptions {
  readonly reason?: string;
  /** The date the office believes it is, for the closing rule. */
  readonly today?: CalendarDate;
}

export function transitionBooking(
  db: Database,
  id: EntityId<'booking'>,
  to: BookingStatus,
  now: string,
  actor = 'system',
  options: TransitionOptions = {},
): Booking {
  const booking = requireBooking(db, id);
  if (booking.status === to) {
    return booking;
  }
  if (!canTransition(booking.status, to)) {
    throw notPermitted(
      'booking.transition',
      `a booking that is ${booking.status} cannot become ${to}`,
    );
  }

  switch (to) {
    case 'TENTATIVE':
      assertHasSpace(db, booking);
      break;
    case 'DEFINITE':
      assertCanCommit(db, booking);
      break;
    case 'CLOSED':
      assertEverythingServed(db, booking, options.today);
      break;
    case 'CANCELLED':
      assertReasonGiven(options.reason);
      break;
    default:
      break;
  }

  return inTransaction(db, (handle) => {
    if (to === 'DEFINITE') {
      for (const slot of listFunctions(handle, id)) {
        if (slot.status === 'HELD') {
          setFunctionStatus(handle, slot.id, 'DEFINITE', now, actor);
        }
      }
    }
    if (to === 'CANCELLED') {
      for (const slot of listFunctions(handle, id)) {
        if (holdsSpace(slot.status)) {
          setFunctionStatus(handle, slot.id, 'CANCELLED', now, actor);
        }
      }
    }

    handle
      .prepare(
        `update booking set status = ?, updated_at = ?,
          closed_at = case when ? in ('CLOSED', 'CANCELLED') then ? else closed_at end,
          cancel_reason = case when ? = 'CANCELLED' then ? else cancel_reason end
         where id = ?`,
      )
      .run(to, now, to, now, to, options.reason?.trim() ?? null, id);

    recordEvent(
      handle,
      id,
      now,
      actor,
      'status',
      options.reason === undefined
        ? `${booking.status} to ${to}`
        : `${booking.status} to ${to}: ${options.reason.trim()}`,
    );
    return requireBooking(handle, id);
  });
}

function assertHasSpace(db: Database, booking: Booking): void {
  const held = listFunctions(db, booking.id).filter((slot) => holdsSpace(slot.status));
  if (held.length === 0) {
    throw ruleViolation(
      'booking.nospace',
      `booking ${booking.id} holds no space, so there is nothing to make tentative`,
      'add a function first',
    );
  }
}

function assertCanCommit(db: Database, booking: Booking): void {
  assertHasSpace(db, booking);
  if (booking.accountCode === undefined) {
    throw ruleViolation(
      'booking.noaccount',
      `booking ${booking.id} has no account on it, so nobody can be billed`,
      'attach an account first',
    );
  }
  const account = requireAccount(db, booking.propertyCode, booking.accountCode);
  if (!canCommitBusiness(account)) {
    throw conflict(
      'booking.credit',
      `${account.code} is on credit hold, so ${booking.id} cannot go definite`,
      account.code,
    );
  }
}

function assertEverythingServed(db: Database, booking: Booking, today?: CalendarDate): void {
  if (today === undefined) {
    throw invalidInput(
      'booking.close',
      'closing a booking needs the date the office believes it is',
    );
  }
  const outstanding = listFunctions(db, booking.id)
    .filter((slot) => holdsSpace(slot.status))
    .filter((slot) => compareCalendarDates(slot.serviceDate, today) >= 0);
  if (outstanding.length > 0) {
    const first = outstanding[0];
    throw ruleViolation(
      'booking.unserved',
      `booking ${booking.id} still has ${first?.name ?? 'a function'} on ${first?.serviceDate ?? '?'} to serve`,
    );
  }
}

function assertReasonGiven(reason: string | undefined): void {
  if (reason === undefined || reason.trim().length === 0) {
    throw invalidInput('booking.cancel', 'a cancellation needs a reason on the record');
  }
}

/** Shorthand the command line and the tests both use. */
export function makeTentative(
  db: Database,
  id: EntityId<'booking'>,
  now: string,
  actor?: string,
): Booking {
  return transitionBooking(db, id, 'TENTATIVE', now, actor);
}

export function makeDefinite(
  db: Database,
  id: EntityId<'booking'>,
  now: string,
  actor?: string,
): Booking {
  return transitionBooking(db, id, 'DEFINITE', now, actor);
}

export function cancelBooking(
  db: Database,
  id: EntityId<'booking'>,
  reason: string,
  now: string,
  actor?: string,
): Booking {
  return transitionBooking(db, id, 'CANCELLED', now, actor, { reason });
}

export function closeBooking(
  db: Database,
  id: EntityId<'booking'>,
  today: CalendarDate,
  now: string,
  actor?: string,
): Booking {
  return transitionBooking(db, id, 'CLOSED', now, actor, { today });
}
