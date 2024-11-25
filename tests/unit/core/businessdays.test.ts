import { describe, expect, it } from 'vitest';
import {
  BusinessCalendar,
  BusinessCalendarError,
  defaultBusinessCalendar,
  isWeekendDate,
  sevenDayCalendar,
} from '../../../src/core/businessdays.js';
import { calendarDate } from '../../../src/core/calendar.js';

const d = calendarDate;

describe('the default sales office calendar', () => {
  const office = defaultBusinessCalendar();

  it('works Monday to Friday', () => {
    expect(office.isBusinessDay(d('2025-04-21'))).toBe(true);
    expect(office.isBusinessDay(d('2025-04-19'))).toBe(false);
    expect(office.isBusinessDay(d('2025-04-20'))).toBe(false);
    expect(office.isClosed(d('2025-04-20'))).toBe(true);
  });

  it('walks forward to the next open day', () => {
    expect(office.nextBusinessDayOnOrAfter(d('2025-04-19'))).toBe('2025-04-21');
    expect(office.nextBusinessDayOnOrAfter(d('2025-04-21'))).toBe('2025-04-21');
  });

  it('walks back to the previous open day', () => {
    expect(office.previousBusinessDayOnOrBefore(d('2025-04-20'))).toBe('2025-04-18');
    expect(office.previousBusinessDayOnOrBefore(d('2025-04-18'))).toBe('2025-04-18');
  });
});

describe('stepping business days', () => {
  const office = defaultBusinessCalendar();

  it('counts from the day after the anchor', () => {
    expect(office.addBusinessDays(d('2025-04-21'), -3)).toBe('2025-04-16');
    expect(office.addBusinessDays(d('2025-04-21'), 1)).toBe('2025-04-22');
  });

  it('skips the weekend on the way past', () => {
    expect(office.addBusinessDays(d('2025-04-18'), 1)).toBe('2025-04-21');
    expect(office.addBusinessDays(d('2025-04-21'), -1)).toBe('2025-04-18');
  });

  it('stays put on a step of zero', () => {
    expect(office.addBusinessDays(d('2025-04-19'), 0)).toBe('2025-04-19');
  });

  it('refuses a fractional step', () => {
    expect(() => office.addBusinessDays(d('2025-04-21'), 1.5)).toThrow(BusinessCalendarError);
  });

  it('counts business days between two dates', () => {
    expect(office.businessDaysBetween(d('2025-04-18'), d('2025-04-25'))).toBe(5);
    expect(office.businessDaysBetween(d('2025-04-25'), d('2025-04-18'))).toBe(-5);
    expect(office.businessDaysBetween(d('2025-04-21'), d('2025-04-21'))).toBe(0);
  });
});

describe('a house calendar with holidays', () => {
  const july = new BusinessCalendar({
    holidays: [d('2025-07-04'), d('2025-07-07')],
  });

  it('treats a holiday as closed even midweek', () => {
    expect(july.isBusinessDay(d('2025-07-04'))).toBe(false);
    expect(july.isBusinessDay(d('2025-07-07'))).toBe(false);
    expect(july.isBusinessDay(d('2025-07-08'))).toBe(true);
  });

  it('steps over a holiday and the weekend behind it', () => {
    expect(july.addBusinessDays(d('2025-07-08'), -1)).toBe('2025-07-03');
    expect(july.nextBusinessDayOnOrAfter(d('2025-07-04'))).toBe('2025-07-08');
  });

  it('reopens on a working exception', () => {
    const banquets = new BusinessCalendar({
      holidays: [d('2025-07-04')],
      workingExceptions: [d('2025-07-05')],
    });
    expect(banquets.isBusinessDay(d('2025-07-05'))).toBe(true);
    expect(banquets.addBusinessDays(d('2025-07-03'), 1)).toBe('2025-07-05');
  });

  it('refuses a date that is both a holiday and a working day', () => {
    expect(
      () =>
        new BusinessCalendar({
          holidays: [d('2025-07-04')],
          workingExceptions: [d('2025-07-04')],
        }),
    ).toThrow(/both a holiday and a working day/);
  });

  it('refuses a weekday index outside zero to six', () => {
    expect(() => new BusinessCalendar({ closedWeekdays: [7] })).toThrow(/not between 0 and 6/);
  });

  it('describes itself for a diagnostic line', () => {
    expect(july.describe()).toBe('closed weekdays 0,6, 2 holidays, 0 working exceptions');
  });
});

describe('the kitchen calendar', () => {
  it('works every day of the week', () => {
    const kitchen = sevenDayCalendar();
    expect(kitchen.isBusinessDay(d('2025-04-19'))).toBe(true);
    expect(kitchen.isBusinessDay(d('2025-04-20'))).toBe(true);
    expect(kitchen.addBusinessDays(d('2025-04-18'), 1)).toBe('2025-04-19');
  });

  it('still closes on the dates the property is dark', () => {
    const kitchen = sevenDayCalendar([d('2025-12-25')]);
    expect(kitchen.isBusinessDay(d('2025-12-25'))).toBe(false);
    expect(kitchen.nextBusinessDayOnOrAfter(d('2025-12-25'))).toBe('2025-12-26');
  });

  it('still reports the weekend for a caller that cares', () => {
    expect(isWeekendDate(d('2025-04-19'))).toBe(true);
    expect(isWeekendDate(d('2025-04-22'))).toBe(false);
  });
});
