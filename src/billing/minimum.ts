/**
 * The food and beverage minimum.
 *
 * A ballroom is not really sold by the hour. It is sold against a promise to
 * spend, and the rental line is the difference between that promise and what
 * the client actually spent. So the minimum is not a charge in its own right:
 * it is a floor under the food and beverage total, and the shortfall is what
 * gets billed when the floor is not reached.
 *
 * That makes it read off the charges rather than off the covers. A client who
 * guarantees a hundred and eighty and then buys a cheaper package can clear
 * the minimum on wine alone, and a client who guarantees eighty and buys the
 * chef's table can clear it on food. Both are the same rule.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import {
  addMoney,
  money,
  subtractMoney,
  zeroMoney,
  type CurrencyCode,
  type Money,
} from '../core/money.js';
import type { EntityId } from '../core/ids.js';
import { requireFunction } from '../booking/functions.js';
import { requireBooking } from '../booking/store.js';
import { isFinished } from '../booking/types.js';
import { requireProperty } from '../property/store.js';
import { addCharge, lineTotal, listCharges, removeChargesFrom } from './charges.js';
import type { ChargeCategory, ChargeLine } from './types.js';
import type { Database } from '../store/database.js';

/** The line the sweep writes, and the only line it will ever remove. */
export const SHORTFALL_DESCRIPTION = 'food and beverage minimum shortfall';

export interface RevenueMinimum {
  readonly functionId: EntityId<'functionSlot'>;
  readonly minimum: Money;
  /** Whether the bar counts toward the floor, which is a contract term. */
  readonly countsBeverage: boolean;
  readonly note: string;
  readonly setAt: string;
}

interface MinimumRow {
  readonly function_id: string;
  readonly minimum_minor: number;
  readonly counts_beverage: number;
  readonly note: string;
  readonly set_at: string;
}

function toMinimum(row: MinimumRow, currency: CurrencyCode): RevenueMinimum {
  return {
    functionId: row.function_id as EntityId<'functionSlot'>,
    minimum: money(row.minimum_minor, currency),
    countsBeverage: row.counts_beverage === 1,
    note: row.note,
    setAt: row.set_at,
  };
}

export interface SetMinimumInput {
  readonly minimumMinor: number;
  readonly countsBeverage?: boolean;
  readonly note?: string;
}

export function setRevenueMinimum(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  input: SetMinimumInput,
  now: string,
): RevenueMinimum {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const booking = requireBooking(db, slot.bookingId);
  if (isFinished(booking.status)) {
    throw conflict(
      'minimum.finished',
      `booking ${booking.id} is ${booking.status.toLowerCase()}, its minimum is history now`,
      booking.id,
    );
  }
  if (!Number.isSafeInteger(input.minimumMinor) || input.minimumMinor < 0) {
    throw invalidInput(
      'minimum.amount',
      'a minimum is a whole amount of minor units, at least nil',
    );
  }

  db.prepare(
    `insert into revenue_minimum (function_id, minimum_minor, counts_beverage, note, set_at)
     values (?, ?, ?, ?, ?)
     on conflict (function_id) do update set
       minimum_minor = excluded.minimum_minor,
       counts_beverage = excluded.counts_beverage,
       note = excluded.note,
       set_at = excluded.set_at`,
  ).run(
    functionId,
    input.minimumMinor,
    (input.countsBeverage ?? true) ? 1 : 0,
    (input.note ?? '').trim(),
    now,
  );

  return {
    functionId,
    minimum: money(input.minimumMinor, property.currency),
    countsBeverage: input.countsBeverage ?? true,
    note: (input.note ?? '').trim(),
    setAt: now,
  };
}

export function findRevenueMinimum(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): RevenueMinimum | undefined {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const row = db
    .prepare<[string], MinimumRow>('select * from revenue_minimum where function_id = ?')
    .get(functionId);
  return row === undefined ? undefined : toMinimum(row, property.currency);
}

export function requireRevenueMinimum(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): RevenueMinimum {
  const found = findRevenueMinimum(db, functionId);
  if (found === undefined) {
    throw notFound('minimum.missing', functionId, `${functionId} carries no minimum`);
  }
  return found;
}

export function clearRevenueMinimum(db: Database, functionId: EntityId<'functionSlot'>): boolean {
  return (
    db.prepare('delete from revenue_minimum where function_id = ?').run(functionId).changes > 0
  );
}

export interface MinimumStanding {
  readonly minimum: Money;
  /** What counts toward the floor, which is food and maybe the bar. */
  readonly achieved: Money;
  readonly shortfall: Money;
  readonly countsBeverage: boolean;
  readonly categories: ChargeCategory[];
  readonly met: boolean;
}

/**
 * Which categories count. Rental, audio visual, labour and fees never do: a
 * client cannot spend their way to a food minimum by hiring more screens.
 */
function countingCategories(countsBeverage: boolean): ChargeCategory[] {
  return countsBeverage ? ['BEVERAGE', 'FOOD'] : ['FOOD'];
}

/**
 * The shortfall as it stands. The sweep's own line is left out of the sum, so
 * running the sweep twice does not let the fee count toward the floor it was
 * raised against.
 */
export function minimumStanding(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): MinimumStanding {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const record = requireRevenueMinimum(db, functionId);
  const categories = countingCategories(record.countsBeverage);

  let achieved = zeroMoney(property.currency);
  for (const line of listCharges(db, functionId)) {
    if (line.source === 'MINIMUM') continue;
    if (!categories.includes(line.category)) continue;
    achieved = addMoney(achieved, lineTotal(line));
  }

  const gap = subtractMoney(record.minimum, achieved);
  const shortfall = gap.amount > 0 ? gap : zeroMoney(property.currency);
  return {
    minimum: record.minimum,
    achieved,
    shortfall,
    countsBeverage: record.countsBeverage,
    categories,
    met: shortfall.amount === 0,
  };
}

export interface MinimumSweep {
  readonly standing: MinimumStanding;
  readonly removed: number;
  readonly charge: ChargeLine | undefined;
}

/**
 * Put the shortfall on the bill, or take it off again.
 *
 * The old line goes first every time. A minimum that has since been met leaves
 * no line behind, and a minimum that moved gets one line at the new number
 * rather than two lines that add up to it. The line is rental in category
 * because that is what it is standing in for, so it is taxed like rental and
 * carries no service charge: nobody served it.
 */
export function sweepMinimum(db: Database, functionId: EntityId<'functionSlot'>): MinimumSweep {
  const removed = removeChargesFrom(db, functionId, 'MINIMUM');
  const standing = minimumStanding(db, functionId);
  if (standing.met) {
    return { standing, removed, charge: undefined };
  }
  const charge = addCharge(db, functionId, {
    category: 'RENTAL',
    description: SHORTFALL_DESCRIPTION,
    quantity: 1,
    unitMinor: standing.shortfall.amount,
    serviceable: false,
    taxable: true,
    source: 'MINIMUM',
  });
  return { standing, removed, charge };
}
