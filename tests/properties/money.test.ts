/**
 * Sweeps over the money and rounding core.
 *
 * These are not example tests. Each one states a property that has to hold for
 * every input in a range and then walks the range, because the failures that
 * matter here are the ones at a boundary nobody thought to write an example
 * for. The generator is a fixed sequence rather than a random one so a failure
 * is reproducible without a seed being reported.
 */

import { describe, expect, it } from 'vitest';
import {
  addMoney,
  allocateMoney,
  formatMoney,
  money,
  moneyToDecimalString,
  parseMoney,
  splitMoney,
  subtractMoney,
  sumMoney,
} from '../../src/core/money.js';
import { allocateByWeight, divideRound, ROUNDING_MODES } from '../../src/core/rounding.js';
import { applyRate, rateFromPercent, removeRate } from '../../src/core/rate.js';

/** A fixed spread of amounts, including the awkward ones. */
function amounts(): number[] {
  const out = [0, 1, 2, 5, 7, 99, 100, 101, 999, 1000, 1001];
  for (let value = 1; value <= 200_000; value = Math.ceil(value * 1.7) + 1) {
    out.push(value);
  }
  return out;
}

function weightSets(): number[][] {
  return [
    [1],
    [1, 1],
    [1, 1, 1],
    [1, 2],
    [3, 1],
    [1, 1, 1, 1, 1, 1, 1],
    [5, 3, 2, 1],
    [1, 0, 1],
    [97, 3],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ];
}

describe('allocation always hands back exactly the total', () => {
  it('holds for every amount and weight set', () => {
    for (const total of amounts()) {
      for (const weights of weightSets()) {
        const shares = allocateByWeight(total, weights);
        expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total);
        expect(shares).toHaveLength(weights.length);
        expect(shares.every((share) => share >= 0)).toBe(true);
      }
    }
  });

  it('holds for negative totals too', () => {
    for (const total of amounts()) {
      for (const weights of weightSets()) {
        const shares = allocateByWeight(-total, weights);
        // Adding zero folds a negative zero back to a positive one, which is
        // what the allocator hands back for a total of nothing.
        expect(shares.reduce((sum, share) => sum + share, 0)).toBe(-total + 0);
      }
    }
  });

  it('never gives a share more than one unit above its exact value', () => {
    for (const total of amounts()) {
      for (const weights of weightSets()) {
        const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
        const shares = allocateByWeight(total, weights);
        shares.forEach((share, index) => {
          const exact = (total * (weights[index] ?? 0)) / weightTotal;
          expect(share).toBeGreaterThanOrEqual(Math.floor(exact));
          expect(share).toBeLessThanOrEqual(Math.ceil(exact));
        });
      }
    }
  });

  it('gives a zero weight a zero share whatever the total', () => {
    for (const total of amounts()) {
      expect(allocateByWeight(total, [1, 0, 1])[1]).toBe(0);
    }
  });
});

describe('money allocation and splitting', () => {
  it('adds back to the whole for every amount', () => {
    for (const amount of amounts()) {
      const value = money(amount, 'USD');
      for (const weights of weightSets()) {
        expect(sumMoney(allocateMoney(value, weights), 'USD')).toEqual(value);
      }
      for (const parts of [1, 2, 3, 4, 7, 13]) {
        expect(sumMoney(splitMoney(value, parts), 'USD')).toEqual(value);
      }
    }
  });

  it('is stable when it is worked out twice', () => {
    for (const amount of amounts()) {
      const value = money(amount, 'USD');
      expect(allocateMoney(value, [5, 3, 2])).toEqual(allocateMoney(value, [5, 3, 2]));
    }
  });
});

describe('money arithmetic and formatting', () => {
  it('round trips through a decimal string for every amount', () => {
    for (const amount of amounts()) {
      for (const sign of [1, -1]) {
        const value = money(amount * sign, 'USD');
        expect(parseMoney(moneyToDecimalString(value), 'USD')).toEqual(value);
      }
    }
  });

  it('adds and subtracts back to where it started', () => {
    for (const left of amounts()) {
      for (const right of [0, 1, 99, 4200]) {
        const start = money(left, 'USD');
        const delta = money(right, 'USD');
        expect(subtractMoney(addMoney(start, delta), delta)).toEqual(start);
      }
    }
  });

  it('formats every amount as something it can read back', () => {
    for (const amount of amounts()) {
      const text = formatMoney(money(amount, 'USD'));
      expect(parseMoney(text, 'USD').amount).toBe(amount);
    }
  });
});

describe('rounding modes', () => {
  it('never lands more than one away from the exact quotient', () => {
    for (const numerator of amounts()) {
      for (const denominator of [1, 2, 3, 7, 60, 1000, 1_000_000]) {
        const exact = numerator / denominator;
        for (const mode of ROUNDING_MODES) {
          const rounded = divideRound(numerator, denominator, mode);
          expect(Math.abs(rounded - exact)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('orders the modes the way their names say', () => {
    for (const numerator of amounts()) {
      const denominator = 7;
      const down = divideRound(numerator, denominator, 'down');
      const up = divideRound(numerator, denominator, 'up');
      const halfUp = divideRound(numerator, denominator, 'half-up');
      expect(down).toBeLessThanOrEqual(halfUp);
      expect(halfUp).toBeLessThanOrEqual(up);
      expect(up - down).toBeLessThanOrEqual(1);
    }
  });
});

describe('applying and stripping a rate', () => {
  it('gets back to within a unit of where it started', () => {
    for (const amount of amounts()) {
      for (const percent of [0, 3, 8.875, 20, 22, 24.5, 100]) {
        const rate = rateFromPercent(percent);
        const base = money(amount, 'USD');
        const gross = addMoney(base, applyRate(base, rate));
        const back = removeRate(gross, rate);
        expect(Math.abs(back.amount - amount)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never returns more than the amount for a rate under a hundred percent', () => {
    for (const amount of amounts()) {
      for (const percent of [0, 1, 22, 50, 99]) {
        const applied = applyRate(money(amount, 'USD'), rateFromPercent(percent));
        expect(applied.amount).toBeLessThanOrEqual(amount);
        expect(applied.amount).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
