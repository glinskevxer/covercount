import { describe, expect, it } from 'vitest';
import {
  ROUNDING_MODES,
  RoundingError,
  allocateByWeight,
  divideRound,
  isRoundingMode,
  roundUpToStep,
} from '../../../src/core/rounding.js';

describe('divideRound', () => {
  it('returns an exact quotient untouched in every mode', () => {
    for (const mode of ROUNDING_MODES) {
      expect(divideRound(900, 3, mode)).toBe(300);
      expect(divideRound(-900, 3, mode)).toBe(-300);
    }
  });

  it('rounds a half away from zero under half-up', () => {
    expect(divideRound(5, 2, 'half-up')).toBe(3);
    expect(divideRound(-5, 2, 'half-up')).toBe(-3);
  });

  it('rounds a half to the even neighbour under half-even', () => {
    expect(divideRound(5, 2, 'half-even')).toBe(2);
    expect(divideRound(7, 2, 'half-even')).toBe(4);
    expect(divideRound(-5, 2, 'half-even')).toBe(-2);
  });

  it('takes up and down as ceiling and floor, not as magnitude', () => {
    expect(divideRound(7, 2, 'up')).toBe(4);
    expect(divideRound(-7, 2, 'up')).toBe(-3);
    expect(divideRound(7, 2, 'down')).toBe(3);
    expect(divideRound(-7, 2, 'down')).toBe(-4);
  });

  it('truncates toward zero on both signs', () => {
    expect(divideRound(7, 2, 'toward-zero')).toBe(3);
    expect(divideRound(-7, 2, 'toward-zero')).toBe(-3);
  });

  it('handles a negative denominator by sign alone', () => {
    expect(divideRound(7, -2, 'half-up')).toBe(-4);
    expect(divideRound(-7, -2, 'half-up')).toBe(4);
  });

  it('refuses a zero denominator and a non integer', () => {
    expect(() => divideRound(1, 0, 'half-up')).toThrow(/zero denominator/);
    expect(() => divideRound(1.5, 2, 'half-up')).toThrow(RoundingError);
  });

  it('recognises its own mode names', () => {
    expect(isRoundingMode('half-even')).toBe(true);
    expect(isRoundingMode('bankers')).toBe(false);
  });
});

describe('allocateByWeight', () => {
  it('splits a total that divides evenly', () => {
    expect(allocateByWeight(900, [1, 1, 1])).toEqual([300, 300, 300]);
  });

  it('gives the leftover units to the largest remainders, earliest first', () => {
    expect(allocateByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByWeight(10, [1, 1, 1, 1])).toEqual([3, 3, 2, 2]);
  });

  it('respects unequal weights', () => {
    expect(allocateByWeight(1000, [3, 1])).toEqual([750, 250]);
    expect(allocateByWeight(1001, [3, 1])).toEqual([751, 250]);
  });

  it('always hands back exactly the total', () => {
    for (let total = 0; total < 200; total += 7) {
      const shares = allocateByWeight(total, [5, 3, 2, 1]);
      expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
    }
  });

  it('carries a zero weight through as a zero share', () => {
    expect(allocateByWeight(100, [1, 0, 1])).toEqual([50, 0, 50]);
  });

  it('splits a negative total the same way', () => {
    expect(allocateByWeight(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
  });

  it('refuses an empty, all zero or negative set of weights', () => {
    expect(() => allocateByWeight(10, [])).toThrow(/empty set/);
    expect(() => allocateByWeight(10, [0, 0])).toThrow(/all zero/);
    expect(() => allocateByWeight(10, [1, -1])).toThrow(/zero or more/);
  });

  it('refuses a fractional total', () => {
    expect(() => allocateByWeight(10.5, [1])).toThrow(RoundingError);
  });
});

describe('roundUpToStep', () => {
  it('leaves a value already on the step', () => {
    expect(roundUpToStep(24, 12)).toBe(24);
  });

  it('lifts a value to the next step', () => {
    expect(roundUpToStep(25, 12)).toBe(36);
    expect(roundUpToStep(1, 12)).toBe(12);
    expect(roundUpToStep(0, 12)).toBe(0);
  });

  it('refuses a step of zero or less', () => {
    expect(() => roundUpToStep(10, 0)).toThrow(/must be positive/);
    expect(() => roundUpToStep(10, -3)).toThrow(RoundingError);
  });
});
