import { describe, expect, it } from 'vitest';
import {
  UNITS,
  UNIT_CODES,
  UnitError,
  conversionRatio,
  dimensionOf,
  isUnitCode,
  parseUnitCode,
  unitsAreCompatible,
} from '../../../src/core/units.js';
import {
  addQuantity,
  compareQuantity,
  convertQuantity,
  formatQuantity,
  isZeroQuantity,
  maxQuantity,
  quantity,
  quantityDimension,
  quantityEquals,
  quantityFromMilli,
  quantityToNumber,
  scaleQuantity,
  scaleQuantityByRatio,
  subtractQuantity,
  zeroQuantity,
} from '../../../src/core/quantity.js';

describe('the unit table', () => {
  it('names every unit consistently with its key', () => {
    for (const code of UNIT_CODES) {
      expect(UNITS[code].code).toBe(code);
      expect(UNITS[code].den).toBeGreaterThan(0);
      expect(UNITS[code].num).toBeGreaterThan(0);
    }
  });

  it('sorts units into count, mass and volume', () => {
    expect(dimensionOf('DZ')).toBe('count');
    expect(dimensionOf('LB')).toBe('mass');
    expect(dimensionOf('GAL')).toBe('volume');
    expect(unitsAreCompatible('LB', 'OZ')).toBe(true);
    expect(unitsAreCompatible('LB', 'QT')).toBe(false);
  });

  it('reads a unit code case insensitively', () => {
    expect(parseUnitCode(' lb ')).toBe('LB');
    expect(isUnitCode('LB')).toBe(true);
    expect(isUnitCode('SCOOP')).toBe(false);
    expect(() => parseUnitCode('scoop')).toThrow(/not a unit this kitchen keeps/);
  });

  it('refuses a ratio across dimensions', () => {
    expect(() => conversionRatio('LB', 'GAL')).toThrow(/one is mass and the other is volume/);
  });
});

describe('building a quantity', () => {
  it('reads a decimal off a recipe card', () => {
    expect(quantity(2.5, 'LB')).toEqual({ milli: 2500, unit: 'LB' });
    expect(quantity(0.25, 'TSP')).toEqual({ milli: 250, unit: 'TSP' });
    expect(quantity(80, 'LB').milli).toBe(80000);
  });

  it('refuses anything finer than a thousandth', () => {
    expect(() => quantity(0.0001, 'LB')).toThrow(/finer than a thousandth/);
    expect(() => quantityFromMilli(1.5, 'LB')).toThrow(UnitError);
  });

  it('reports zero and reads back as a number', () => {
    expect(isZeroQuantity(zeroQuantity('EA'))).toBe(true);
    expect(quantityToNumber(quantity(2.5, 'LB'))).toBe(2.5);
    expect(quantityDimension(quantity(1, 'CUP'))).toBe('volume');
  });
});

describe('converting between units', () => {
  it('converts a pound into ounces exactly', () => {
    expect(convertQuantity(quantity(1, 'LB'), 'OZ')).toEqual({ milli: 16000, unit: 'OZ' });
    expect(convertQuantity(quantity(80, 'LB'), 'OZ').milli).toBe(1_280_000);
  });

  it('converts the whole US volume chain off one gallon', () => {
    const gallon = quantity(1, 'GAL');
    expect(convertQuantity(gallon, 'QT').milli).toBe(4000);
    expect(convertQuantity(gallon, 'PT').milli).toBe(8000);
    expect(convertQuantity(gallon, 'CUP').milli).toBe(16000);
    expect(convertQuantity(gallon, 'FLOZ').milli).toBe(128000);
    expect(convertQuantity(gallon, 'TBSP').milli).toBe(256000);
    expect(convertQuantity(gallon, 'TSP').milli).toBe(768000);
  });

  it('crosses into metric on the defined value', () => {
    expect(convertQuantity(quantity(1, 'LB'), 'G').milli).toBe(453592);
    expect(convertQuantity(quantity(1, 'GAL'), 'ML').milli).toBe(3785412);
    expect(convertQuantity(quantity(1, 'KG'), 'G').milli).toBe(1_000_000);
  });

  it('returns the same object when the unit already matches', () => {
    const value = quantity(3, 'LB');
    expect(convertQuantity(value, 'LB')).toBe(value);
  });

  it('honours the rounding mode on a conversion that does not land', () => {
    const oneGram = quantity(1, 'G');
    expect(convertQuantity(oneGram, 'OZ', 'down').milli).toBe(35);
    expect(convertQuantity(oneGram, 'OZ', 'up').milli).toBe(36);
  });

  it('refuses a conversion across dimensions', () => {
    expect(() => convertQuantity(quantity(1, 'LB'), 'GAL')).toThrow(UnitError);
  });
});

