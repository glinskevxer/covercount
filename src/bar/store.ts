/**
 * The bar, sold two ways.
 *
 * A package bar charges a tier per cover for the first hour and a lower rate
 * for each hour after it, against the guaranteed count. A consumption bar
 * charges what came out of the bottles, counted in tenths because that is how
 * a bar manager reads a bottle, and it does not care what the guarantee is.
 *
 * The one rule that catches people is that a function has one bar or none. A
 * client who wants a package bar for the reception and consumption afterwards
 * has two functions, which is also how the diary and the roster see it.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode, type EntityId } from '../core/ids.js';
import { addMoney, money, scaleMoney, zeroMoney, type Money } from '../core/money.js';
import { requireFunction } from '../booking/functions.js';
import { requireItem } from '../catalog/items.js';
import { billedCovers, requireCovers } from '../covers/guarantee.js';
import { requireProperty } from '../property/store.js';
import type { Database } from '../store/database.js';

export const BAR_KINDS = ['PACKAGE', 'CONSUMPTION', 'CASH'] as const;

export type BarKind = (typeof BAR_KINDS)[number];

export function isBarKind(value: string): value is BarKind {
  return (BAR_KINDS as readonly string[]).includes(value);
}

export interface BarTier {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly firstHour: Money;
  readonly extraHour: Money;
  readonly createdAt: string;
}

export interface FunctionBar {
  readonly functionId: EntityId<'functionSlot'>;
  readonly kind: BarKind;
  readonly tierCode: CatalogCode | undefined;
  readonly hours: number;
  readonly note: string;
}

export interface Pour {
  readonly itemCode: CatalogCode;
  /** Tenths of a bottle, which is how a bar manager reads one. */
  readonly openingTenths: number;
  readonly closingTenths: number;
  readonly unit: Money;
}

export function createBarTier(
  db: Database,
  propertyCode: CatalogCode,
  input: { code: string; name: string; firstHourMinor: number; extraHourMinor: number },
  now: string,
): BarTier {
  const property = requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  if (input.name.trim().length === 0) {
    throw invalidInput('bar.name', 'a bar tier needs a name');
  }
  for (const [label, value] of [
    ['first hour', input.firstHourMinor],
    ['extra hour', input.extraHourMinor],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw invalidInput('bar.rate', `the ${label} rate is a whole number of minor units`);
    }
  }
  if (input.extraHourMinor > input.firstHourMinor) {
    throw invalidInput(
      'bar.rate',
      'an extra hour costing more than the first is a tier nobody would buy',
    );
  }

  const clash = db
    .prepare<
      [string, string],
      { code: string }
    >('select code from bar_tier where property_code = ? and code = ?')
    .get(propertyCode, code);
  if (clash !== undefined) {
    throw conflict('bar.exists', `${propertyCode} already has a bar tier ${code}`, code);
  }

  db.prepare(
    `insert into bar_tier (property_code, code, name, first_hour_minor, extra_hour_minor, created_at)
     values (?, ?, ?, ?, ?, ?)`,
  ).run(propertyCode, code, input.name.trim(), input.firstHourMinor, input.extraHourMinor, now);

  return {
    propertyCode,
    code,
    name: input.name.trim(),
    firstHour: money(input.firstHourMinor, property.currency),
    extraHour: money(input.extraHourMinor, property.currency),
    createdAt: now,
  };
}

export function requireBarTier(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): BarTier {
  const property = requireProperty(db, propertyCode);
  const row = db
    .prepare<
      [string, string],
      {
        code: string;
        name: string;
        first_hour_minor: number;
        extra_hour_minor: number;
        created_at: string;
      }
    >('select * from bar_tier where property_code = ? and code = ?')
    .get(propertyCode, code);
  if (row === undefined) {
    throw notFound('bar.missing', code, `${propertyCode} has no bar tier ${code}`);
  }
  return {
    propertyCode,
    code: catalogCode(row.code),
    name: row.name,
    firstHour: money(row.first_hour_minor, property.currency),
    extraHour: money(row.extra_hour_minor, property.currency),
    createdAt: row.created_at,
  };
}

