/**
 * Rolling a property into the next year.
 *
 * Somebody does this once, in October, for the whole building: every price
 * book, every labour rate and every bar tier moves to next season's number on
 * one date. It is the same arithmetic three times and it goes wrong the same
 * way three times, which is why it is one operation rather than three commands
 * run in sequence and hoped about.
 *
 * Two rules make it safe to run. The uplift is applied to the price in force
 * on the from date rather than to whatever the latest row happens to be, so
 * rolling twice by accident does not compound; and the whole roll is one
 * transaction, so a property is never half in next season.
 */

import { compareCalendarDates, type CalendarDate } from '../core/calendar.js';
import { invalidInput } from '../core/errors.js';
import type { CatalogCode } from '../core/ids.js';
import type { Money } from '../core/money.js';
import { applyRate, PPM, rate, type Rate } from '../core/rate.js';
import { requireProperty } from '../property/store.js';
import { bookOn, listPriceBooks, rollForward } from '../catalog/pricing.js';
import { findLabourRate, setLabourRate } from '../labour/staffing.js';
import { ROLES } from '../labour/types.js';
import { padLeft, padRight, row, sheet } from '../core/layout.js';
import { inTransaction, type Database } from '../store/database.js';

export interface RollLine {
  readonly what: string;
  readonly subject: string;
  readonly from: Money;
  readonly to: Money;
}

export interface SeasonRoll {
  readonly propertyCode: CatalogCode;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly uplift: Rate;
  readonly lines: RollLine[];
  readonly prices: number;
  readonly labour: number;
  readonly dryRun: boolean;
}

export interface RollOptions {
  readonly dryRun?: boolean;
  /** Books to leave alone, for a rate somebody negotiated separately. */
  readonly skipBooks?: readonly string[];
}

/**
 * Next season's number.
 *
 * Rounded half up to the minor unit, because a price list with a fraction of a
 * cent on it cannot be printed and a client asked to pay it would be right to
 * query it.
 */
export function uplifted(price: Money, uplift: Rate): Money {
  return applyRate(price, rate(PPM + uplift.ppm), 'half-up');
}

export function rollSeason(
  db: Database,
  propertyCode: CatalogCode,
  from: CalendarDate,
  to: CalendarDate,
  uplift: Rate,
  options: RollOptions = {},
): SeasonRoll {
  requireProperty(db, propertyCode);
  if (compareCalendarDates(to, from) <= 0) {
    throw invalidInput(
      'season.dates',
      `${to} is not after ${from}, so there is nothing to roll into`,
    );
  }
  if (uplift.ppm < -PPM / 2 || uplift.ppm > PPM) {
    throw invalidInput(
      'season.uplift',
      'a season moves prices by somewhere between minus half and plus one hundred percent',
    );
  }

  const skip = new Set((options.skipBooks ?? []).map((code) => code.trim().toUpperCase()));
  const lines: RollLine[] = [];
  let prices = 0;
  let labour = 0;

  for (const book of listPriceBooks(db, propertyCode)) {
    if (skip.has(book.code)) {
      continue;
    }
    for (const line of bookOn(db, propertyCode, book.code, from)) {
      lines.push({
        what: `price:${book.code}`,
        subject: `${line.subjectKind} ${line.subjectCode}`,
        from: line.price,
        to: uplifted(line.price, uplift),
      });
      prices += 1;
    }
  }

  for (const role of ROLES) {
    const current = findLabourRate(db, propertyCode, role, from);
    if (current === undefined) {
      continue;
    }
    lines.push({
      what: 'labour',
      subject: role,
      from: current,
      to: uplifted(current, uplift),
    });
    labour += 1;
  }

  const roll: SeasonRoll = {
    propertyCode,
    from,
    to,
    uplift,
    lines,
    prices,
    labour,
    dryRun: options.dryRun === true,
  };

  if (options.dryRun === true) {
    return roll;
  }

  inTransaction(db, (handle) => {
    for (const book of listPriceBooks(handle, propertyCode)) {
      if (skip.has(book.code)) {
        continue;
      }
      rollForward(handle, propertyCode, book.code, from, to, (price) => uplifted(price, uplift));
    }
    for (const role of ROLES) {
      const current = findLabourRate(handle, propertyCode, role, from);
      if (current === undefined) {
        continue;
      }
      setLabourRate(handle, propertyCode, role, to, uplifted(current, uplift).amount);
    }
    return true;
  });

  return roll;
}

export function renderRoll(roll: SeasonRoll): string {
  return sheet({
    heading:
      `${roll.propertyCode} ${roll.from} to ${roll.to}, ${roll.uplift.ppm / 10_000}% uplift` +
      (roll.dryRun ? ', nothing written' : ''),
    summary: [`${roll.prices} price(s), ${roll.labour} rate(s)`],
    sections: [
      {
        title: '',
        rows: roll.lines.map((line) =>
          row(
            padRight(line.what, 20),
            ' ',
            padRight(line.subject, 26),
            ' ',
            padLeft(line.from.amount, 9),
            ' -> ',
            padLeft(line.to.amount, 9),
          ),
        ),
      },
    ],
    whenBare: 'there is nothing in force on that date to roll',
  });
}
