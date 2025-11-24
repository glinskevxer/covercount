import { describe, expect, it } from 'vitest';
import {
  ClockError,
  MINUTES_PER_DAY,
  compareZoned,
  formatTimeOfDay,
  formatTimeOfDayShort,
  formatZoned,
  fromInstant,
  parseTimeOfDay,
  shiftTimeOfDay,
  shiftZoned,
  timeOfDay,
  formatBlockMinute,
  timeZone,
  toInstant,
  zoneOffsetMinutes,
  zonedDateTime,
} from '../../../src/core/clock.js';
import { calendarDate } from '../../../src/core/calendar.js';

const denver = timeZone('America/Denver');
const london = timeZone('Europe/London');

describe('a time of day', () => {
  it('is a minute of the day', () => {
    expect(timeOfDay(0)).toBe(0);
    expect(timeOfDay(MINUTES_PER_DAY - 1)).toBe(1439);
    expect(() => timeOfDay(MINUTES_PER_DAY)).toThrow(/not a minute of the day/);
    expect(() => timeOfDay(-1)).toThrow(ClockError);
    expect(() => timeOfDay(6.5)).toThrow(ClockError);
  });

  it('reads HH:MM', () => {
    expect(parseTimeOfDay('18:30')).toBe(1110);
    expect(parseTimeOfDay('7:00')).toBe(420);
    expect(parseTimeOfDay(' 00:00 ')).toBe(0);
  });

  it('refuses a time that is not on the clock', () => {
    expect(() => parseTimeOfDay('24:00')).toThrow(/names hour 24/);
    expect(() => parseTimeOfDay('12:60')).toThrow(/names minute 60/);
    expect(() => parseTimeOfDay('half seven')).toThrow(/HH:MM form/);
  });

  it('prints for a contract and for a run of show', () => {
    expect(formatTimeOfDay(timeOfDay(1110))).toBe('18:30');
    expect(formatTimeOfDay(timeOfDay(420))).toBe('07:00');
    expect(formatTimeOfDayShort(timeOfDay(1110))).toBe('6:30pm');
    expect(formatTimeOfDayShort(timeOfDay(1140))).toBe('7pm');
    expect(formatTimeOfDayShort(timeOfDay(0))).toBe('12am');
    expect(formatTimeOfDayShort(timeOfDay(720))).toBe('12pm');
  });
});

describe('shifting a time of day', () => {
  it('stays on the same day when it can', () => {
    expect(shiftTimeOfDay(timeOfDay(1140), -90)).toEqual({ time: 1050, dayShift: 0 });
  });

  it('reports the day it rolled onto', () => {
    expect(shiftTimeOfDay(timeOfDay(30), -60)).toEqual({ time: 1410, dayShift: -1 });
    expect(shiftTimeOfDay(timeOfDay(1410), 60)).toEqual({ time: 30, dayShift: 1 });
    expect(shiftTimeOfDay(timeOfDay(0), -MINUTES_PER_DAY)).toEqual({ time: 0, dayShift: -1 });
  });

  it('refuses a fractional shift', () => {
    expect(() => shiftTimeOfDay(timeOfDay(0), 1.5)).toThrow(ClockError);
  });
});

describe('naming a time zone', () => {
  it('accepts one the platform knows', () => {
    expect(timeZone('America/Denver')).toBe('America/Denver');
    expect(timeZone('UTC')).toBe('UTC');
  });

  it('refuses one it does not', () => {
    expect(() => timeZone('Middle/Earth')).toThrow(/not a time zone this platform knows/);
  });
});