export function listBarTiers(db: Database, propertyCode: CatalogCode): BarTier[] {
  return db
    .prepare<[string], { code: string }>(
      'select code from bar_tier where property_code = ? order by code',
    )
    .all(propertyCode)
    .map((row) => requireBarTier(db, propertyCode, catalogCode(row.code)));
}

export interface SetBarInput {
  readonly kind: string;
  readonly tierCode?: string;
  readonly hours?: number;
  readonly note?: string;
}

export function setBar(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  input: SetBarInput,
): FunctionBar {
  const slot = requireFunction(db, functionId);
  const kind = input.kind.trim().toUpperCase();
  if (!isBarKind(kind)) {
    throw invalidInput('bar.kind', `${input.kind} is not a way this property sells a bar`);
  }
  const hours = input.hours ?? 0;
  if (!Number.isInteger(hours) || hours < 0) {
    throw invalidInput('bar.hours', 'a bar runs a whole number of hours');
  }

  let tierCode: CatalogCode | undefined;
  if (kind === 'PACKAGE') {
    if (input.tierCode === undefined) {
      throw invalidInput('bar.tier', 'a package bar needs a tier, that is what it charges');
    }
    tierCode = catalogCode(input.tierCode);
    requireBarTier(db, slot.propertyCode, tierCode);
    if (hours < 1) {
      throw invalidInput('bar.hours', 'a package bar runs for at least one hour');
    }
  } else if (input.tierCode !== undefined) {
    throw invalidInput(
      'bar.tier',
      `a ${kind.toLowerCase()} bar is not sold by tier, so naming one is a mistake`,
    );
  }

  db.prepare(
    `insert into function_bar (function_id, kind, tier_code, hours, note)
     values (?, ?, ?, ?, ?)
     on conflict (function_id) do update set
       kind = excluded.kind,
       tier_code = excluded.tier_code,
       hours = excluded.hours,
       note = excluded.note`,
  ).run(functionId, kind, tierCode ?? null, hours, (input.note ?? '').trim());

  return requireBar(db, functionId);
}

export function findBar(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): FunctionBar | undefined {
  const row = db
    .prepare<
      [string],
      { kind: string; tier_code: string | null; hours: number; note: string }
    >('select kind, tier_code, hours, note from function_bar where function_id = ?')
    .get(functionId);
  return row === undefined
    ? undefined
    : {
        functionId,
        kind: row.kind as BarKind,
        tierCode: row.tier_code === null ? undefined : catalogCode(row.tier_code),
        hours: row.hours,
        note: row.note,
      };
}

export function requireBar(db: Database, functionId: EntityId<'functionSlot'>): FunctionBar {
  const found = findBar(db, functionId);
  if (found === undefined) {
    throw notFound('bar.unset', functionId, `${functionId} has no bar on it`);
  }
  return found;
}

