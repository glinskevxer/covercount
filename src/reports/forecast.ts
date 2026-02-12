/**
 * The pace report.
 *
 * What a director of catering is asked on a Monday is not what happened, it is
 * what is coming. Covers by day, revenue by day, and how much of it is signed.
 *
 * The split between definite and held is the whole point. A week showing four
 * hundred covers reads very differently when three hundred of them are on
 * functions nobody has signed, and a forecast that adds the two together is
 * the reason a kitchen orders for a party that never happens. So both numbers
 * are carried the whole way through and never summed into one.
 *
 * Revenue is read off the charges actually drawn, not off the package price
 * times covers. A function nobody has priced forecasts nothing, which is the
 * honest answer: the house does not know yet.
 */

import { datesBetween, type CalendarDate } from '../core/calendar.js';
import { invalidInput } from '../core/errors.js';
import type { CatalogCode } from '../core/ids.js';
import { addMoney, zeroMoney, type Money } from '../core/money.js';
import { requireProperty } from '../property/store.js';
import { functionsOnDate } from '../booking/diary.js';
import { holdsSpace } from '../booking/types.js';
import { findCovers, billedCovers } from '../covers/guarantee.js';
import { lineTotal, listCharges } from '../billing/charges.js';
import { listShifts, shiftCost } from '../labour/shifts.js';
import type { Database } from '../store/database.js';

export interface ForecastDay {
  readonly serviceDate: CalendarDate;
  readonly functions: number;
  readonly definiteFunctions: number;
  /** Covers on signed functions. */
  readonly definiteCovers: number;
  /** Covers on functions still only held. */
  readonly heldCovers: number;
  readonly definiteRevenue: Money;
  readonly heldRevenue: Money;
  readonly labour: Money;
  /** Functions with space but no charge lines at all. */
  readonly unpriced: number;
}

export interface Forecast {
  readonly propertyCode: CatalogCode;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly days: ForecastDay[];
  readonly definiteCovers: number;
  readonly heldCovers: number;
  readonly definiteRevenue: Money;
  readonly heldRevenue: Money;
  readonly labour: Money;
  readonly unpriced: number;
}

/**
 * A day's worth. Expected covers stand in where a function has no guarantee
 * yet, because a forecast that reads nothing until the guarantee lands is
 * blind for exactly the period it is meant to cover.
 */
function forecastDay(
  db: Database,
  propertyCode: CatalogCode,
  serviceDate: CalendarDate,
  currency: Money['currency'],
): ForecastDay {
  let definiteCovers = 0;
  let heldCovers = 0;
  let definiteRevenue = zeroMoney(currency);
  let heldRevenue = zeroMoney(currency);
  let labour = zeroMoney(currency);
  let functions = 0;
  let definiteFunctions = 0;
  let unpriced = 0;

  for (const slot of functionsOnDate(db, propertyCode, serviceDate)) {
    if (!holdsSpace(slot.status)) {
      continue;
    }
    functions += 1;
    const covers = findCovers(db, slot.id);
    const heads =
      covers === undefined
        ? slot.expectedCovers
        : Math.max(billedCovers(covers), slot.expectedCovers);

    let revenue = zeroMoney(currency);
    const charges = listCharges(db, slot.id);
    for (const line of charges) {
      revenue = addMoney(revenue, lineTotal(line));
    }
    if (charges.length === 0) {
      unpriced += 1;
    }

    for (const shift of listShifts(db, slot.id)) {
      labour = addMoney(labour, shiftCost(shift));
    }

    if (slot.status === 'DEFINITE') {
      definiteFunctions += 1;
      definiteCovers += heads;
      definiteRevenue = addMoney(definiteRevenue, revenue);
    } else {
      heldCovers += heads;
      heldRevenue = addMoney(heldRevenue, revenue);
    }
  }

  return {
    serviceDate,
    functions,
    definiteFunctions,
    definiteCovers,
    heldCovers,
    definiteRevenue,
    heldRevenue,
    labour,
    unpriced,
  };
}

export function forecast(
  db: Database,
  propertyCode: CatalogCode,
  from: CalendarDate,
  to: CalendarDate,
): Forecast {
  const property = requireProperty(db, propertyCode);
  if (from > to) {
    throw invalidInput(
      'forecast.range',
      'a forecast runs forwards, so the end is not before the start',
    );
  }
  const dates = datesBetween(from, to);
  if (dates.length > 400) {
    throw invalidInput('forecast.range', 'a forecast covers at most a year and a bit');
  }
  const days = dates.map((date) => forecastDay(db, propertyCode, date, property.currency));

  return {
    propertyCode,
    from,
    to,
    days,
    definiteCovers: days.reduce((total, day) => total + day.definiteCovers, 0),
    heldCovers: days.reduce((total, day) => total + day.heldCovers, 0),
    definiteRevenue: days.reduce(
      (total, day) => addMoney(total, day.definiteRevenue),
      zeroMoney(property.currency),
    ),
    heldRevenue: days.reduce(
      (total, day) => addMoney(total, day.heldRevenue),
      zeroMoney(property.currency),
    ),
    labour: days.reduce((total, day) => addMoney(total, day.labour), zeroMoney(property.currency)),
    unpriced: days.reduce((total, day) => total + day.unpriced, 0),
  };
}

/** Only the days with something on them, which is what gets printed. */
export function busyDays(found: Forecast): ForecastDay[] {
  return found.days.filter((day) => day.functions > 0);
}

export function renderForecast(found: Forecast): string {
  const rows = busyDays(found);
  const lines: string[] = [];
  lines.push(`${found.propertyCode} pace, ${found.from} to ${found.to}`);
  lines.push(
    `definite ${found.definiteCovers} covers, held ${found.heldCovers} covers, ${found.unpriced} function(s) unpriced`,
  );
  if (rows.length === 0) {
    lines.push('');
    lines.push('nothing on the books');
    return lines.join('\n');
  }
  lines.push('');
  for (const day of rows) {
    lines.push(
      `  ${day.serviceDate}  ${String(day.definiteFunctions).padStart(2)}/${String(day.functions).padEnd(2)}` +
        `  ${String(day.definiteCovers).padStart(5)} definite  ${String(day.heldCovers).padStart(5)} held`,
    );
  }
  return lines.join('\n');
}
