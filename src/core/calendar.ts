/**
 * Calendar dates for a banquet diary.
 *
 * A function date is a date, not an instant. It stays a date through the
 * contract, the diary, the cutoff arithmetic and the production sheet, and it
 * only becomes an instant at the point where a service time is attached to it.
 * Holding it as a Date object invites a timezone to shift it by a day, which
 * on this system means cooking on the wrong morning.
 */

export type CalendarDate = string & { readonly __brand: 'CalendarDate' };

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export class CalendarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarError';
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const DAY_MS = 86_400_000;

export function calendarDate(text: string): CalendarDate {
  const match = ISO_DATE.exec(text.trim());
  if (match === null) {
    throw new CalendarError(`${JSON.stringify(text)} is not a date in YYYY-MM-DD form`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new CalendarError(`${text} names month ${month}`);
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new CalendarError(`${text} names day ${day}, which is not in that month`);
  }
  return text.trim() as CalendarDate;
}

export function isCalendarDate(text: string): boolean {
  try {
    calendarDate(text);
    return true;
  } catch {
    return false;
  }
}

export function calendarDateParts(date: CalendarDate): {
  year: number;
  month: number;
  day: number;
} {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1] ?? 0;
}

function toUtcMillis(date: CalendarDate): number {
  const { year, month, day } = calendarDateParts(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMillis(millis: number): CalendarDate {
  const moment = new Date(millis);
  const year = moment.getUTCFullYear().toString().padStart(4, '0');
  const month = (moment.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = moment.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}` as CalendarDate;
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  if (!Number.isSafeInteger(days)) {
    throw new CalendarError(`cannot step a date by ${days} days`);
  }
  return fromUtcMillis(toUtcMillis(date) + days * DAY_MS);
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / DAY_MS);
}

export function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function minCalendarDate(left: CalendarDate, right: CalendarDate): CalendarDate {
  return left <= right ? left : right;
}

export function maxCalendarDate(left: CalendarDate, right: CalendarDate): CalendarDate {
  return left >= right ? left : right;
}

/** Sunday is 0, matching the weekday names above. */
export function weekdayIndex(date: CalendarDate): number {
  return new Date(toUtcMillis(date)).getUTCDay();
}

export function weekdayName(date: CalendarDate): WeekdayName {
  return WEEKDAY_NAMES[weekdayIndex(date)] ?? 'Sunday';
}

export function isWeekend(date: CalendarDate): boolean {
  const index = weekdayIndex(date);
  return index === 0 || index === 6;
}

export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const { year, month, day } = calendarDateParts(date);
  const zeroBased = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = zeroBased - targetYear * 12 + 1;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  const yearText = targetYear.toString().padStart(4, '0');
  const monthText = targetMonth.toString().padStart(2, '0');
  const dayText = clampedDay.toString().padStart(2, '0');
  return `${yearText}-${monthText}-${dayText}` as CalendarDate;
}

export function startOfMonth(date: CalendarDate): CalendarDate {
  return `${date.slice(0, 7)}-01` as CalendarDate;
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = calendarDateParts(date);
  const last = daysInMonth(year, month).toString().padStart(2, '0');
  return `${date.slice(0, 7)}-${last}` as CalendarDate;
}

export function datesBetween(from: CalendarDate, to: CalendarDate): CalendarDate[] {
  if (compareCalendarDates(from, to) > 0) {
    throw new CalendarError(`${from} falls after ${to}`);
  }
  const out: CalendarDate[] = [];
  let cursor = from;
  while (compareCalendarDates(cursor, to) <= 0) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function formatCalendarDate(date: CalendarDate): string {
  const { year, month, day } = calendarDateParts(date);
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${weekdayName(date).slice(0, 3)} ${day} ${monthNames[month - 1] ?? '???'} ${year}`;
}
