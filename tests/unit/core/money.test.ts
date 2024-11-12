import { describe, expect, it } from 'vitest';
import {
  CURRENCY_CODES,
  MoneyError,
  absMoney,
  addMoney,
  compareMoney,
  currencyInfo,
  formatMoney,
  isCurrencyCode,
  isNegativeMoney,
  isZeroMoney,
  maxMoney,
  minMoney,
  money,
  moneyEquals,
  moneyToDecimalString,
  negateMoney,
  parseMoney,
  scaleMoney,
  subtractMoney,
  sumMoney,
  zeroMoney,
} from '../../../src/core/money.js';

describe('money construction', () => {
  it('holds minor units as given', () => {
    expect(money(12500, 'USD')).toEqual({ amount: 12500, currency: 'USD' });
  });

  it('refuses a fractional minor unit', () => {
    expect(() => money(10.5, 'USD')).toThrow(MoneyError);
  });

  it('refuses an unsafe integer', () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 2, 'USD')).toThrow(/safe integer/);
  });

  it('knows the four currencies it carries', () => {
    expect(CURRENCY_CODES).toEqual(['USD', 'CAD', 'EUR', 'GBP']);
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('JPY')).toBe(false);
    expect(currencyInfo('GBP').symbol).toBe('£');
  });

  it('reports zero and sign', () => {
    expect(isZeroMoney(zeroMoney('USD'))).toBe(true);
    expect(isNegativeMoney(money(-1, 'USD'))).toBe(true);
    expect(isNegativeMoney(zeroMoney('USD'))).toBe(false);
  });
});

describe('money arithmetic', () => {
  it('adds and subtracts within one currency', () => {
    expect(addMoney(money(2500, 'USD'), money(750, 'USD')).amount).toBe(3250);
    expect(subtractMoney(money(2500, 'USD'), money(750, 'USD')).amount).toBe(1750);
  });

  it('refuses to mix currencies', () => {
    expect(() => addMoney(money(100, 'USD'), money(100, 'EUR'))).toThrow(/cannot mix USD and EUR/);
    expect(() => subtractMoney(money(100, 'CAD'), money(100, 'GBP'))).toThrow(MoneyError);
  });

  it('negates and takes an absolute value', () => {
    expect(negateMoney(money(400, 'USD')).amount).toBe(-400);
    expect(absMoney(money(-400, 'USD')).amount).toBe(400);
  });

  it('scales a per person price by a cover count', () => {
    expect(scaleMoney(money(8950, 'USD'), 240).amount).toBe(2148000);
    expect(scaleMoney(money(8950, 'USD'), 0).amount).toBe(0);
  });

  it('refuses a fractional cover count', () => {
    expect(() => scaleMoney(money(100, 'USD'), 2.5)).toThrow(/whole count/);
  });

  it('totals a list and refuses a stray currency', () => {
    const lines = [money(1000, 'USD'), money(250, 'USD'), money(5, 'USD')];
    expect(sumMoney(lines, 'USD').amount).toBe(1255);
    expect(sumMoney([], 'USD')).toEqual(zeroMoney('USD'));
    expect(() => sumMoney([money(1, 'EUR')], 'USD')).toThrow(/cannot total EUR/);
  });
});

describe('money comparison', () => {
  it('orders two amounts', () => {
    expect(compareMoney(money(1, 'USD'), money(2, 'USD'))).toBe(-1);
    expect(compareMoney(money(2, 'USD'), money(1, 'USD'))).toBe(1);
    expect(compareMoney(money(2, 'USD'), money(2, 'USD'))).toBe(0);
  });

  it('picks a maximum and a minimum', () => {
    const low = money(100, 'USD');
    const high = money(900, 'USD');
    expect(maxMoney(low, high)).toBe(high);
    expect(minMoney(low, high)).toBe(low);
    expect(maxMoney(low, low)).toBe(low);
  });

  it('compares for equality across currency', () => {
    expect(moneyEquals(money(5, 'USD'), money(5, 'USD'))).toBe(true);
    expect(moneyEquals(money(5, 'USD'), money(5, 'CAD'))).toBe(false);
  });
});

describe('parsing what a coordinator types', () => {
  it('reads a plain decimal', () => {
    expect(parseMoney('89.50', 'USD').amount).toBe(8950);
    expect(parseMoney('89', 'USD').amount).toBe(8900);
    expect(parseMoney('0.07', 'USD').amount).toBe(7);
  });

  it('tolerates grouping commas, a symbol and stray spaces', () => {
    expect(parseMoney(' $12,450.75 ', 'USD').amount).toBe(1245075);
    expect(parseMoney('£1,000', 'GBP').amount).toBe(100000);
  });

  it('reads a negative amount', () => {
    expect(parseMoney('-42.00', 'USD').amount).toBe(-4200);
  });

  it('refuses more decimal places than the currency carries', () => {
    expect(() => parseMoney('10.005', 'USD')).toThrow(/2 decimal places/);
  });

  it('refuses text that is not an amount', () => {
    expect(() => parseMoney('per person', 'USD')).toThrow(/cannot read/);
    expect(() => parseMoney('', 'USD')).toThrow(MoneyError);
  });
});

describe('formatting for a banquet event order', () => {
  it('groups thousands and keeps two places', () => {
    expect(formatMoney(money(2148000, 'USD'))).toBe('$21,480.00');
    expect(formatMoney(money(7, 'USD'))).toBe('$0.07');
  });

  it('puts the sign in front of the symbol', () => {
    expect(formatMoney(money(-2500, 'USD'))).toBe('-$25.00');
  });

  it('can drop the symbol, the grouping or add the code', () => {
    expect(formatMoney(money(123456, 'USD'), { withSymbol: false })).toBe('1,234.56');
    expect(formatMoney(money(123456, 'USD'), { grouping: false })).toBe('$1234.56');
    expect(formatMoney(money(500, 'EUR'), { withCode: true })).toBe('€5.00 EUR');
  });

  it('round trips through a decimal string', () => {
    const original = money(1245075, 'USD');
    expect(parseMoney(moneyToDecimalString(original), 'USD')).toEqual(original);
  });
});
