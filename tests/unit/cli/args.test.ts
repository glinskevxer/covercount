import { describe, expect, it } from 'vitest';
import {
  blockMinute,
  codeArg,
  dateArg,
  entityArg,
  listArg,
  moneyArg,
  percentToPpm,
  serviceStyleArg,
  wholeNumber,
  wholeSigned,
} from '../../../src/cli/args.js';
import { DomainError } from '../../../src/core/errors.js';

describe('numbers off the command line', () => {
  it('takes a whole count and refuses anything else', () => {
    expect(wholeNumber('covers', '180')).toBe(180);
    expect(wholeNumber('covers', '0')).toBe(0);
    expect(() => wholeNumber('covers', '1.5')).toThrow(/covers takes a whole number, got 1.5/);
    expect(() => wholeNumber('covers', '-1')).toThrow(/whole number/);
    expect(() => wholeNumber('covers', 'lots')).toThrow(DomainError);
  });

  it('lets an offset be negative', () => {
    expect(wholeSigned('offset', '-180')).toBe(-180);
    expect(wholeSigned('offset', '45')).toBe(45);
    expect(() => wholeSigned('offset', '1.5')).toThrow(/whole number/);
  });

  it('turns a percentage into parts per million', () => {
    expect(percentToPpm('service charge', '22')).toBe(220_000);
    expect(percentToPpm('tax', '8.81')).toBe(88_100);
    expect(percentToPpm('tax', '0')).toBe(0);
    expect(() => percentToPpm('tax', '-1')).toThrow(/takes a percentage/);
    expect(() => percentToPpm('tax', 'lots')).toThrow(/takes a percentage/);
  });
});

describe('times off the command line', () => {
  it('reads a time on the clock', () => {
    expect(blockMinute('start', '18:00')).toBe(1080);
    expect(blockMinute('start', '7:30')).toBe(450);
    expect(blockMinute('start', ' 00:00 ')).toBe(0);
  });

  it('reads one past midnight', () => {
    expect(blockMinute('end', '25:30')).toBe(1530);
    expect(blockMinute('end', '35:00')).toBe(2100);
  });

  it('refuses a minute that is not one and an hour too far out', () => {
    expect(() => blockMinute('start', '12:60')).toThrow(/names minute 60/);
    expect(() => blockMinute('end', '36:00')).toThrow(/too far into the following day/);
    expect(() => blockMinute('start', 'sixish')).toThrow(/HH:MM form/);
  });
});

describe('the other argument readers', () => {
  it('reads an identifier of the right kind', () => {
    expect(entityArg('booking', 'bk-2025-0142')).toBe('BK-2025-0142');
    expect(() => entityArg('booking', 'FN-2025-0142')).toThrow(/is a FN identifier/);
  });

  it('reads a catalog code, a date and an amount', () => {
    expect(codeArg(' short-rib ')).toBe('SHORT-RIB');
    expect(dateArg('2025-04-18')).toBe('2025-04-18');
    expect(moneyArg('unit', '89.50').amount).toBe(8950);
    expect(() => moneyArg('unit', '  ')).toThrow(/needs an amount/);
    expect(() => dateArg('Friday')).toThrow(/YYYY-MM-DD/);
  });

  it('reads a service style and refuses one it does not know', () => {
    expect(serviceStyleArg('plated')).toBe('PLATED');
    expect(() => serviceStyleArg('TAPAS')).toThrow(/not a service style/);
  });

  it('splits a comma separated list and drops the empties', () => {
    expect(listArg('GRAND-A, GRAND-B')).toEqual(['GRAND-A', 'GRAND-B']);
    expect(listArg('GRAND-A,,')).toEqual(['GRAND-A']);
    expect(listArg('   ')).toEqual([]);
  });
});
