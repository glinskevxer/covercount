/**
 * What a cancellation costs.
 *
 * Every catering contract on earth carries the same clause in different words:
 * the closer to the date you walk, the more of it you owe. The house publishes
 * a scale in days, and the band that applies is the one whose threshold the
 * notice still clears.
 *
 * Two things make this less obvious than it sounds. The scale is a step
 * function, so a booking cancelled a day either side of a threshold owes very
 * different money, and the thresholds are read from the FUNCTION date rather
 * than the arrival date. A three day conference cancelled on the Tuesday is
 * ninety days out from its Friday gala and eighty eight from its Wednesday
 * lunch, and those are two different bands.
 */

import { daysBetween, type CalendarDate } from '../core/calendar.js';
import { conflict, invalidInput, notFound } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { addMoney, zeroMoney, type Money } from '../core/money.js';
import { applyRate, PPM, rate, type Rate } from '../core/rate.js';
import { requireProperty } from '../property/store.js';
import { lineTotal, listCharges } from '../billing/charges.js';
import { requireBooking } from './store.js';
import { listFunctions } from './functions.js';
import type { Database } from '../store/database.js';

export interface CancellationBand {
  readonly daysBefore: number;
  readonly charge: Rate;
  readonly note: string;
}

export function setCancellationBand(
  db: Database,
  propertyCode: CatalogCode,
  daysBefore: number,
  ratePpm: number,
  note = '',
): CancellationBand {
  requireProperty(db, propertyCode);
  if (!Number.isSafeInteger(daysBefore) || daysBefore < 0) {
    throw invalidInput('damages.days', 'a band starts a whole number of days out, nil or more');
  }
  if (!Number.isSafeInteger(ratePpm) || ratePpm < 0 || ratePpm > PPM) {
    throw invalidInput(
      'damages.rate',
      'damages run from nothing to the whole contract, so the rate sits between nil and a hundred percent',
    );
  }
  db.prepare(
    `insert into cancellation_band (property_code, days_before, rate_ppm, note)
     values (?, ?, ?, ?)
     on conflict (property_code, days_before) do update set
       rate_ppm = excluded.rate_ppm, note = excluded.note`,
  ).run(propertyCode, daysBefore, ratePpm, note.trim());
  return { daysBefore, charge: rate(ratePpm), note: note.trim() };
}

/** The published scale, furthest out first, which is how a contract reads. */
export function cancellationBands(db: Database, propertyCode: CatalogCode): CancellationBand[] {
  return db
    .prepare<[string], { days_before: number; rate_ppm: number; note: string }>(
      'select * from cancellation_band where property_code = ? order by days_before desc',
    )
    .all(propertyCode)
    .map((row) => ({
      daysBefore: row.days_before,
      charge: rate(row.rate_ppm),
      note: row.note,
    }));
}

export function removeCancellationBand(
  db: Database,
  propertyCode: CatalogCode,
  daysBefore: number,
): boolean {
  return (
    db
      .prepare('delete from cancellation_band where property_code = ? and days_before = ?')
      .run(propertyCode, daysBefore).changes > 0
  );
}

/**
 * The band that applies to a notice this many days out: the strictest band the
 * notice still clears, which is the one with the largest threshold at or below
 * the notice. A house with no band at nil days has nothing to say about a
 * cancellation on the day, which is a gap in the contract rather than a free
 * cancellation, so it is an error and not a nil rate.
 */
export function bandFor(
  db: Database,
  propertyCode: CatalogCode,
  daysOut: number,
): CancellationBand {
  const applicable = cancellationBands(db, propertyCode).filter(
    (band) => band.daysBefore <= Math.max(daysOut, 0),
  );
  const found = applicable[0];
  if (found === undefined) {
    throw notFound(
      'damages.band',
      String(daysOut),
      `${propertyCode} publishes no cancellation band that reaches ${daysOut} days out`,
    );
  }
  return found;
}

export interface DamageLine {
  readonly functionId: EntityId<'functionSlot'>;
  readonly name: string;
  readonly serviceDate: CalendarDate;
  readonly daysOut: number;
  readonly band: CancellationBand;
  readonly contracted: Money;
  readonly damages: Money;
}

export interface DamageAssessment {
  readonly bookingId: EntityId<'booking'>;
  readonly noticeOn: CalendarDate;
  readonly lines: DamageLine[];
  readonly contracted: Money;
  readonly damages: Money;
}

/**
 * What the client owes if they walk today.
 *
 * The contracted value is the charges already drawn on the function, which is
 * the only honest number available: a function nobody has priced is worth
 * nothing to walk away from, and pretending otherwise invents revenue. A
 * function whose date has already passed is left out entirely rather than
 * counted at a hundred percent, because it happened.
 */
export function assessDamages(
  db: Database,
  bookingId: EntityId<'booking'>,
  noticeOn: CalendarDate,
): DamageAssessment {
  const booking = requireBooking(db, bookingId);
  const property = requireProperty(db, booking.propertyCode);
  const lines: DamageLine[] = [];
  let contracted = zeroMoney(property.currency);
  let damages = zeroMoney(property.currency);

  for (const slot of listFunctions(db, bookingId)) {
    const daysOut = daysBetween(noticeOn, slot.serviceDate);
    if (daysOut < 0) {
      continue;
    }
    const band = bandFor(db, booking.propertyCode, daysOut);
    let value = zeroMoney(property.currency);
    for (const line of listCharges(db, slot.id)) {
      value = addMoney(value, lineTotal(line));
    }
    const owed = applyRate(value, band.charge);
    lines.push({
      functionId: slot.id,
      name: slot.name,
      serviceDate: slot.serviceDate,
      daysOut,
      band,
      contracted: value,
      damages: owed,
    });
    contracted = addMoney(contracted, value);
    damages = addMoney(damages, owed);
  }

  if (lines.length === 0) {
    throw conflict(
      'damages.nothing',
      `booking ${bookingId} has nothing left to cancel on ${noticeOn}`,
      bookingId,
    );
  }

  return { bookingId, noticeOn, lines, contracted, damages };
}
