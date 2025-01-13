/**
 * A booking is the deal. A function is one room on one date inside it.
 *
 * The two are separate because they move independently: a three day
 * conference is one booking and eleven functions, the client turns two of them
 * definite and releases a third, and the guarantee, the production and the
 * invoice all attach to the function rather than to the deal.
 */

import type { CalendarDate } from '../core/calendar.js';
import type { TimeOfDay } from '../core/clock.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import type { ServiceStyle, SetupStyle } from '../property/types.js';

export const BOOKING_STATUSES = [
  'INQUIRY',
  'TENTATIVE',
  'DEFINITE',
  'CANCELLED',
  'CLOSED',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const FUNCTION_STATUSES = ['HELD', 'DEFINITE', 'RELEASED', 'CANCELLED'] as const;

export type FunctionStatus = (typeof FUNCTION_STATUSES)[number];

export const ACCOUNT_KINDS = [
  'CORPORATE',
  'ASSOCIATION',
  'GOVERNMENT',
  'SOCIAL',
  'INTERNAL',
] as const;

export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const CREDIT_STATUSES = ['APPROVED', 'PREPAY', 'HOLD'] as const;

export type CreditStatus = (typeof CREDIT_STATUSES)[number];

export interface Account {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly kind: AccountKind;
  readonly billingEmail: string;
  readonly creditStatus: CreditStatus;
  readonly taxExemptId: string;
  readonly createdAt: string;
}

export interface Booking {
  readonly id: EntityId<'booking'>;
  readonly propertyCode: CatalogCode;
  readonly accountCode: CatalogCode | undefined;
  readonly postAs: string;
  readonly salesManager: string;
  readonly status: BookingStatus;
  readonly arrivalDate: CalendarDate;
  readonly departureDate: CalendarDate;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | undefined;
  readonly cancelReason: string | undefined;
}

/**
 * The end minute may run past 1440. A reception at 18:00 that ends at 01:00 is
 * held as 1080 to 1500 on the day it started, never as two rows.
 */
export interface FunctionSlot {
  readonly id: EntityId<'functionSlot'>;
  readonly bookingId: EntityId<'booking'>;
  readonly propertyCode: CatalogCode;
  readonly spaceCode: CatalogCode;
  readonly name: string;
  readonly serviceDate: CalendarDate;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly setupStyle: SetupStyle;
  readonly serviceStyle: ServiceStyle;
  readonly expectedCovers: number;
  readonly status: FunctionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BookingEvent {
  readonly seq: number;
  readonly bookingId: EntityId<'booking'>;
  readonly occurredAt: string;
  readonly actor: string;
  readonly kind: string;
  readonly detail: string;
}

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

export function isFunctionStatus(value: string): value is FunctionStatus {
  return (FUNCTION_STATUSES as readonly string[]).includes(value);
}

export function isAccountKind(value: string): value is AccountKind {
  return (ACCOUNT_KINDS as readonly string[]).includes(value);
}

export function isCreditStatus(value: string): value is CreditStatus {
  return (CREDIT_STATUSES as readonly string[]).includes(value);
}

/** A booking that is still being sold, so its functions are only holds. */
export function isProvisional(status: BookingStatus): boolean {
  return status === 'INQUIRY' || status === 'TENTATIVE';
}

/** A booking nobody will change again. */
export function isFinished(status: BookingStatus): boolean {
  return status === 'CANCELLED' || status === 'CLOSED';
}

/** A function that still takes its room out of the diary. */
export function holdsSpace(status: FunctionStatus): boolean {
  return status === 'HELD' || status === 'DEFINITE';
}

export function functionDurationMinutes(slot: { startMinute: number; endMinute: number }): number {
  return slot.endMinute - slot.startMinute;
}

/** True when the function runs past midnight into the following day. */
export function crossesMidnight(slot: { endMinute: number }): boolean {
  return slot.endMinute > 1440;
}

export function startTimeOfDay(slot: { startMinute: number }): TimeOfDay {
  return slot.startMinute as TimeOfDay;
}