describe('quantity arithmetic', () => {
  it('adds in the unit on the left', () => {
    const total = addQuantity(quantity(1, 'LB'), quantity(8, 'OZ'));
    expect(total).toEqual({ milli: 1500, unit: 'LB' });
  });

  it('subtracts across units', () => {
    expect(subtractQuantity(quantity(1, 'GAL'), quantity(1, 'QT'))).toEqual({
      milli: 750,
      unit: 'GAL',
    });
  });

  it('scales by a cover count', () => {
    expect(scaleQuantity(quantity(0.25, 'LB'), 320).milli).toBe(80000);
    expect(() => scaleQuantity(quantity(1, 'LB'), 1.5)).toThrow(/whole count/);
  });

  it('scales by a yield ratio', () => {
    expect(scaleQuantityByRatio(quantity(10, 'LB'), 100, 85).milli).toBe(11765);
    expect(scaleQuantityByRatio(quantity(10, 'LB'), 1, 3, 'down').milli).toBe(3333);
    expect(() => scaleQuantityByRatio(quantity(1, 'LB'), 1, 0)).toThrow(/over zero/);
    expect(() => scaleQuantityByRatio(quantity(1, 'LB'), 1.5, 2)).toThrow(/two whole numbers/);
  });

  it('refuses to mix dimensions', () => {
    expect(() => addQuantity(quantity(1, 'LB'), quantity(1, 'GAL'))).toThrow(
      /cannot add LB and GAL/,
    );
    expect(() => subtractQuantity(quantity(1, 'EA'), quantity(1, 'G'))).toThrow(UnitError);
  });
});

describe('comparing quantities', () => {
  it('compares across units without converting either side', () => {
    expect(compareQuantity(quantity(1, 'LB'), quantity(16, 'OZ'))).toBe(0);
    expect(compareQuantity(quantity(1, 'LB'), quantity(15, 'OZ'))).toBe(1);
    expect(compareQuantity(quantity(1, 'LB'), quantity(17, 'OZ'))).toBe(-1);
  });

  it('answers equality and picks a maximum', () => {
    expect(quantityEquals(quantity(1, 'GAL'), quantity(4, 'QT'))).toBe(true);
    expect(quantityEquals(quantity(1, 'GAL'), quantity(4, 'LB'))).toBe(false);
    const heavier = quantity(2, 'LB');
    expect(maxQuantity(quantity(1, 'LB'), heavier)).toBe(heavier);
  });
});

describe('formatting a quantity', () => {
  it('trims trailing zeroes', () => {
    expect(formatQuantity(quantity(2.5, 'LB'))).toBe('2.5 LB');
    expect(formatQuantity(quantity(80, 'LB'))).toBe('80 LB');
    expect(formatQuantity(quantity(0.25, 'TSP'))).toBe('0.25 TSP');
  });

  it('can spell the unit out and pluralise it', () => {
    expect(formatQuantity(quantity(1, 'LB'), { longUnit: true })).toBe('1 pound');
    expect(formatQuantity(quantity(3, 'LB'), { longUnit: true })).toBe('3 pounds');
  });

  it('honours a decimal cap', () => {
    expect(formatQuantity(quantity(1.234, 'LB'), { decimals: 1 })).toBe('1.2 LB');
  });
});