describe('crossing between wall clock and instant', () => {
  it('reads an offset that changes with the season', () => {
    const winter = Date.UTC(2025, 0, 15, 12, 0, 0);
    const summer = Date.UTC(2025, 6, 15, 12, 0, 0);
    expect(zoneOffsetMinutes(winter, denver)).toBe(-420);
    expect(zoneOffsetMinutes(summer, denver)).toBe(-360);
    expect(zoneOffsetMinutes(winter, london)).toBe(0);
    expect(zoneOffsetMinutes(summer, london)).toBe(60);
  });

  it('round trips an ordinary evening', () => {
    const reading = zonedDateTime(calendarDate('2025-04-19'), parseTimeOfDay('19:00'), denver);
    const instant = toInstant(reading);
    expect(new Date(instant).toISOString()).toBe('2025-04-20T01:00:00.000Z');
    expect(fromInstant(instant, denver)).toEqual(reading);
  });

  it('pushes a reading the clocks skipped forward past the gap', () => {
    const skipped = zonedDateTime(calendarDate('2025-03-09'), parseTimeOfDay('02:30'), denver);
    const back = fromInstant(toInstant(skipped), denver);
    expect(back.date).toBe('2025-03-09');
    expect(formatTimeOfDay(back.time)).toBe('03:30');
  });

  it('takes the first of a reading that happened twice', () => {
    const doubled = zonedDateTime(calendarDate('2025-11-02'), parseTimeOfDay('01:30'), denver);
    const instant = toInstant(doubled);
    expect(new Date(instant).toISOString()).toBe('2025-11-02T07:30:00.000Z');
    expect(fromInstant(instant, denver)).toEqual(doubled);
  });

  it('keeps a service time on the clock across a transition', () => {
    const before = zonedDateTime(calendarDate('2025-11-01'), parseTimeOfDay('19:00'), denver);
    const after = zonedDateTime(calendarDate('2025-11-02'), parseTimeOfDay('19:00'), denver);
    expect(toInstant(after) - toInstant(before)).toBe(25 * 3600 * 1000);
  });
});

describe('shifting and comparing a zoned reading', () => {
  it('moves the wall clock and rolls the date', () => {
    const doors = zonedDateTime(calendarDate('2025-04-19'), parseTimeOfDay('00:30'), denver);
    expect(shiftZoned(doors, -60)).toEqual({
      date: '2025-04-18',
      time: 1410,
      zone: denver,
    });
  });

  it('orders two readings by the instant behind them', () => {
    const left = zonedDateTime(calendarDate('2025-04-19'), parseTimeOfDay('19:00'), denver);
    const right = zonedDateTime(calendarDate('2025-04-19'), parseTimeOfDay('19:00'), london);
    expect(compareZoned(right, left)).toBe(-1);
    expect(compareZoned(left, right)).toBe(1);
    expect(compareZoned(left, left)).toBe(0);
  });

  it('prints with its zone', () => {
    const reading = zonedDateTime(calendarDate('2025-04-19'), parseTimeOfDay('19:00'), denver);
    expect(formatZoned(reading)).toBe('2025-04-19 19:00 America/Denver');
  });
});

describe('printing a minute of a function block', () => {
  it('prints an ordinary evening time', () => {
    expect(formatBlockMinute(1080)).toBe('6pm');
    expect(formatBlockMinute(0)).toBe('12am');
    expect(formatBlockMinute(1439)).toBe('11:59pm');
  });

  it('marks a minute that has rolled into the next day', () => {
    expect(formatBlockMinute(1530)).toBe('1:30am (next day)');
    expect(formatBlockMinute(1440)).toBe('12am (next day)');
    expect(formatBlockMinute(1530, '+1')).toBe('1:30am+1');
  });

  it('marks a minute before the service date started', () => {
    expect(formatBlockMinute(-60)).toBe('11pm (prev)');
    expect(formatBlockMinute(-1)).toBe('11:59pm (prev)');
  });

  it('keeps the same reading whatever label the sheet uses', () => {
    for (const minute of [0, 600, 1080, 1439, 1440, 1530, 2100]) {
      const plain = formatBlockMinute(minute);
      const short = formatBlockMinute(minute, '+1');
      expect(plain.replace(' (next day)', '')).toBe(short.replace('+1', ''));
    }
  });
});
