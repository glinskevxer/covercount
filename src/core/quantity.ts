/**
 * A quantity is a whole number of thousandths of its unit.
 *
 * Thousandths is what a recipe card needs. A line reading a quarter teaspoon
 * of saffron is 250, a line reading eighty pounds of short rib is 80000, and
 * both survive being scaled to a six hundred cover function and converted into
 * whatever the purchase unit turns out to be.
 */

import {
  UnitError,
  conversionRatio,
  dimensionOf,
  unitInfo,
  unitsAreCompatible,
  type Dimension,
  type UnitCode,
} from './units.js';
import { divideRound, type RoundingMode } from './rounding.js';

export const MILLI = 1000;

export interface Quantity {
  /** Thousandths of `unit`. */
  readonly milli: number;
  readonly unit: UnitCode;
}

export function quantityFromMilli(milli: number, unit: UnitCode): Quantity {
  if (!Number.isSafeInteger(milli)) {
    throw new UnitError(`a quantity is a whole number of thousandths, got ${milli}`);
  }
  return { milli, unit };
}

/** Build from what a recipe card says, for example 2.5 and 'LB'. */
export function quantity(amount: number, unit: UnitCode): Quantity {
  const milli = amount * MILLI;
  if (Math.abs(milli - Math.round(milli)) > 1e-6) {
    throw new UnitError(`${amount} ${unit} is finer than a thousandth of a unit`);
  }
  return quantityFromMilli(Math.round(milli), unit);
}

export function zeroQuantity(unit: UnitCode): Quantity {
  return { milli: 0, unit };
}

export function isZeroQuantity(value: Quantity): boolean {
  return value.milli === 0;
}

export function quantityDimension(value: Quantity): Dimension {
  return dimensionOf(value.unit);
}

export function quantityToNumber(value: Quantity): number {
  return value.milli / MILLI;
}

/** Convert into another unit of the same dimension. */
export function convertQuantity(
  value: Quantity,
  to: UnitCode,
  mode: RoundingMode = 'half-up',
): Quantity {
  if (value.unit === to) {
    return value;
  }
  const ratio = conversionRatio(value.unit, to);
  const scaled = BigInt(value.milli) * ratio.num;
  const converted = bigDivideRound(scaled, ratio.den, mode);
  if (!Number.isSafeInteger(converted)) {
    throw new UnitError(`converting ${value.milli} ${value.unit} to ${to} leaves the exact range`);
  }
  return { milli: converted, unit: to };
}

function bigDivideRound(numerator: bigint, denominator: bigint, mode: RoundingMode): number {
  const negative = numerator < 0n !== denominator < 0n;
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absNumerator / absDenominator;
  const remainder = absNumerator - quotient * absDenominator;
  if (remainder === 0n) {
    return Number(negative ? -quotient : quotient);
  }
  // Fold the fractional part back through the integer rounder so the modes
  // behave identically whether or not the value needed BigInt to get here.
  const scale = 1_000_000n;
  const fraction = Number((remainder * scale) / absDenominator);
  const carry = divideRound(negative ? -fraction : fraction, Number(scale), mode);
  const whole = Number(negative ? -quotient : quotient);
  return whole + carry;
}

export function addQuantity(left: Quantity, right: Quantity): Quantity {
  requireCompatible(left, right, 'add');
  const aligned = convertQuantity(right, left.unit);
  return quantityFromMilli(left.milli + aligned.milli, left.unit);
}

export function subtractQuantity(left: Quantity, right: Quantity): Quantity {
  requireCompatible(left, right, 'subtract');
  const aligned = convertQuantity(right, left.unit);
  return quantityFromMilli(left.milli - aligned.milli, left.unit);
}

/** Scale by a whole count, which is what a recipe times covers looks like. */
export function scaleQuantity(value: Quantity, count: number): Quantity {
  if (!Number.isSafeInteger(count)) {
    throw new UnitError(`cannot scale a quantity by ${count}, expected a whole count`);
  }
  return quantityFromMilli(value.milli * count, value.unit);
}

/**
 * Scale by a ratio. Yield factors and batch sizes are both fractions and
 * neither of them is safe to hold as a decimal.
 */
export function scaleQuantityByRatio(
  value: Quantity,
  numerator: number,
  denominator: number,
  mode: RoundingMode = 'half-up',
): Quantity {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new UnitError('a scaling ratio is two whole numbers');
  }
  if (denominator === 0) {
    throw new UnitError('cannot scale a quantity by a ratio over zero');
  }
  const scaled = bigDivideRound(BigInt(value.milli) * BigInt(numerator), BigInt(denominator), mode);
  return quantityFromMilli(scaled, value.unit);
}

export function compareQuantity(left: Quantity, right: Quantity): number {
  requireCompatible(left, right, 'compare');
  const ratio = conversionRatio(right.unit, left.unit);
  const leftScaled = BigInt(left.milli) * ratio.den;
  const rightScaled = BigInt(right.milli) * ratio.num;
  if (leftScaled < rightScaled) return -1;
  if (leftScaled > rightScaled) return 1;
  return 0;
}

export function quantityEquals(left: Quantity, right: Quantity): boolean {
  return unitsAreCompatible(left.unit, right.unit) && compareQuantity(left, right) === 0;
}

export function maxQuantity(left: Quantity, right: Quantity): Quantity {
  return compareQuantity(left, right) >= 0 ? left : right;
}

function requireCompatible(left: Quantity, right: Quantity, verb: string): void {
  if (!unitsAreCompatible(left.unit, right.unit)) {
    throw new UnitError(
      `cannot ${verb} ${left.unit} and ${right.unit}, they measure different things`,
    );
  }
}

export interface FormatQuantityOptions {
  readonly decimals?: number;
  readonly longUnit?: boolean;
}

export function formatQuantity(value: Quantity, options: FormatQuantityOptions = {}): string {
  const decimals = options.decimals ?? 3;
  const amount = quantityToNumber(value);
  const fixed = amount.toFixed(decimals);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  if (options.longUnit !== true) {
    return `${trimmed} ${value.unit}`;
  }
  const info = unitInfo(value.unit);
  return `${trimmed} ${amount === 1 ? info.name : info.plural}`;
}
