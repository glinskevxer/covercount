/**
 * The deposit ladder and the cancellation ladder.
 *
 * Both count back from the arrival date in calendar days, not business days,
 * because the contract says days and the client is not going to accept the
 * hotel's holiday calendar as an argument. A step is either a percentage of
 * the contracted value or a flat amount, and a schedule can mix the two: a
 * thousand on signature, then a quarter at ninety days, then the balance at
 * three.
 */

import { addDays, compareCalendarDates, type CalendarDate } from '../core/calendar.js';
import { invalidInput } from '../core/errors.js';
import type { EntityId } from '../core/ids.js';
import { addMoney, money, zeroMoney, type Money } from '../core/money.js';
import { applyRate, rate, type Rate } from '../core/rate.js';
import { requireBooking } from '../booking/store.js';
import { requireProperty } from '../property/store.js';
import type { Database } from '../store/database.js';

export interface DepositStep {
  readonly sequence: number;
  readonly label: string;
  readonly daysBefore: number;
  readonly percent: Rate;
  readonly fixed: Money;
}

export interface DepositDue {
  readonly sequence: number;
  readonly label: string;
  readonly dueDate: CalendarDate;
  readonly amount: Money;
  readonly overdue: boolean;
}

export interface SetDepositStepInput {
  readonly sequence: number;
  readonly label: string;
  readonly daysBefore: number;
  readonly percentPpm?: number;
  readonly fixedMinor?: number;
}

export function setDepositStep(
  db: Database,
  bookingId: EntityId<'booking'>,
  input: SetDepositStepInput,
): DepositStep {
  const booking = requireBooking(db, bookingId);
  const property = requireProperty(db, booking.propertyCode);
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw invalidInput('deposit.sequence', 'a step sequence is a whole number of one or more');
  }
  if (input.label.trim().length === 0) {
    throw invalidInput('deposit.label', 'a deposit step needs a label');
  }
  if (!Number.isInteger(input.daysBefore) || input.daysBefore < 0) {
    throw invalidInput(
      'deposit.days',
      'a deposit falls a whole number of days before arrival, zero or more',
    );
  }
  const percentPpm = input.percentPpm ?? 0;
  const fixedMinor = input.fixedMinor ?? 0;
  if (!Number.isSafeInteger(percentPpm) || percentPpm < 0) {
    throw invalidInput('deposit.percent', 'a deposit percentage is whole parts per million');
  }
  if (!Number.isSafeInteger(fixedMinor) || fixedMinor < 0) {
    throw invalidInput('deposit.fixed', 'a flat deposit is a whole number of minor units');
  }
  if (percentPpm === 0 && fixedMinor === 0) {
    throw invalidInput('deposit.empty', 'a deposit step that asks for nothing does nothing');
  }

  db.prepare(
    `insert into deposit_schedule (booking_id, sequence, label, days_before, percent_ppm, fixed_minor)
     values (?, ?, ?, ?, ?, ?)
     on conflict (booking_id, sequence) do update set
       label = excluded.label,
       days_before = excluded.days_before,
       percent_ppm = excluded.percent_ppm,
       fixed_minor = excluded.fixed_minor`,
  ).run(bookingId, input.sequence, input.label.trim(), input.daysBefore, percentPpm, fixedMinor);

  return {
    sequence: input.sequence,
    label: input.label.trim(),
    daysBefore: input.daysBefore,
    percent: rate(percentPpm),
    fixed: money(fixedMinor, property.currency),
  };
}

export function depositSchedule(db: Database, bookingId: EntityId<'booking'>): DepositStep[] {
  const booking = requireBooking(db, bookingId);
  const property = requireProperty(db, booking.propertyCode);
  return db
    .prepare<
      [string],
      {
        sequence: number;
        label: string;
        days_before: number;
        percent_ppm: number;
        fixed_minor: number;
      }
    >('select * from deposit_schedule where booking_id = ? order by sequence')
    .all(bookingId)
    .map((row) => ({
      sequence: row.sequence,
      label: row.label,
      daysBefore: row.days_before,
      percent: rate(row.percent_ppm),
      fixed: money(row.fixed_minor, property.currency),
    }));
}

