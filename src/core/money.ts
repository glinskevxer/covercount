/**
 * Money for a banquet department.
 *
 * Everything is held in minor units as a safe integer. Per person prices get
 * multiplied by cover counts in the hundreds and then split back out across
 * line items, so the two operations that have to be exact are scaling and
 * allocation. Floating point is used nowhere except when a human types a
 * decimal string at the command line, and that is parsed digit by digit.
 */

export interface CurrencyInfo {
  readonly code: string;
  readonly exponent: number;
  readonly symbol: string;
}

export const CURRENCIES = {
  USD: { code: 'USD', exponent: 2, symbol: '$' },
  CAD: { code: 'CAD', exponent: 2, symbol: '$' },
  EUR: { code: 'EUR', exponent: 2, symbol: '€' },
  GBP: { code: 'GBP', exponent: 2, symbol: '£' },
} as const satisfies Record<string, CurrencyInfo>;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function currencyInfo(currency: CurrencyCode): CurrencyInfo {
  return CURRENCIES[currency];
}

export function money(amount: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError(`money amount must be a safe integer of minor units, got ${amount}`);
  }
  return { amount, currency };
}

export function zeroMoney(currency: CurrencyCode): Money {
  return { amount: 0, currency };
}

export function isZeroMoney(value: Money): boolean {
  return value.amount === 0;
}

export function isNegativeMoney(value: Money): boolean {
  return value.amount < 0;
}

function sameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new MoneyError(`cannot mix ${left.currency} and ${right.currency} in one amount`);
  }
}

export function addMoney(left: Money, right: Money): Money {
  sameCurrency(left, right);
  return money(left.amount + right.amount, left.currency);
}

export function subtractMoney(left: Money, right: Money): Money {
  sameCurrency(left, right);
  return money(left.amount - right.amount, left.currency);
}

export function negateMoney(value: Money): Money {
  return money(-value.amount, value.currency);
}

export function absMoney(value: Money): Money {
  return money(Math.abs(value.amount), value.currency);
}

export function sumMoney(values: readonly Money[], currency: CurrencyCode): Money {
  let total = 0;
  for (const value of values) {
    if (value.currency !== currency) {
      throw new MoneyError(`cannot total ${value.currency} into a ${currency} sum`);
    }
    total += value.amount;
  }
  return money(total, currency);
}

/** Multiply by a whole count, which is what a per person price times covers is. */
export function scaleMoney(value: Money, count: number): Money {
  if (!Number.isSafeInteger(count)) {
    throw new MoneyError(`cannot scale money by ${count}, expected a whole count`);
  }
  return money(value.amount * count, value.currency);
}

export function compareMoney(left: Money, right: Money): number {
  sameCurrency(left, right);
  if (left.amount < right.amount) return -1;
  if (left.amount > right.amount) return 1;
  return 0;
}

export function maxMoney(left: Money, right: Money): Money {
  return compareMoney(left, right) >= 0 ? left : right;
}

export function minMoney(left: Money, right: Money): Money {
  return compareMoney(left, right) <= 0 ? left : right;
}

export function moneyEquals(left: Money, right: Money): boolean {
  return left.currency === right.currency && left.amount === right.amount;
}

const DECIMAL = /^(-)?(\d{1,15})(?:\.(\d+))?$/;

/**
 * Parse what a coordinator types. Grouping commas and a leading currency
 * symbol are tolerated because they get pasted out of contracts constantly.
 */
export function parseMoney(text: string, currency: CurrencyCode): Money {
  const info = CURRENCIES[currency];
  const cleaned = text.trim().replace(/,/g, '').replace(info.symbol, '').trim();
  const match = DECIMAL.exec(cleaned);
  if (match === null) {
    throw new MoneyError(`cannot read ${JSON.stringify(text)} as a ${currency} amount`);
  }
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > info.exponent) {
    throw new MoneyError(
      `${currency} carries ${info.exponent} decimal places, ${JSON.stringify(text)} has ${fraction.length}`,
    );
  }
  const padded = fraction.padEnd(info.exponent, '0');
  const minor = Number(`${whole ?? '0'}${padded}`);
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`${JSON.stringify(text)} is too large to hold exactly`);
  }
  return money(sign === '-' ? -minor : minor, currency);
}

export interface FormatMoneyOptions {
  readonly withSymbol?: boolean;
  readonly withCode?: boolean;
  readonly grouping?: boolean;
}

export function formatMoney(value: Money, options: FormatMoneyOptions = {}): string {
  const info = CURRENCIES[value.currency];
  const negative = value.amount < 0;
  const digits = Math.abs(value.amount)
    .toString()
    .padStart(info.exponent + 1, '0');
  const cut = digits.length - info.exponent;
  let whole = digits.slice(0, cut);
  const fraction = digits.slice(cut);
  if (options.grouping !== false) {
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const body = info.exponent > 0 ? `${whole}.${fraction}` : whole;
  const symbol = options.withSymbol === false ? '' : info.symbol;
  const code = options.withCode === true ? ` ${info.code}` : '';
  return `${negative ? '-' : ''}${symbol}${body}${code}`;
}

export function moneyToDecimalString(value: Money): string {
  return formatMoney(value, { withSymbol: false, grouping: false });
}
