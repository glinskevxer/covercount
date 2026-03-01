/**
 * Units of measure for a kitchen that buys in cases and cooks in cups.
 *
 * Every unit is defined as an exact rational of its dimension's base unit:
 * each for a count, the gram for mass, the millilitre for volume. The rationals
 * are exact, not decimal approximations, because a recipe scaled from four
 * portions to eight hundred and then rolled up across a menu will drift
 * visibly otherwise. The conversion itself runs in BigInt so no intermediate
 * product has to fit in a double.
 */

import { DomainError } from './errors.js';

/** The three things this kitchen measures. Nothing iterates them. */
export type Dimension = 'count' | 'mass' | 'volume';

export interface UnitInfo {
  readonly code: string;
  readonly dimension: Dimension;
  readonly name: string;
  readonly plural: string;
  /** Numerator of this unit expressed in base units. */
  readonly num: number;
  /** Denominator of this unit expressed in base units. */
  readonly den: number;
}

export const UNITS = {
  EA: { code: 'EA', dimension: 'count', name: 'each', plural: 'each', num: 1, den: 1 },
  DZ: { code: 'DZ', dimension: 'count', name: 'dozen', plural: 'dozen', num: 12, den: 1 },

  MG: { code: 'MG', dimension: 'mass', name: 'milligram', plural: 'milligrams', num: 1, den: 1000 },
  G: { code: 'G', dimension: 'mass', name: 'gram', plural: 'grams', num: 1, den: 1 },
  KG: { code: 'KG', dimension: 'mass', name: 'kilogram', plural: 'kilograms', num: 1000, den: 1 },
  OZ: {
    code: 'OZ',
    dimension: 'mass',
    name: 'ounce',
    plural: 'ounces',
    num: 45359237,
    den: 1600000,
  },
  LB: {
    code: 'LB',
    dimension: 'mass',
    name: 'pound',
    plural: 'pounds',
    num: 45359237,
    den: 100000,
  },

  ML: {
    code: 'ML',
    dimension: 'volume',
    name: 'millilitre',
    plural: 'millilitres',
    num: 1,
    den: 1,
  },
  L: { code: 'L', dimension: 'volume', name: 'litre', plural: 'litres', num: 1000, den: 1 },
  TSP: {
    code: 'TSP',
    dimension: 'volume',
    name: 'teaspoon',
    plural: 'teaspoons',
    num: 473176473,
    den: 96000000,
  },
  TBSP: {
    code: 'TBSP',
    dimension: 'volume',
    name: 'tablespoon',
    plural: 'tablespoons',
    num: 473176473,
    den: 32000000,
  },
  FLOZ: {
    code: 'FLOZ',
    dimension: 'volume',
    name: 'fluid ounce',
    plural: 'fluid ounces',
    num: 473176473,
    den: 16000000,
  },
  CUP: {
    code: 'CUP',
    dimension: 'volume',
    name: 'cup',
    plural: 'cups',
    num: 473176473,
    den: 2000000,
  },
  PT: {
    code: 'PT',
    dimension: 'volume',
    name: 'pint',
    plural: 'pints',
    num: 473176473,
    den: 1000000,
  },
  QT: {
    code: 'QT',
    dimension: 'volume',
    name: 'quart',
    plural: 'quarts',
    num: 473176473,
    den: 500000,
  },
  GAL: {
    code: 'GAL',
    dimension: 'volume',
    name: 'gallon',
    plural: 'gallons',
    num: 473176473,
    den: 125000,
  },
} as const satisfies Record<string, UnitInfo>;

export type UnitCode = keyof typeof UNITS;

export const UNIT_CODES = Object.keys(UNITS) as UnitCode[];

export class UnitError extends DomainError {
  constructor(message: string) {
    super(message, { kind: 'invalid-input', code: 'unit.invalid' });
    this.name = 'UnitError';
  }
}

export function isUnitCode(value: string): value is UnitCode {
  return Object.prototype.hasOwnProperty.call(UNITS, value);
}

export function unitInfo(unit: UnitCode): UnitInfo {
  return UNITS[unit];
}

export function dimensionOf(unit: UnitCode): Dimension {
  return UNITS[unit].dimension;
}

export function unitsAreCompatible(left: UnitCode, right: UnitCode): boolean {
  return UNITS[left].dimension === UNITS[right].dimension;
}

export function parseUnitCode(value: string): UnitCode {
  const upper = value.trim().toUpperCase();
  if (!isUnitCode(upper)) {
    throw new UnitError(`${JSON.stringify(value)} is not a unit this kitchen keeps`);
  }
  return upper;
}

/**
 * Exact ratio between two units of the same dimension, as a BigInt fraction.
 * Callers multiply by the numerator and divide by the denominator, so no
 * intermediate value ever has to be representable as a double.
 */
export function conversionRatio(from: UnitCode, to: UnitCode): { num: bigint; den: bigint } {
  const source = UNITS[from];
  const target = UNITS[to];
  if (source.dimension !== target.dimension) {
    throw new UnitError(
      `cannot convert ${source.code} to ${target.code}, one is ${source.dimension} and the other is ${target.dimension}`,
    );
  }
  return {
    num: BigInt(source.num) * BigInt(target.den),
    den: BigInt(source.den) * BigInt(target.num),
  };
}