/**
 * What falls due and when, against a contracted value. A step is overdue when
 * its date is behind the date the office believes it is.
 */
export function depositsDue(
  db: Database,
  bookingId: EntityId<'booking'>,
  contracted: Money,
  today: CalendarDate,
): DepositDue[] {
  const booking = requireBooking(db, bookingId);
  return depositSchedule(db, bookingId).map((step) => {
    const dueDate = addDays(booking.arrivalDate, -step.daysBefore);
    const amount = addMoney(applyRate(contracted, step.percent), step.fixed);
    return {
      sequence: step.sequence,
      label: step.label,
      dueDate,
      amount,
      overdue: compareCalendarDates(dueDate, today) < 0,
    };
  });
}

export function depositsTotal(due: readonly DepositDue[], currency: Money['currency']): Money {
  return due.reduce<Money>((total, step) => addMoney(total, step.amount), zeroMoney(currency));
}

export function removeDepositStep(
  db: Database,
  bookingId: EntityId<'booking'>,
  sequence: number,
): boolean {
  return (
    db
      .prepare('delete from deposit_schedule where booking_id = ? and sequence = ?')
      .run(bookingId, sequence).changes > 0
  );
}

export interface CancellationStep {
  readonly daysBefore: number;
  readonly percent: Rate;
}

export function setCancellationStep(
  db: Database,
  bookingId: EntityId<'booking'>,
  daysBefore: number,
  percentPpm: number,
): CancellationStep {
  requireBooking(db, bookingId);
  if (!Number.isInteger(daysBefore) || daysBefore < 0) {
    throw invalidInput('cancel.days', 'a cancellation step falls a whole number of days before');
  }
  if (!Number.isSafeInteger(percentPpm) || percentPpm < 0 || percentPpm > 1_000_000) {
    throw invalidInput(
      'cancel.percent',
      'a cancellation percentage is between zero and a hundred percent',
    );
  }
  db.prepare(
    `insert into cancellation_step (booking_id, days_before, percent_ppm) values (?, ?, ?)
     on conflict (booking_id, days_before) do update set percent_ppm = excluded.percent_ppm`,
  ).run(bookingId, daysBefore, percentPpm);
  return { daysBefore, percent: rate(percentPpm) };
}

/** The ladder, furthest out first, which is how a contract prints it. */
export function cancellationLadder(
  db: Database,
  bookingId: EntityId<'booking'>,
): CancellationStep[] {
  return db
    .prepare<[string], { days_before: number; percent_ppm: number }>(
      'select days_before, percent_ppm from cancellation_step where booking_id = ? order by days_before desc',
    )
    .all(bookingId)
    .map((row) => ({ daysBefore: row.days_before, percent: rate(row.percent_ppm) }));
}

/**
 * What cancelling on a date costs. The step that applies is the tightest one
 * the cancellation date has already passed, so a booking cancelled inside
 * three days pays the three day rate rather than the ninety day one.
 */
export function cancellationCharge(
  db: Database,
  bookingId: EntityId<'booking'>,
  contracted: Money,
  cancelledOn: CalendarDate,
): { daysBefore: number; percent: Rate; amount: Money } {
  const booking = requireBooking(db, bookingId);
  const daysOut = daysUntil(cancelledOn, booking.arrivalDate);
  const applicable = cancellationLadder(db, bookingId).filter((step) => daysOut <= step.daysBefore);
  const step = applicable.at(-1);
  if (step === undefined) {
    return { daysBefore: daysOut, percent: rate(0), amount: zeroMoney(contracted.currency) };
  }
  return {
    daysBefore: step.daysBefore,
    percent: step.percent,
    amount: applyRate(contracted, step.percent),
  };
}

function daysUntil(from: CalendarDate, to: CalendarDate): number {
  return Math.max(0, dayDifference(from, to));
}

function dayDifference(from: CalendarDate, to: CalendarDate): number {
  const fromParts = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const toParts = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((toParts - fromParts) / 86_400_000);
}
