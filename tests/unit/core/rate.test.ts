import { describe, expect, it } from 'vitest';
import {
  PPM,
  RateError,
  ZERO_RATE,
  addRates,
  applyRate,
  formatRate,
  isZeroRate,
  rate,
  rateFromBasisPoints,
  rateFromPercent,
  ratePercent,
  removeRate,
} from '../../../src/core/rate.js';
import { money } from '../../../src/core/money.js';

describe('building a rate', () => {
  it('takes parts per million directly', () => {
    expect(rate(220_000).ppm).toBe(220_000);
    expect(PPM).toBe(1_000_000);
  });

  it('takes a whole percentage', () => {
    expect(rateFromPercent(22).ppm).toBe(220_000);
    expect(rateFromPercent(0).ppm).toBe(0);
  });

  it('takes the fractional tax rates counties actually levy', () => {
    expect(rateFromPercent(8.875).ppm).toBe(88_750);
    expect(rateFromPercent(24.5).ppm).toBe(245_000);
    expect(rateFromPercent(0.0625).ppm).toBe(625);
  });

  it('takes basis points', () => {
    expect(rateFromBasisPoints(2200).ppm).toBe(220_000);
  });

  it('refuses a rate finer than a part per million', () => {
    expect(() => rateFromPercent(0.00001)).toThrow(RateError);
    expect(() => rate(1.5)).toThrow(/whole parts per million/);
    expect(() => rateFromBasisPoints(2.5)).toThrow(/basis points must be whole/);
  });

  it('reads back as a percentage', () => {
    expect(ratePercent(rate(88_750))).toBe(8.875);
    expect(isZeroRate(ZERO_RATE)).toBe(true);
  });

  it('adds two rates', () => {
    expect(addRates(rateFromPercent(22), rateFromPercent(8.875)).ppm).toBe(308_750);
  });

  it('formats without trailing zeroes', () => {
    expect(formatRate(rateFromPercent(22))).toBe('22%');
    expect(formatRate(rateFromPercent(8.875))).toBe('8.875%');
    expect(formatRate(ZERO_RATE)).toBe('0%');
  });
});

describe('applying a rate', () => {
  it('takes a service charge off a food total', () => {
    expect(applyRate(money(2148000, 'USD'), rateFromPercent(22))).toEqual(money(472560, 'USD'));
  });

  it('rounds a half cent up by default', () => {
    expect(applyRate(money(1, 'USD'), rateFromPercent(50))).toEqual(money(1, 'USD'));
  });

  it('honours the mode it is handed', () => {
    const half = money(1, 'USD');
    expect(applyRate(half, rateFromPercent(50), 'half-even')).toEqual(money(0, 'USD'));
    expect(applyRate(half, rateFromPercent(50), 'down')).toEqual(money(0, 'USD'));
    expect(applyRate(half, rateFromPercent(50), 'up')).toEqual(money(1, 'USD'));
  });

  it('keeps the currency', () => {
    expect(applyRate(money(10000, 'GBP'), rateFromPercent(20)).currency).toBe('GBP');
  });

  it('gives zero for a zero rate', () => {
    expect(applyRate(money(999999, 'USD'), ZERO_RATE)).toEqual(money(0, 'USD'));
  });
});

describe('stripping an inclusive rate', () => {
  it('backs a service charge out of an inclusive price', () => {
    const inclusive = money(12200, 'USD');
    expect(removeRate(inclusive, rateFromPercent(22))).toEqual(money(10000, 'USD'));
  });

  it('is the inverse of applying, to within a rounding unit', () => {
    const serviceCharge = rateFromPercent(24.5);
    for (const base of [1000, 4999, 89_500, 2_148_000]) {
      const gross = money(base, 'USD').amount + applyRate(money(base, 'USD'), serviceCharge).amount;
      const back = removeRate(money(gross, 'USD'), serviceCharge);
      expect(Math.abs(back.amount - base)).toBeLessThanOrEqual(1);
    }
  });

  it('leaves an amount alone when the rate is zero', () => {
    expect(removeRate(money(5000, 'USD'), ZERO_RATE)).toEqual(money(5000, 'USD'));
  });
});
