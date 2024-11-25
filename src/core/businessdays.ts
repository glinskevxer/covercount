/**
 * Business day arithmetic against a house calendar.
 *
 * The guarantee deadline in a catering contract is almost never "72 hours
 * before". It is "three business days prior", and a hotel's business days are
 * not the bank's: the sales office is dark at the weekend but the kitchen is
 * not, and a property closes for its own dates as well as the public holidays.
 * So the calendar is data, and every deadline is computed against it.
 */

import {
  addDays,
  compareCalendarDates,
  isWeekend,
  weekdayIndex,
  type CalendarDate,
} from './calendar.js';

export class BusinessCalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessCalendarError';
  }
}

export interface BusinessCalendarInput {
  /** Weekday indexes the office is closed. Defaults to Saturday and Sunday. */
  readonly closedWeekdays?: readonly number[];
  /** Dates the office is closed on top of the weekly pattern. */
  readonly holidays?: readonly CalendarDate[];
  /** Dates the office is open despite the weekly pattern. */
  readonly workingExceptions?: readonly CalendarDate[];
}

export class BusinessCalendar {
  private readonly closedWeekdays: ReadonlySet<number>;
  private readonly holidays: ReadonlySet<string>;
  private readonly workingExceptions: ReadonlySet<string>;

  constructor(input: BusinessCalendarInput = {}) {
    const closed = input.closedWeekdays ?? [0, 6];
    for (const day of closed) {
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        throw new BusinessCalendarError(`weekday ${day} is not between 0 and 6`);
      }
    }
    this.closedWeekdays = new Set(closed);
    this.holidays = new Set(input.holidays ?? []);
    this.workingExceptions = new Set(input.workingExceptions ?? []);
    for (const date of this.workingExceptions) {
      if (this.holidays.has(date)) {
        throw new BusinessCalendarError(`${date} is listed as both a holiday and a working day`);
      }
    }
  }

  isBusinessDay(date: CalendarDate): boolean {
    if (this.workingExceptions.has(date)) {
      return true;
    }
    if (this.holidays.has(date)) {
      return false;
    }
    return !this.closedWeekdays.has(weekdayIndex(date));
  }

  isClosed(date: CalendarDate): boolean {
    return !this.isBusinessDay(date);
  }

  /** The first business day on or after the given date. */
  nextBusinessDayOnOrAfter(date: CalendarDate): CalendarDate {
    let cursor = date;
    for (let step = 0; step <= 400; step += 1) {
      if (this.isBusinessDay(cursor)) {
        return cursor;
      }
      cursor = addDays(cursor, 1);
    }
    throw new BusinessCalendarError(`no business day found within a year of ${date}`);
  }

  /** The last business day on or before the given date. */
  previousBusinessDayOnOrBefore(date: CalendarDate): CalendarDate {
    let cursor = date;
    for (let step = 0; step <= 400; step += 1) {
      if (this.isBusinessDay(cursor)) {
        return cursor;
      }
      cursor = addDays(cursor, -1);
    }
    throw new BusinessCalendarError(`no business day found within a year before ${date}`);
  }

  /**
   * Step whole business days. Counting starts from the day after the anchor,
   * so three business days before a Monday function is the Wednesday before,
   * not the Thursday.
   */
  addBusinessDays(date: CalendarDate, days: number): CalendarDate {
    if (!Number.isSafeInteger(days)) {
      throw new BusinessCalendarError(`cannot step ${days} business days`);
    }
    const direction = days < 0 ? -1 : 1;
    let remaining = Math.abs(days);
    let cursor = date;
    let guard = 0;
    while (remaining > 0) {
      cursor = addDays(cursor, direction);
      guard += 1;
      if (guard > 4000) {
        throw new BusinessCalendarError(`stepping ${days} business days from ${date} never landed`);
      }
      if (this.isBusinessDay(cursor)) {
        remaining -= 1;
      }
    }
    return cursor;
  }

  /** Business days in the half open interval from `from` up to `to`. */
  businessDaysBetween(from: CalendarDate, to: CalendarDate): number {
    if (compareCalendarDates(from, to) > 0) {
      return -this.businessDaysBetween(to, from);
    }
    let count = 0;
    let cursor = from;
    while (compareCalendarDates(cursor, to) < 0) {
      cursor = addDays(cursor, 1);
      if (this.isBusinessDay(cursor)) {
        count += 1;
      }
    }
    return count;
  }

  describe(): string {
    const closed = [...this.closedWeekdays].sort((a, b) => a - b).join(',');
    return `closed weekdays ${closed || 'none'}, ${this.holidays.size} holidays, ${this.workingExceptions.size} working exceptions`;
  }
}

/** The default hotel sales office pattern: closed at the weekend, no holidays. */
export function defaultBusinessCalendar(): BusinessCalendar {
  return new BusinessCalendar();
}

/** A calendar for a kitchen, which does not take the weekend off. */
export function sevenDayCalendar(holidays: readonly CalendarDate[] = []): BusinessCalendar {
  return new BusinessCalendar({ closedWeekdays: [], holidays });
}

export function isWeekendDate(date: CalendarDate): boolean {
  return isWeekend(date);
}
