/**
 * A year of dates, walked one at a time.
 *
 * Everything here is about a transition somebody would otherwise only find in
 * March or November. Two of them are real: the guarantee deadline for a
 * function the week the clocks move, and a wall clock reading that either does
 * not exist or happens twice. Walking the whole year is cheap and it is the
 * only way to be sure the answer is not right by accident on the day the test
 * was written.
 */

import { describe, expect, it } from 'vitest';
import {
  addDays,
  calendarDate,
  compareCalendarDates,
  daysBetween,
  type CalendarDate,
} from '../../src/core/calendar.js';
import {
  formatTimeOfDay,
  fromInstant,
  parseTimeOfDay,
  timeZone,
  toInstant,
  zoneOffsetMinutes,
  zonedDateTime,
} from '../../src/core/clock.js';
import { defaultBusinessCalendar } from '../../src/core/businessdays.js';
import { guaranteeDeadline } from '../../src/covers/deadline.js';

const denver = timeZone('America/Denver');
const london = timeZone('Europe/London');
const auckland = timeZone('Pacific/Auckland');
const phoenix = timeZone('America/Phoenix');

function everyDayOf(year: number): CalendarDate[] {
  const out: CalendarDate[] = [];
  let cursor = calendarDate(`${year}-01-01`);
  const end = calendarDate(`${year}-12-31`);
  while (compareCalendarDates(cursor, end) <= 0) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

describe('a wall clock reading, every day of a year', () => {
  it('round trips at noon in four zones', () => {
    for (const zone of [denver, london, auckland, phoenix]) {
      for (const date of everyDayOf(2025)) {
        const reading = zonedDateTime(date, parseTimeOfDay('12:00'), zone);
        expect(fromInstant(toInstant(reading), zone)).toEqual(reading);
      }
    }
  });

  it('never lands on a reading that is not on the clock', () => {
    for (const zone of [denver, london, auckland]) {
      for (const date of everyDayOf(2025)) {
        for (const time of ['00:30', '01:30', '02:30', '03:30']) {
          const reading = zonedDateTime(date, parseTimeOfDay(time), zone);
          const back = fromInstant(toInstant(reading), zone);
          expect(formatTimeOfDay(back.time)).toMatch(/^\d\d:\d\d$/);
          expect(Math.abs(daysBetween(date, back.date))).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('moves the offset exactly twice a year where the clocks change', () => {
    const offsets = everyDayOf(2025).map((date) =>
      zoneOffsetMinutes(toInstant(zonedDateTime(date, parseTimeOfDay('12:00'), denver)), denver),
    );
    const changes = offsets.filter((offset, index) => index > 0 && offset !== offsets[index - 1]);
    expect(changes).toHaveLength(2);
    expect(new Set(offsets)).toEqual(new Set([-420, -360]));
  });

  it('never moves the offset where the clocks do not change', () => {
    const offsets = everyDayOf(2025).map((date) =>
      zoneOffsetMinutes(toInstant(zonedDateTime(date, parseTimeOfDay('12:00'), phoenix)), phoenix),
    );
    expect(new Set(offsets)).toEqual(new Set([-420]));
  });

  it('keeps a service time on the clock across every day boundary', () => {
    for (const date of everyDayOf(2025).slice(0, 364)) {
      const today = zonedDateTime(date, parseTimeOfDay('19:00'), denver);
      const tomorrow = zonedDateTime(addDays(date, 1), parseTimeOfDay('19:00'), denver);
      const gap = toInstant(tomorrow) - toInstant(today);
      expect([23, 24, 25].map((hours) => hours * 3_600_000)).toContain(gap);
    }
  });
});

describe('the guarantee deadline, every day of a year', () => {
  const office = defaultBusinessCalendar();

  it('always lands on a business day', () => {
    for (const date of everyDayOf(2025)) {
      const deadline = guaranteeDeadline({
        serviceDate: date,
        leadDays: 3,
        dueTime: parseTimeOfDay('12:00'),
        zone: denver,
        calendar: office,
      });
      expect(office.isBusinessDay(deadline.date)).toBe(true);
    }
  });

  it('always lands before the function', () => {
    for (const date of everyDayOf(2025)) {
      const deadline = guaranteeDeadline({
        serviceDate: date,
        leadDays: 3,
        dueTime: parseTimeOfDay('12:00'),
        zone: denver,
        calendar: office,
      });
      expect(compareCalendarDates(deadline.date, date)).toBeLessThan(0);
      expect(daysBetween(deadline.date, date)).toBeGreaterThanOrEqual(3);
      expect(daysBetween(deadline.date, date)).toBeLessThanOrEqual(6);
    }
  });

  it('moves later as the lead gets shorter, never earlier', () => {
    for (const date of everyDayOf(2025)) {
      let previous: CalendarDate | undefined;
      for (const leadDays of [10, 7, 5, 3, 1]) {
        const deadline = guaranteeDeadline({
          serviceDate: date,
          leadDays,
          dueTime: parseTimeOfDay('12:00'),
          zone: denver,
          calendar: office,
        });
        if (previous !== undefined) {
          expect(compareCalendarDates(deadline.date, previous)).toBeGreaterThanOrEqual(0);
        }
        previous = deadline.date;
      }
    }
  });

  it('is a real instant on every one of them', () => {
    for (const date of everyDayOf(2025)) {
      const deadline = guaranteeDeadline({
        serviceDate: date,
        leadDays: 3,
        dueTime: parseTimeOfDay('12:00'),
        zone: denver,
        calendar: office,
      });
      const instant = toInstant(deadline);
      expect(Number.isFinite(instant)).toBe(true);
      expect(fromInstant(instant, denver).date).toBe(deadline.date);
    }
  });
});
