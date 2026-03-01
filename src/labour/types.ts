/**
 * Who works a function.
 *
 * The roles are the ones a banquet department actually rosters. A captain is
 * counted off the server head count rather than off the covers, because what a
 * captain supervises is servers, and a bartender is counted off covers because
 * what a bartender serves is guests.
 */

import type { CatalogCode, EntityId } from '../core/ids.js';
import type { Money } from '../core/money.js';
import type { CalendarDate } from '../core/calendar.js';
import type { ServiceStyle } from '../property/types.js';

export const ROLES = [
  'SERVER',
  'CAPTAIN',
  'BARTENDER',
  'BARBACK',
  'HOUSEMAN',
  'CHEF',
  'COOK',
  'STEWARD',
  'CARVER',
  'COAT-CHECK',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles counted against the number of servers rather than against covers. */
const SUPERVISORY_ROLES: readonly Role[] = ['CAPTAIN'];

export interface StaffingRule {
  readonly propertyCode: CatalogCode;
  readonly serviceStyle: ServiceStyle;
  readonly role: Role;
  /** One head per this many covers, or per this many servers if supervisory. */
  readonly coversPerHead: number;
  readonly minimumHeads: number;
  /** The shortest shift the property will call somebody in for. */
  readonly minimumHours: number;
  readonly leadInMinutes: number;
  readonly leadOutMinutes: number;
}

export interface LabourRate {
  readonly role: Role;
  readonly effectiveFrom: CalendarDate;
  readonly hourly: Money;
}

export interface Shift {
  readonly id: EntityId<'shift'>;
  readonly functionId: EntityId<'functionSlot'>;
  readonly role: Role;
  readonly heads: number;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly hourly: Money;
  readonly note: string;
  readonly createdAt: string;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isSupervisory(role: Role): boolean {
  return SUPERVISORY_ROLES.includes(role);
}

/** Roles the kitchen rosters rather than the dining room. */
export function isKitchenRole(role: Role): boolean {
  return role === 'CHEF' || role === 'COOK' || role === 'STEWARD' || role === 'CARVER';
}

/** The length of a shift in whole minutes. */
export function shiftMinutes(shift: Pick<Shift, 'startMinute' | 'endMinute'>): number {
  return shift.endMinute - shift.startMinute;
}

/** Paid hours for a shift, which is heads times the length. */
export function shiftHeadHours(shift: Pick<Shift, 'startMinute' | 'endMinute' | 'heads'>): number {
  return (shiftMinutes(shift) * shift.heads) / 60;
}
