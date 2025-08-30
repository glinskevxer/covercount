/**
 * Reading what somebody typed.
 *
 * Commander hands every option through as a string, so each command was
 * turning that string into a number, a date or an identifier itself. Doing it
 * in seven places meant seven slightly different messages for the same
 * mistake, and one of them accepted a fractional minute. This is the one place
 * that reads an argument, and every refusal from here is a domain error with a
 * code on it, so the command line reports it as a refusal rather than a crash.
 */

import { calendarDate, type CalendarDate } from '../core/calendar.js';
import { invalidInput } from '../core/errors.js';
import {
  catalogCode,
  parseEntityId,
  type CatalogCode,
  type EntityId,
  type IdKind,
} from '../core/ids.js';
import { parseMoney, type CurrencyCode, type Money } from '../core/money.js';
import { isServiceStyle, type ServiceStyle } from '../property/types.js';

/** A whole number, zero or more, which is what most counts are. */
export function wholeNumber(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invalidInput('cli.number', `${label} takes a whole number, got ${value}`);
  }
  return parsed;
}

/** A whole number that is allowed to be negative, for an offset. */
export function wholeSigned(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw invalidInput('cli.number', `${label} takes a whole number, got ${value}`);
  }
  return parsed;
}

/** A percentage, turned into the parts per million a rate is held in. */
export function percentToPpm(label: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw invalidInput('cli.rate', `${label} takes a percentage, got ${value}`);
  }
  return Math.round(parsed * 10_000);
}

/**
 * A time on the clock, or one past midnight written as 25:30, which is how a
 * coordinator writes the end of a reception that runs late.
 */
export function blockMinute(label: string, value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) {
    throw invalidInput('cli.time', `${label} takes a time in HH:MM form, got ${value}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (minutes > 59) {
    throw invalidInput('cli.time', `${value} names minute ${minutes}`);
  }
  if (hours > 35) {
    throw invalidInput('cli.time', `${value} is too far into the following day`);
  }
  return hours * 60 + minutes;
}

export function entityArg<K extends IdKind>(kind: K, value: string): EntityId<K> {
  return parseEntityId(kind, value);
}

export function codeArg(value: string): CatalogCode {
  return catalogCode(value);
}

export function dateArg(value: string): CalendarDate {
  return calendarDate(value);
}

export function moneyArg(label: string, value: string, currency: CurrencyCode = 'USD'): Money {
  if (value.trim().length === 0) {
    throw invalidInput('cli.money', `${label} needs an amount`);
  }
  return parseMoney(value, currency);
}

export function serviceStyleArg(value: string): ServiceStyle {
  const style = value.trim().toUpperCase();
  if (!isServiceStyle(style)) {
    throw invalidInput('cli.style', `${value} is not a service style`);
  }
  return style;
}

/** Split a comma separated option into trimmed, non empty parts. */
export function listArg(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