export function recordPour(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  input: { itemCode: string; openingTenths: number; closingTenths: number; unitMinor: number },
): Pour {
  const slot = requireFunction(db, functionId);
  const bar = requireBar(db, functionId);
  // A cash bar is the guests' money, not the house's, so counting the house's
  // bottles against it says nothing. A package bar is a different matter: the
  // liquor still came out of the cellar, and the count is the only way to know
  // whether the tier was priced anywhere near right. So the count is taken on
  // a package bar and simply not billed.
  if (bar.kind === 'CASH') {
    throw conflict(
      'bar.notconsumption',
      `${functionId} is a cash bar, so the bottles are not the house's to count`,
      functionId,
    );
  }
  const itemCode = catalogCode(input.itemCode);
  const item = requireItem(db, slot.propertyCode, itemCode);
  if (item.kind !== 'BEVERAGE') {
    throw invalidInput('bar.item', `${itemCode} is ${item.kind} and does not come off a bar`);
  }
  for (const [label, value] of [
    ['opening', input.openingTenths],
    ['closing', input.closingTenths],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw invalidInput('bar.count', `the ${label} count is whole tenths of a bottle`);
    }
  }
  if (input.closingTenths > input.openingTenths) {
    throw invalidInput(
      'bar.count',
      `${itemCode} closed fuller than it opened, which is a counting mistake rather than a pour`,
    );
  }
  if (!Number.isSafeInteger(input.unitMinor) || input.unitMinor < 0) {
    throw invalidInput('bar.price', 'a bottle price is a whole number of minor units');
  }

  db.prepare(
    `insert into bar_pour (function_id, item_code, opening_tenths, closing_tenths, unit_minor)
     values (?, ?, ?, ?, ?)
     on conflict (function_id, item_code) do update set
       opening_tenths = excluded.opening_tenths,
       closing_tenths = excluded.closing_tenths,
       unit_minor = excluded.unit_minor`,
  ).run(functionId, itemCode, input.openingTenths, input.closingTenths, input.unitMinor);

  const property = requireProperty(db, slot.propertyCode);
  return {
    itemCode,
    openingTenths: input.openingTenths,
    closingTenths: input.closingTenths,
    unit: money(input.unitMinor, property.currency),
  };
}

export function listPours(db: Database, functionId: EntityId<'functionSlot'>): Pour[] {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  return db
    .prepare<
      [string],
      { item_code: string; opening_tenths: number; closing_tenths: number; unit_minor: number }
    >('select * from bar_pour where function_id = ? order by item_code')
    .all(functionId)
    .map((row) => ({
      itemCode: catalogCode(row.item_code),
      openingTenths: row.opening_tenths,
      closingTenths: row.closing_tenths,
      unit: money(row.unit_minor, property.currency),
    }));
}

/** Tenths poured, which is closing subtracted from opening. */
export function pouredTenths(pour: Pour): number {
  return pour.openingTenths - pour.closingTenths;
}

export function pourCharge(pour: Pour): Money {
  return money(Math.round((pour.unit.amount * pouredTenths(pour)) / 10), pour.unit.currency);
}

export interface BarCharge {
  readonly kind: BarKind;
  readonly covers: number;
  readonly hours: number;
  readonly amount: Money;
  readonly detail: string;
}

/**
 * What the bar comes to. A package bar is the billed covers at the tier rate
 * for the first hour plus the extra rate for each hour after it. A consumption
 * bar is the sum of what came out of the bottles. A cash bar charges the
 * client nothing, because the guests paid at the bar.
 */
export function barCharge(db: Database, functionId: EntityId<'functionSlot'>): BarCharge {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const bar = requireBar(db, functionId);

  if (bar.kind === 'CASH') {
    return {
      kind: bar.kind,
      covers: 0,
      hours: bar.hours,
      amount: zeroMoney(property.currency),
      detail: 'guests paid at the bar',
    };
  }

  if (bar.kind === 'CONSUMPTION') {
    const pours = listPours(db, functionId);
    const amount = pours.reduce<Money>(
      (total, pour) => addMoney(total, pourCharge(pour)),
      zeroMoney(property.currency),
    );
    const bottles = pours.reduce((total, pour) => total + pouredTenths(pour), 0) / 10;
    return {
      kind: bar.kind,
      covers: 0,
      hours: bar.hours,
      amount,
      detail: `${bottles.toFixed(1)} bottles across ${pours.length} lines`,
    };
  }

  if (bar.tierCode === undefined) {
    throw conflict('bar.untiered', `${functionId} is a package bar with no tier on it`, functionId);
  }
  const tier = requireBarTier(db, slot.propertyCode, bar.tierCode);
  const covers = billedCovers(requireCovers(db, functionId));
  const extraHours = Math.max(0, bar.hours - 1);
  const amount = addMoney(
    scaleMoney(tier.firstHour, covers),
    scaleMoney(scaleMoney(tier.extraHour, covers), extraHours),
  );
  return {
    kind: bar.kind,
    covers,
    hours: bar.hours,
    amount,
    detail: `${tier.code} at ${covers} covers for ${bar.hours} hours`,
  };
}
