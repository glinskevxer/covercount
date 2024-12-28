/**
 * A property and the rules it sets for everything booked into it.
 *
 * The guarantee lead and the overset are property settings rather than
 * constants because they are negotiated. A convention hotel that turns four
 * ballrooms a day sets a longer lead than a boutique that does two weddings a
 * month, and the overset is the number the chef and the controller argue about
 * once a year.
 */

import type { CurrencyCode } from '../core/money.js';
import type { Rate } from '../core/rate.js';
import type { TimeOfDay, TimeZoneName } from '../core/clock.js';
import type { CalendarDate } from '../core/calendar.js';
import type { CatalogCode } from '../core/ids.js';

export const SETUP_STYLES = [
  'ROUNDS-8',
  'ROUNDS-10',
  'ROUNDS-12',
  'THEATER',
  'CLASSROOM',
  'U-SHAPE',
  'HOLLOW-SQUARE',
  'BOARDROOM',
  'RECEPTION',
  'CRESCENT',
] as const;

export type SetupStyle = (typeof SETUP_STYLES)[number];

export const SERVICE_STYLES = [
  'PLATED',
  'BUFFET',
  'FAMILY',
  'STATIONS',
  'RECEPTION',
  'BOXED',
] as const;

export type ServiceStyle = (typeof SERVICE_STYLES)[number];

export const CALENDAR_KINDS = ['office', 'kitchen'] as const;

export type CalendarKind = (typeof CALENDAR_KINDS)[number];

export interface Property {
  readonly code: CatalogCode;
  readonly name: string;
  readonly timeZone: TimeZoneName;
  readonly currency: CurrencyCode;
  /** Business days before the function that the guarantee is due. */
  readonly guaranteeLeadDays: number;
  /** The hour on that day the count closes. */
  readonly guaranteeDueTime: TimeOfDay;
  /** How far above the guarantee the room is set. */
  readonly oversetRate: Rate;
  /** The most covers the overset will ever add, however large the function. */
  readonly oversetCap: number;
  readonly createdAt: string;
}

export interface FunctionSpace {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly floor: string;
  readonly areaSqFt: number;
  /** The number on the certificate on the wall, which no setup may exceed. */
  readonly fireCapacity: number;
  readonly setupMinutes: number;
  readonly teardownMinutes: number;
  readonly isCombination: boolean;
  readonly active: boolean;
}

export interface SpaceCapacity {
  readonly spaceCode: CatalogCode;
  readonly setupStyle: SetupStyle;
  readonly capacity: number;
}

export interface HouseCalendarEntry {
  readonly calendar: CalendarKind;
  readonly date: CalendarDate;
  readonly kind: 'closed' | 'open';
  readonly note: string;
}

export function isSetupStyle(value: string): value is SetupStyle {
  return (SETUP_STYLES as readonly string[]).includes(value);
}

export function isServiceStyle(value: string): value is ServiceStyle {
  return (SERVICE_STYLES as readonly string[]).includes(value);
}

export function isCalendarKind(value: string): value is CalendarKind {
  return (CALENDAR_KINDS as readonly string[]).includes(value);
}

/** Rounds of ten seat ten, and the number is needed to count tables. */
export function seatsPerTable(style: SetupStyle): number | undefined {
  switch (style) {
    case 'ROUNDS-8':
      return 8;
    case 'ROUNDS-10':
      return 10;
    case 'ROUNDS-12':
      return 12;
    case 'CRESCENT':
      return 6;
    default:
      return undefined;
  }
}

/** A seated style needs a place setting per cover, a standing one does not. */
export function isSeatedStyle(style: SetupStyle): boolean {
  return style !== 'RECEPTION';
}
