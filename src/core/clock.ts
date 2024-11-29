/**
 * Wall clock time at a property, and the instants behind it.
 *
 * Service times are wall clock. Doors at seven means seven on the clock in the
 * ballroom, on the night the clocks go back as much as any other night. The
 * deadline arithmetic, though, has to compare against a real instant, because
 * a cutoff that passed is a cutoff that passed. This module is the one place
 * that crosses between the two, and it uses the platform time zone database
 * rather than carrying offsets of its own.
 */

import { addDays, calendarDate, type CalendarDate } from './calendar.js';

export type TimeOfDay = number & { readonly __brand: 'TimeOfDay' };

export type TimeZoneName = string & { readonly __brand: 'TimeZoneName' };

export class ClockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClockError';
  }
}

export const MINUTES_PER_DAY = 1440;

const HHMM = /^(\d{1,2}):(\d{2})$/;

export function timeOfDay(minutes: number): TimeOfDay {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new ClockError(`${minutes} is not a minute of the day`);
  }
  return minutes as TimeOfDay;
}

export function parseTimeOfDay(text: string): TimeOfDay {
  const match = HHMM.exec(text.trim());
  if (match === null) {
    throw new ClockError(`${JSON.stringify(text)} is not a time in HH:MM form`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23) {
    throw new ClockError(`${text} names hour ${hours}`);
  }
  if (minutes > 59) {
    throw new ClockError(`${text} names minute ${minutes}`);
  }
  return timeOfDay(hours * 60 + minutes);
}

export function formatTimeOfDay(value: TimeOfDay): string {
  const hours = Math.floor(value / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (value % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** The way a run of show prints it, which is the twelve hour clock. */
export function formatTimeOfDayShort(value: TimeOfDay): string {
  const hours24 = Math.floor(value / 60);
  const minutes = value % 60;
  const suffix = hours24 < 12 ? 'am' : 'pm';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return minutes === 0
    ? `${hours12}${suffix}`
    : `${hours12}:${minutes.toString().padStart(2, '0')}${suffix}`;
}

/**
 * Shift a time of day, returning the new time and how many days it rolled.
 * Plating that starts ninety minutes before a midnight supper lands on the
 * previous date and the caller has to know that.
 */
export function shiftTimeOfDay(
  value: TimeOfDay,
  minutes: number,
): {
  time: TimeOfDay;
  dayShift: number;
} {
  if (!Number.isSafeInteger(minutes)) {
    throw new ClockError(`cannot shift a time by ${minutes} minutes`);
  }
  const total = value + minutes;
  const dayShift = Math.floor(total / MINUTES_PER_DAY);
  const time = timeOfDay(total - dayShift * MINUTES_PER_DAY);
  return { time, dayShift };
}

export interface ZonedDateTime {
  readonly date: CalendarDate;
  readonly time: TimeOfDay;
  readonly zone: TimeZoneName;
}

export function timeZone(name: string): TimeZoneName {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
  } catch {
    throw new ClockError(`${JSON.stringify(name)} is not a time zone this platform knows`);
  }
  return name as TimeZoneName;
}

export function zonedDateTime(
  date: CalendarDate,
  time: TimeOfDay,
  zone: TimeZoneName,
): ZonedDateTime {
  return { date, time, zone };
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: TimeZoneName): Intl.DateTimeFormat {
  const cached = partsCache.get(zone);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  partsCache.set(zone, formatter);
  return formatter;
}

/** Offset in minutes east of UTC at the given instant. */
export function zoneOffsetMinutes(instant: number, zone: TimeZoneName): number {
  const parts = formatterFor(zone).formatToParts(new Date(instant));
  const lookup: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      lookup[part.type] = Number(part.value);
    }
  }
  const hour = lookup.hour === 24 ? 0 : (lookup.hour ?? 0);
  const asUtc = Date.UTC(
    lookup.year ?? 1970,
    (lookup.month ?? 1) - 1,
    lookup.day ?? 1,
    hour,
    lookup.minute ?? 0,
    lookup.second ?? 0,
  );
  return Math.round((asUtc - instant) / 60000);
}

/**
 * Turn a wall clock reading into an instant. A reading that the clocks skipped
 * over is pushed forward past the gap; a reading that happened twice takes the
 * first of the two, which is what a coordinator means by it.
 */
export function toInstant(value: ZonedDateTime): number {
  const naive =
    Date.UTC(
      Number(value.date.slice(0, 4)),
      Number(value.date.slice(5, 7)) - 1,
      Number(value.date.slice(8, 10)),
    ) +
    value.time * 60000;
  const firstGuess = naive - zoneOffsetMinutes(naive, value.zone) * 60000;
  const secondGuess = naive - zoneOffsetMinutes(firstGuess, value.zone) * 60000;
  if (secondGuess === firstGuess) {
    return firstGuess;
  }
  // The two guesses only differ across a transition. Take the earlier instant
  // whose local reading actually matches, and fall forward if neither does.
  for (const candidate of [Math.min(firstGuess, secondGuess), Math.max(firstGuess, secondGuess)]) {
    const back = fromInstant(candidate, value.zone);
    if (back.date === value.date && back.time === value.time) {
      return candidate;
    }
  }
  return Math.max(firstGuess, secondGuess);
}

export function fromInstant(instant: number, zone: TimeZoneName): ZonedDateTime {
  const offset = zoneOffsetMinutes(instant, zone);
  const local = instant + offset * 60000;
  const moment = new Date(local);
  const date = calendarDate(
    `${moment.getUTCFullYear().toString().padStart(4, '0')}-${(moment.getUTCMonth() + 1)
      .toString()
      .padStart(2, '0')}-${moment.getUTCDate().toString().padStart(2, '0')}`,
  );
  const time = timeOfDay(moment.getUTCHours() * 60 + moment.getUTCMinutes());
  return { date, time, zone };
}

/** Move a wall clock reading by minutes, keeping it a wall clock reading. */
export function shiftZoned(value: ZonedDateTime, minutes: number): ZonedDateTime {
  const shifted = shiftTimeOfDay(value.time, minutes);
  return {
    date: addDays(value.date, shifted.dayShift),
    time: shifted.time,
    zone: value.zone,
  };
}

export function formatZoned(value: ZonedDateTime): string {
  return `${value.date} ${formatTimeOfDay(value.time)} ${value.zone}`;
}

export function compareZoned(left: ZonedDateTime, right: ZonedDateTime): number {
  const leftInstant = toInstant(left);
  const rightInstant = toInstant(right);
  if (leftInstant < rightInstant) return -1;
  if (leftInstant > rightInstant) return 1;
  return 0;
}
