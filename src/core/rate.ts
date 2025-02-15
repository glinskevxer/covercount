/**
 * A rate is held in parts per million.
 *
 * Basis points are not enough. A sales tax of 8.875 percent is a real rate in
 * more than one American county, and a hotel that quotes a 24.5 percent
 * service charge is ordinary. Parts per million holds both as integers and
 * leaves room for the odd fractional rate a municipality invents.
 */

import { DomainError } from './errors.js';
import { divideRound, type RoundingMode } from './rounding.js';
import { money, MoneyError, type Money } from './money.js';

export const PPM = 1_000_000;

export interface Rate {
  readonly ppm: number;
}

export class RateError extends DomainError {
  constructor(message: string) {
    super(message, { kind: 'invalid-input', code: 'rate.invalid' });
    this.name = 'RateError';
  }
}

export function rate(ppm: number): Rate {
  if (!Number.isSafeInteger(ppm)) {
    throw new RateError(`a rate is whole parts per million, got ${ppm}`);
  }
  return { ppm };
}

export const ZERO_RATE: Rate = { ppm: 0 };

export function rateFromPercent(percent: number): Rate {
  const ppm = percent * 10_000;
  if (Math.abs(ppm - Math.round(ppm)) > 1e-6) {
    throw new RateError(`${percent} percent does not land on a whole part per million`);
  }
  return rate(Math.round(ppm));
}

export function rateFromBasisPoints(basisPoints: number): Rate {
  if (!Number.isSafeInteger(basisPoints)) {
    throw new RateError(`basis points must be whole, got ${basisPoints}`);
  }
  return rate(basisPoints * 100);
}

export function ratePercent(value: Rate): number {
  return value.ppm / 10_000;
}

export function addRates(left: Rate, right: Rate): Rate {
  return rate(left.ppm + right.ppm);
}

export function isZeroRate(value: Rate): boolean {
  return value.ppm === 0;
}

export function formatRate(value: Rate): string {
  const percent = ratePercent(value);
  const fixed = percent.toFixed(4);
  const text = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return `${text}%`;
}

/** Apply a rate to an amount, keeping the whole calculation in integers. */
export function applyRate(amount: Money, value: Rate, mode: RoundingMode = 'half-up'): Money {
  const product = amount.amount * value.ppm;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyError('applying this rate would leave the exact integer range');
  }
  return money(divideRound(product, PPM, mode), amount.currency);
}

/**
 * Strip a rate that is already inside an amount. A package price quoted as
 * inclusive of service needs the service backed out before the food total can
 * be reported on its own.
 */
export function removeRate(amount: Money, value: Rate, mode: RoundingMode = 'half-up'): Money {
  const denominator = PPM + value.ppm;
  if (denominator === 0) {
    throw new RateError('cannot strip a rate of minus one hundred percent');
  }
  const product = amount.amount * PPM;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyError('stripping this rate would leave the exact integer range');
  }
  return money(divideRound(product, denominator, mode), amount.currency);
}
