import { describe, expect, it } from 'vitest';
import {
  CalendarError,
  addDays,
  addMonths,
  calendarDate,
  calendarDateParts,
  compareCalendarDates,
  daysBetween,
  daysInMonth,
  datesBetween,
  endOfMonth,
  formatCalendarDate,
  isCalendarDate,
  isLeapYear,
  isWeekend,
  maxCalendarDate,
  minCalendarDate,
  startOfMonth,
  weekdayIndex,
  weekdayName,
} from '../../../src/core/calendar.js';

describe('reading a date', () => {
  it('accepts an ISO date and keeps it as text', () => {
    expect(calendarDate('2025-04-19')).toBe('2025-04-19');
    expect(calendarDate('  2025-04-19  ')).toBe('2025-04-19');
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    expect(() => calendarDate('19/04/2025')).toThrow(/not a date in YYYY-MM-DD form/);
    expect(() => calendarDate('2025-4-9')).toThrow(CalendarError);
    expect(isCalendarDate('nonsense')).toBe(false);
  });

  it('refuses a month or a day that does not exist', () => {
    expect(() => calendarDate('2025-13-01')).toThrow(/names month 13/);
    expect(() => calendarDate('2025-02-30')).toThrow(/not in that month/);
    expect(() => calendarDate('2025-02-29')).toThrow(CalendarError);
    expect(calendarDate('2024-02-29')).toBe('2024-02-29');
  });

  it('splits into parts', () => {
    expect(calendarDateParts(calendarDate('2025-04-19'))).toEqual({
      year: 2025,
      month: 4,
      day: 19,
    });
  });
});

describe('month lengths', () => {
  it('knows the leap years', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2025)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('knows how long each month is', () => {
    expect(daysInMonth(2025, 1)).toBe(31);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 13)).toBe(0);
  });
});

describe('stepping a date', () => {
  it('adds and subtracts days across a month boundary', () => {
    expect(addDays(calendarDate('2025-04-30'), 1)).toBe('2025-05-01');
    expect(addDays(calendarDate('2025-01-01'), -1)).toBe('2024-12-31');
    expect(addDays(calendarDate('2024-02-28'), 1)).toBe('2024-02-29');
  });

  it('counts days between two dates in both directions', () => {
    expect(daysBetween(calendarDate('2025-04-01'), calendarDate('2025-04-19'))).toBe(18);
    expect(daysBetween(calendarDate('2025-04-19'), calendarDate('2025-04-01'))).toBe(-18);
    expect(daysBetween(calendarDate('2024-12-25'), calendarDate('2025-01-01'))).toBe(7);
  });

  it('refuses a fractional step', () => {
    expect(() => addDays(calendarDate('2025-01-01'), 1.5)).toThrow(/cannot step a date/);
  });

  it('adds months and clamps onto a short month', () => {
    expect(addMonths(calendarDate('2025-01-31'), 1)).toBe('2025-02-28');
    expect(addMonths(calendarDate('2024-01-31'), 1)).toBe('2024-02-29');
    expect(addMonths(calendarDate('2025-11-15'), 2)).toBe('2026-01-15');
    expect(addMonths(calendarDate('2025-01-15'), -1)).toBe('2024-12-15');
  });

  it('finds the ends of a month', () => {
    expect(startOfMonth(calendarDate('2025-04-19'))).toBe('2025-04-01');
    expect(endOfMonth(calendarDate('2025-04-19'))).toBe('2025-04-30');
    expect(endOfMonth(calendarDate('2024-02-05'))).toBe('2024-02-29');
  });
});

describe('ordering and weekdays', () => {
  it('orders as text, which is the same as by date', () => {
    expect(compareCalendarDates(calendarDate('2025-01-01'), calendarDate('2025-01-02'))).toBe(-1);
    expect(compareCalendarDates(calendarDate('2025-01-02'), calendarDate('2025-01-01'))).toBe(1);
    expect(compareCalendarDates(calendarDate('2025-01-01'), calendarDate('2025-01-01'))).toBe(0);
    expect(minCalendarDate(calendarDate('2025-01-02'), calendarDate('2025-01-01'))).toBe(
      '2025-01-01',
    );
    expect(maxCalendarDate(calendarDate('2025-01-02'), calendarDate('2025-01-01'))).toBe(
      '2025-01-02',
    );
  });

  it('names the weekday', () => {
    expect(weekdayIndex(calendarDate('2025-04-19'))).toBe(6);
    expect(weekdayName(calendarDate('2025-04-19'))).toBe('Saturday');
    expect(weekdayName(calendarDate('2025-04-21'))).toBe('Monday');
    expect(isWeekend(calendarDate('2025-04-19'))).toBe(true);
    expect(isWeekend(calendarDate('2025-04-21'))).toBe(false);
  });
});

describe('date ranges and display', () => {
  it('lists an inclusive range', () => {
    const range = datesBetween(calendarDate('2025-04-01'), calendarDate('2025-04-04'));
    expect(range).toEqual(['2025-04-01', '2025-04-02', '2025-04-03', '2025-04-04']);
  });

  it('refuses a backwards range', () => {
    expect(() => datesBetween(calendarDate('2025-04-04'), calendarDate('2025-04-01'))).toThrow(
      /falls after/,
    );
  });

  it('formats the way a banquet event order prints it', () => {
    expect(formatCalendarDate(calendarDate('2025-04-19'))).toBe('Sat 19 Apr 2025');
    expect(formatCalendarDate(calendarDate('2024-12-31'))).toBe('Tue 31 Dec 2024');
  });
});
