/**
 * Rounding a banquet department can defend.
 *
 * Service charge, tax and a per person price split across two payers all land
 * on a fraction of a cent. Which way that fraction goes is a contract term,
 * not a preference, so the mode travels with the calculation rather than
 * living in a global setting.
 */

import { DomainError } from './errors.js';

export const ROUNDING_MODES = ['half-up', 'half-even', 'up', 'down', 'toward-zero'] as const;

export type RoundingMode = (typeof ROUNDING_MODES)[number];

export class RoundingError extends DomainError {
  constructor(message: string) {
    super(message, { kind: 'invalid-input', code: 'rounding.invalid' });
    this.name = 'RoundingError';
  }
}

export function isRoundingMode(value: string): value is RoundingMode {
  return (ROUNDING_MODES as readonly string[]).includes(value);
}

/**
 * Round a numerator over a denominator to a whole number without ever forming
 * the quotient as a float. Both arguments stay integral so a 22 percent
 * service charge on a six figure food total is exact.
 */
export function divideRound(numerator: number, denominator: number, mode: RoundingMode): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RoundingError('divideRound works on safe integers only');
  }
  if (denominator === 0) {
    throw new RoundingError('cannot round with a zero denominator');
  }
  const negative = numerator < 0 !== denominator < 0;
  const absNumerator = Math.abs(numerator);
  const absDenominator = Math.abs(denominator);
  const quotient = Math.floor(absNumerator / absDenominator);
  const remainder = absNumerator - quotient * absDenominator;
  if (remainder === 0) {
    return negative ? -quotient : quotient;
  }
  const twice = remainder * 2;
  let rounded = quotient;
  switch (mode) {
    case 'half-up':
      rounded = twice >= absDenominator ? quotient + 1 : quotient;
      break;
    case 'half-even':
      if (twice > absDenominator) rounded = quotient + 1;
      else if (twice < absDenominator) rounded = quotient;
      else rounded = quotient % 2 === 0 ? quotient : quotient + 1;
      break;
    case 'up':
      rounded = negative ? quotient : quotient + 1;
      break;
    case 'down':
      rounded = negative ? quotient + 1 : quotient;
      break;
    case 'toward-zero':
      rounded = quotient;
      break;
  }
  return negative ? -rounded : rounded;
}

/**
 * Largest remainder. Hand back exactly `total`, split in the given weights,
 * with the leftover units going to the shares that were cut hardest. Ties go
 * to the earlier share so a split is stable when it is recomputed.
 */
export function allocateByWeight(total: number, weights: readonly number[]): number[] {
  if (!Number.isSafeInteger(total)) {
    throw new RoundingError('can only allocate a whole number of units');
  }
  if (weights.length === 0) {
    throw new RoundingError('cannot allocate across an empty set of weights');
  }
  let weightTotal = 0;
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RoundingError(`allocation weight ${weight} must be zero or more`);
    }
    weightTotal += weight;
  }
  if (weightTotal === 0) {
    throw new RoundingError('cannot allocate across weights that are all zero');
  }

  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const shares: number[] = [];
  const remainders: { index: number; remainder: number }[] = [];
  let handedOut = 0;

  for (const [index, weight] of weights.entries()) {
    const exact = (magnitude * weight) / weightTotal;
    const floor = Math.floor(exact);
    shares.push(floor);
    remainders.push({ index, remainder: exact - floor });
    handedOut += floor;
  }

  remainders.sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  let leftover = magnitude - handedOut;
  for (const entry of remainders) {
    if (leftover <= 0) break;
    shares[entry.index] = (shares[entry.index] ?? 0) + 1;
    leftover -= 1;
  }

  return sign === -1 ? shares.map((share) => (share === 0 ? 0 : -share)) : shares;
}

/** Round a whole count up to the next multiple of `step`. */
export function roundUpToStep(value: number, step: number): number {
  if (!Number.isSafeInteger(value) || !Number.isSafeInteger(step)) {
    throw new RoundingError('roundUpToStep works on safe integers only');
  }
  if (step <= 0) {
    throw new RoundingError(`step must be positive, got ${step}`);
  }
  return Math.ceil(value / step) * step;
}
