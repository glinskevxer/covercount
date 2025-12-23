/**
 * The money side of a function.
 *
 * A charge category is what the tax authority cares about, not what the
 * kitchen cares about. Food and beverage are taxed at different rates in most
 * places, room rental frequently is not taxed at all, and labour billed
 * through to the client is taxed in some states and not in others. So the
 * category is the tax key, and the item behind it is only description.
 */

import type { CalendarDate } from '../core/calendar.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import type { Money } from '../core/money.js';
import type { Rate } from '../core/rate.js';

export const CHARGE_CATEGORIES = [
  'FOOD',
  'BEVERAGE',
  'RENTAL',
  'AV',
  'LABOR',
  'SERVICE',
  'FEE',
] as const;

export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

export const CHARGE_SOURCES = [
  'MANUAL',
  'PACKAGE',
  'UPCHARGE',
  'BAR',
  'LABOUR',
  'CHANGE-ORDER',
  'MINIMUM',
] as const;

export type ChargeSource = (typeof CHARGE_SOURCES)[number];

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'VOID'] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYMENT_KINDS = ['DEPOSIT', 'PAYMENT', 'REFUND', 'WRITE-OFF'] as const;

export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export interface TaxProfile {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly serviceCharge: Rate;
  readonly gratuity: Rate;
  /** Whether the service charge is itself subject to sales tax. */
  readonly serviceChargeTaxable: boolean;
  readonly createdAt: string;
}

export interface TaxRate {
  readonly category: ChargeCategory;
  readonly rate: Rate;
}

export interface ChargeLine {
  readonly id: number;
  readonly functionId: EntityId<'functionSlot'>;
  readonly category: ChargeCategory;
  readonly description: string;
  readonly quantity: number;
  readonly unit: Money;
  readonly itemCode: CatalogCode | undefined;
  readonly taxable: boolean;
  /** Whether the service charge applies to this line. */
  readonly serviceable: boolean;
  readonly source: ChargeSource;
  readonly position: number;
}

export interface Invoice {
  readonly id: EntityId<'invoice'>;
  readonly propertyCode: CatalogCode;
  readonly bookingId: EntityId<'booking'>;
  readonly taxProfileCode: CatalogCode;
  readonly status: InvoiceStatus;
  readonly issuedAt: string | undefined;
  readonly note: string;
  readonly createdAt: string;
}

export interface Payment {
  readonly seq: number;
  readonly receivedAt: string;
  readonly kind: PaymentKind;
  readonly amount: Money;
  readonly reference: string;
}

export function isChargeCategory(value: string): value is ChargeCategory {
  return (CHARGE_CATEGORIES as readonly string[]).includes(value);
}

export function isChargeSource(value: string): value is ChargeSource {
  return (CHARGE_SOURCES as readonly string[]).includes(value);
}

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function isPaymentKind(value: string): value is PaymentKind {
  return (PAYMENT_KINDS as readonly string[]).includes(value);
}

/** Categories the service charge falls on by default. */
export function attractsServiceCharge(category: ChargeCategory): boolean {
  return category === 'FOOD' || category === 'BEVERAGE';
}

/** A payment that moves money towards the property. */
export function isCredit(kind: PaymentKind): boolean {
  return kind === 'DEPOSIT' || kind === 'PAYMENT' || kind === 'WRITE-OFF';
}

export interface InvoiceLineTotal {
  readonly category: ChargeCategory;
  readonly net: Money;
  readonly serviceCharge: Money;
  readonly tax: Money;
}

export interface InvoiceTotals {
  readonly lines: InvoiceLineTotal[];
  readonly net: Money;
  readonly serviceCharge: Money;
  readonly gratuity: Money;
  readonly tax: Money;
  readonly gross: Money;
  readonly paid: Money;
  readonly balance: Money;
  readonly asOf: CalendarDate | undefined;
}
