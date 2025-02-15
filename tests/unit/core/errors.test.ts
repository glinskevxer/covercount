import { describe, expect, it } from 'vitest';
import {
  DomainError,
  capacityExceeded,
  conflict,
  deadlinePassed,
  describeError,
  invalidInput,
  isDomainError,
  notFound,
  notPermitted,
  ruleViolation,
} from '../../../src/core/errors.js';
import { BusinessCalendar } from '../../../src/core/businessdays.js';
import { CalendarError, calendarDate } from '../../../src/core/calendar.js';
import { ClockError, timeZone } from '../../../src/core/clock.js';
import { MoneyError, money } from '../../../src/core/money.js';
import { RateError, rate } from '../../../src/core/rate.js';
import { divideRound } from '../../../src/core/rounding.js';
import { parseUnitCode } from '../../../src/core/units.js';

describe('building a refusal', () => {
  it('carries a kind and a code', () => {
    const error = invalidInput('menu.price', 'a course price cannot be negative');
    expect(error).toBeInstanceOf(DomainError);
    expect(error.kind).toBe('invalid-input');
    expect(error.code).toBe('menu.price');
    expect(error.message).toBe('a course price cannot be negative');
    expect(error.subject).toBeUndefined();
  });

  it('names the subject that was missing', () => {
    const error = notFound('booking.missing', 'BK-2025-0142');
    expect(error.kind).toBe('not-found');
    expect(error.subject).toBe('BK-2025-0142');
    expect(error.message).toBe('BK-2025-0142 is not on file');
  });

  it('takes a message over the default when one is given', () => {
    const error = notFound('space.missing', 'GRAND', 'the Grand Ballroom is not in this property');
    expect(error.message).toBe('the Grand Ballroom is not in this property');
  });

  it('builds each of the other kinds', () => {
    expect(conflict('space.double', 'already held', 'GRAND').kind).toBe('conflict');
    expect(conflict('space.double', 'already held', 'GRAND').subject).toBe('GRAND');
    expect(ruleViolation('cover.lower', 'cannot lower').kind).toBe('rule-violation');
    expect(deadlinePassed('cover.cutoff', 'the guarantee closed').kind).toBe('deadline-passed');
    expect(capacityExceeded('space.capacity', 'over the fire limit').kind).toBe(
      'capacity-exceeded',
    );
    expect(notPermitted('beo.signed', 'a signed order is read only').kind).toBe('not-permitted');
  });

  it('carries an optional hint', () => {
    const error = ruleViolation('cover.lower', 'cannot lower', 'raise it instead');
    expect(error.hint).toBe('raise it instead');
  });
});

describe('reporting a refusal', () => {
  it('serialises to a flat object', () => {
    const error = new DomainError('the guarantee closed on Wednesday', {
      kind: 'deadline-passed',
      code: 'cover.cutoff',
      subject: 'BK-2025-0142',
      hint: 'raise the count instead',
    });
    expect(error.toJSON()).toEqual({
      error: 'cover.cutoff',
      kind: 'deadline-passed',
      message: 'the guarantee closed on Wednesday',
      subject: 'BK-2025-0142',
      hint: 'raise the count instead',
    });
  });

  it('leaves absent fields out of the object', () => {
    expect(Object.keys(invalidInput('x.y', 'no').toJSON()).sort()).toEqual([
      'error',
      'kind',
      'message',
    ]);
  });

  it('recognises its own errors and describes anything else', () => {
    expect(isDomainError(invalidInput('x.y', 'no'))).toBe(true);
    expect(isDomainError(new Error('boom'))).toBe(false);
    expect(describeError(invalidInput('x.y', 'no'))).toBe('x.y: no');
    expect(describeError(new TypeError('boom'))).toBe('TypeError: boom');
    expect(describeError('a string')).toBe('a string');
  });
});

describe('every refusal the core raises is a domain error', () => {
  it('covers money, rates, rounding, units, dates, clocks and calendars', () => {
    const raisers: [string, () => unknown][] = [
      ['money', () => money(1.5, 'USD')],
      ['rate', () => rate(1.5)],
      ['rounding', () => divideRound(1, 0, 'half-up')],
      ['unit', () => parseUnitCode('scoop')],
      ['calendar', () => calendarDate('4th July')],
      ['clock', () => timeZone('Middle/Earth')],
      ['business calendar', () => new BusinessCalendar({ closedWeekdays: [9] })],
    ];
    for (const [label, raise] of raisers) {
      try {
        raise();
        expect.unreachable(`${label} should have refused`);
      } catch (error) {
        expect(isDomainError(error), `${label} raised ${String(error)}`).toBe(true);
        expect((error as DomainError).kind).toBe('invalid-input');
        expect((error as DomainError).code).toMatch(/^[a-z]+\.[a-z]+$/);
      }
    }
  });

  it('keeps the class names so a caller can still narrow on them', () => {
    expect(() => money(1.5, 'USD')).toThrow(MoneyError);
    expect(() => rate(1.5)).toThrow(RateError);
    expect(() => calendarDate('nope')).toThrow(CalendarError);
    expect(() => timeZone('Middle/Earth')).toThrow(ClockError);
  });
});
