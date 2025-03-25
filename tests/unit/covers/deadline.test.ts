import { describe, expect, it } from 'vitest';
import {
  deadlineHasPassed,
  guaranteeDeadline,
  guaranteeDeadlineFor,
  hoursUntilDeadline,
  kitchenCalendar,
  officeCalendar,
} from '../../../src/covers/deadline.js';
import { BusinessCalendar, defaultBusinessCalendar } from '../../../src/core/businessdays.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { formatZoned, parseTimeOfDay, timeZone, toInstant } from '../../../src/core/clock.js';
import type { HouseCalendarEntry, Property } from '../../../src/property/types.js';
import { catalogCode } from '../../../src/core/ids.js';
import { rateFromPercent } from '../../../src/core/rate.js';

const d = calendarDate;
const denver = timeZone('America/Denver');

const property: Property = {
  code: catalogCode('CANYON'),
  name: 'Canyon Ridge Hotel',
  timeZone: denver,
  currency: 'USD',
  guaranteeLeadDays: 3,
  guaranteeDueTime: parseTimeOfDay('12:00'),
  oversetRate: rateFromPercent(5),
  oversetCap: 25,
  createdAt: '2025-01-06T09:00:00.000Z',
};

describe('counting the deadline back', () => {
  it('counts three business days back from a Saturday function', () => {
    const deadline = guaranteeDeadline({
      serviceDate: d('2025-04-19'),
      leadDays: 3,
      dueTime: parseTimeOfDay('12:00'),
      zone: denver,
      calendar: defaultBusinessCalendar(),
    });
    expect(formatZoned(deadline)).toBe('2025-04-16 12:00 America/Denver');
  });

  it('counts three business days back from a Monday function, skipping the weekend', () => {
    const deadline = guaranteeDeadline({
      serviceDate: d('2025-04-21'),
      leadDays: 3,
      dueTime: parseTimeOfDay('12:00'),
      zone: denver,
      calendar: defaultBusinessCalendar(),
    });
    expect(deadline.date).toBe('2025-04-16');
  });

  it('moves the deadline earlier when the office is closed for a holiday', () => {
    const withHoliday = new BusinessCalendar({ holidays: [d('2025-04-18')] });
    const deadline = guaranteeDeadline({
      serviceDate: d('2025-04-21'),
      leadDays: 3,
      dueTime: parseTimeOfDay('12:00'),
      zone: denver,
      calendar: withHoliday,
    });
    expect(deadline.date).toBe('2025-04-15');
  });

  it('takes the property settings when it is handed one', () => {
    const deadline = guaranteeDeadlineFor(property, d('2025-04-19'), defaultBusinessCalendar());
    expect(deadline.date).toBe('2025-04-16');
    expect(deadline.time).toBe(720);
    expect(deadline.zone).toBe(denver);
  });

  it('takes a longer lead where the property sets one', () => {
    const longer = guaranteeDeadlineFor(
      { ...property, guaranteeLeadDays: 10 },
      d('2025-04-19'),
      defaultBusinessCalendar(),
    );
    expect(longer.date).toBe('2025-04-07');
  });

  it('lands on the service date itself when the lead is zero', () => {
    const same = guaranteeDeadlineFor(
      { ...property, guaranteeLeadDays: 0 },
      d('2025-04-19'),
      defaultBusinessCalendar(),
    );
    expect(same.date).toBe('2025-04-19');
  });
});

describe('building the calendars off the property file', () => {
  const entries: HouseCalendarEntry[] = [
    { calendar: 'office', date: d('2025-04-18'), kind: 'closed', note: 'Good Friday' },
    { calendar: 'office', date: d('2025-04-19'), kind: 'open', note: 'catch up day' },
    { calendar: 'kitchen', date: d('2025-12-25'), kind: 'closed', note: 'property dark' },
  ];

  it('takes only the office rows into the office calendar', () => {
    const office = officeCalendar(entries);
    expect(office.isBusinessDay(d('2025-04-18'))).toBe(false);
    expect(office.isBusinessDay(d('2025-04-19'))).toBe(true);
    expect(office.isBusinessDay(d('2025-12-25'))).toBe(true);
  });

  it('takes only the kitchen rows into a calendar that works weekends', () => {
    const kitchen = kitchenCalendar(entries);
    expect(kitchen.isBusinessDay(d('2025-04-19'))).toBe(true);
    expect(kitchen.isBusinessDay(d('2025-04-20'))).toBe(true);
    expect(kitchen.isBusinessDay(d('2025-04-18'))).toBe(true);
    expect(kitchen.isBusinessDay(d('2025-12-25'))).toBe(false);
  });
});

describe('reading the deadline against a clock', () => {
  const deadline = guaranteeDeadlineFor(property, d('2025-04-19'), defaultBusinessCalendar());

  it('has not passed a minute before', () => {
    const justBefore = new Date(toInstant(deadline) - 60_000).toISOString();
    expect(deadlineHasPassed(deadline, justBefore)).toBe(false);
  });

  it('has passed on the minute and after', () => {
    expect(deadlineHasPassed(deadline, new Date(toInstant(deadline)).toISOString())).toBe(true);
    const later = new Date(toInstant(deadline) + 60_000).toISOString();
    expect(deadlineHasPassed(deadline, later)).toBe(true);
  });

  it('reads a clock that is not a clock as not passed', () => {
    expect(deadlineHasPassed(deadline, 'sometime Tuesday')).toBe(false);
    expect(hoursUntilDeadline(deadline, 'sometime Tuesday')).toBe(0);
  });

  it('counts the hours left and goes negative behind it', () => {
    const dayBefore = new Date(toInstant(deadline) - 24 * 3_600_000).toISOString();
    expect(hoursUntilDeadline(deadline, dayBefore)).toBe(24);
    const dayAfter = new Date(toInstant(deadline) + 24 * 3_600_000).toISOString();
    expect(hoursUntilDeadline(deadline, dayAfter)).toBe(-24);
  });

  it('measures against the wall clock at the property, not against UTC', () => {
    const winter = guaranteeDeadlineFor(property, d('2025-01-20'), defaultBusinessCalendar());
    const summer = guaranteeDeadlineFor(property, d('2025-07-21'), defaultBusinessCalendar());
    expect(new Date(toInstant(winter)).toISOString()).toBe('2025-01-15T19:00:00.000Z');
    expect(new Date(toInstant(summer)).toISOString()).toBe('2025-07-16T18:00:00.000Z');
  });
});
