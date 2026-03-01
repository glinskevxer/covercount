/**
 * What the kitchen buys and what it makes out of it.
 *
 * The yield percent on a recipe line is the fraction of the purchased weight
 * that reaches the plate. Ninety percent on romaine means ten percent is root
 * and outer leaf, and the requisition has to ask for the gross weight or the
 * line runs out on the night.
 */

import type { CatalogCode, EntityId } from '../core/ids.js';
import type { Quantity } from '../core/quantity.js';
import type { UnitCode } from '../core/units.js';
import type { CalendarDate } from '../core/calendar.js';

export const STORES = [
  'DRY',
  'CHILL',
  'FREEZE',
  'PRODUCE',
  'BUTCHER',
  'CELLAR',
  'NONFOOD',
] as const;

export type StoreArea = (typeof STORES)[number];

export const STATIONS = [
  'GARDE-MANGER',
  'SAUCE',
  'GRILL',
  'ROAST',
  'FISH',
  'PASTRY',
  'BAKERY',
  'BANQUET-PASS',
] as const;

export type Station = (typeof STATIONS)[number];

const REQUISITION_STATUSES = ['DRAFT', 'ISSUED', 'PICKED', 'CANCELLED'] as const;

export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export interface Ingredient {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly store: StoreArea;
  /** The unit the kitchen counts it in when it writes a requisition. */
  readonly purchaseUnit: UnitCode;
  /** How much comes in one pack, in the pack unit. */
  readonly packSize: Quantity;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface RecipeLine {
  readonly position: number;
  readonly ingredientCode: CatalogCode;
  readonly quantity: Quantity;
  /** Percent of the purchased quantity that reaches the plate. */
  readonly yieldPercent: number;
  readonly note: string;
}

export interface Recipe {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly itemCode: CatalogCode | undefined;
  /** How many plates one batch of this recipe makes. */
  readonly batchPortions: number;
  readonly station: Station;
  readonly method: string;
  readonly createdAt: string;
}

export interface RequisitionLine {
  readonly ingredientCode: CatalogCode;
  readonly needed: Quantity;
  readonly packs: number;
  readonly position: number;
}

export interface Requisition {
  readonly id: EntityId<'requisition'>;
  readonly propertyCode: CatalogCode;
  readonly serviceDate: CalendarDate;
  readonly store: StoreArea;
  readonly status: RequisitionStatus;
  readonly note: string;
  readonly createdAt: string;
}

export function isStoreArea(value: string): value is StoreArea {
  return (STORES as readonly string[]).includes(value);
}

export function isStation(value: string): value is Station {
  return (STATIONS as readonly string[]).includes(value);
}

export function isRequisitionStatus(value: string): value is RequisitionStatus {
  return (REQUISITION_STATUSES as readonly string[]).includes(value);
}

/** A store that has to be picked cold, so it goes last on the pick list. */
export function isColdStore(store: StoreArea): boolean {
  return store === 'CHILL' || store === 'FREEZE' || store === 'PRODUCE';
}

/** The order a picker walks the stores, dry goods first and frozen last. */
export function pickOrder(store: StoreArea): number {
  return STORES.indexOf(store);
}
