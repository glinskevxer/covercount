/**
 * Charge lines.
 *
 * A line is a quantity at a unit price with a category on it. Building the
 * lines is separate from totalling them because the lines are what a
 * coordinator argues with a client about, and the totals are arithmetic
 * nobody should be able to touch.
 *
 * The package line is the one that matters: it is the billed cover count at
 * the package price in force on the contract date, and every one of those
 * three things comes from somewhere else in the build.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type EntityId } from '../core/ids.js';
import { money, scaleMoney, type Money } from '../core/money.js';
import { requireFunction } from '../booking/functions.js';
import { requireBooking } from '../booking/store.js';
import { isFinished } from '../booking/types.js';
import { requireItem } from '../catalog/items.js';
import { requirePriceOn } from '../catalog/pricing.js';
import { billedCovers, requireCovers } from '../covers/guarantee.js';
import { barCharge } from '../bar/store.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import {
  attractsServiceCharge,
  isChargeCategory,
  isChargeSource,
  type ChargeCategory,
  type ChargeLine,
  type ChargeSource,
} from './types.js';

interface LineRow {
  id: number;
  function_id: string;
  category: string;
  description: string;
  quantity: number;
  unit_minor: number;
  item_code: string | null;
  taxable: number;
  serviceable: number;
  source: string;
  position: number;
}

function toLine(row: LineRow, currency: Money['currency']): ChargeLine {
  return {
    id: row.id,
    functionId: row.function_id as EntityId<'functionSlot'>,
    category: row.category as ChargeCategory,
    description: row.description,
    quantity: row.quantity,
    unit: money(row.unit_minor, currency),
    itemCode: row.item_code === null ? undefined : catalogCode(row.item_code),
    taxable: row.taxable === 1,
    serviceable: row.serviceable === 1,
    source: row.source as ChargeSource,
    position: row.position,
  };
}

export interface AddChargeInput {
  readonly category: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitMinor: number;
  readonly itemCode?: string;
  readonly taxable?: boolean;
  readonly serviceable?: boolean;
  readonly source?: string;
}

export function addCharge(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  input: AddChargeInput,
): ChargeLine {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const booking = requireBooking(db, slot.bookingId);
  if (isFinished(booking.status)) {
    throw conflict(
      'booking.finished',
      `booking ${booking.id} is ${booking.status.toLowerCase()} and takes no more charges`,
      booking.id,
    );
  }

  const category = input.category.trim().toUpperCase();
  if (!isChargeCategory(category)) {
    throw invalidInput('charge.category', `${input.category} is not a charge category`);
  }
  const source = (input.source ?? 'MANUAL').trim().toUpperCase();
  if (!isChargeSource(source)) {
    throw invalidInput('charge.source', `${input.source} is not a charge source`);
  }
  if (input.description.trim().length === 0) {
    throw invalidInput('charge.description', 'a charge line needs a description');
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    throw invalidInput('charge.quantity', 'a charge quantity is a whole number');
  }
  if (!Number.isSafeInteger(input.unitMinor)) {
    throw invalidInput('charge.unit', 'a unit price is a whole number of minor units');
  }
  const itemCode = input.itemCode === undefined ? undefined : catalogCode(input.itemCode);
  if (itemCode !== undefined) {
    requireItem(db, slot.propertyCode, itemCode);
  }

  return inTransaction(db, (handle) => {
    const next = handle
      .prepare<
        [string],
        { next: number | null }
      >('select max(position) as next from charge_line where function_id = ?')
      .get(functionId);
    const position = (next?.next ?? 0) + 1;
    const result = handle
      .prepare(
        `insert into charge_line (function_id, category, description, quantity, unit_minor,
          item_code, taxable, serviceable, source, position)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        functionId,
        category,
        input.description.trim(),
        input.quantity,
        input.unitMinor,
        itemCode ?? null,
        input.taxable === false ? 0 : 1,
        (input.serviceable ?? attractsServiceCharge(category)) ? 1 : 0,
        source,
        position,
      );
    return requireCharge(handle, Number(result.lastInsertRowid), property.currency);
  });
}

export function findCharge(
  db: Database,
  id: number,
  currency: Money['currency'],
): ChargeLine | undefined {
  const row = db.prepare<[number], LineRow>('select * from charge_line where id = ?').get(id);
  return row === undefined ? undefined : toLine(row, currency);
}

export function requireCharge(db: Database, id: number, currency: Money['currency']): ChargeLine {
  const found = findCharge(db, id, currency);
  if (found === undefined) {
    throw notFound('charge.missing', String(id), `charge line ${id} is not on file`);
  }
  return found;
}

export function listCharges(db: Database, functionId: EntityId<'functionSlot'>): ChargeLine[] {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  return db
    .prepare<[string], LineRow>(
      'select * from charge_line where function_id = ? order by position, id',
    )
    .all(functionId)
    .map((row) => toLine(row, property.currency));
}

export function removeCharge(db: Database, id: number): boolean {
  return db.prepare('delete from charge_line where id = ?').run(id).changes > 0;
}

export function removeChargesFrom(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  source: ChargeSource,
): number {
  return db
    .prepare('delete from charge_line where function_id = ? and source = ?')
    .run(functionId, source).changes;
}

/** Quantity times unit price, which is the only arithmetic a line carries. */
export function lineTotal(line: ChargeLine): Money {
  return scaleMoney(line.unit, line.quantity);
}

/**
 * Draw the charge lines the package implies: the billed covers at the package
 * price in force on the contract date, plus one line per upcharge item that
 * anybody actually chose.
 */
export function drawPackageCharges(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): ChargeLine[] {
  const slot = requireFunction(db, functionId);
  const covers = requireCovers(db, functionId);
  if (covers.packageCode === undefined) {
    throw conflict(
      'charge.nopackage',
      `${functionId} has no package on it, so there is nothing to price`,
      functionId,
    );
  }
  if (covers.priceBookCode === undefined) {
    throw conflict(
      'charge.nobook',
      `${functionId} names no price book, so the package cannot be priced`,
      functionId,
    );
  }

  const billed = billedCovers(covers);
  const price = requirePriceOn(
    db,
    slot.propertyCode,
    covers.priceBookCode,
    'PACKAGE',
    covers.packageCode,
    covers.contractDate,
  );

  return inTransaction(db, (handle) => {
    removeChargesFrom(handle, functionId, 'PACKAGE');
    addCharge(handle, functionId, {
      category: 'FOOD',
      description: `${covers.packageCode ?? ''} at ${billed} covers`,
      quantity: billed,
      unitMinor: price.amount,
      source: 'PACKAGE',
      serviceable: true,
      taxable: true,
    });
    return listCharges(handle, functionId).filter((line) => line.source === 'PACKAGE');
  });
}

/** Add an upcharge for the covers that took it, priced off the same book. */
export function addUpcharge(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  itemCode: string,
  covers: number,
): ChargeLine {
  const slot = requireFunction(db, functionId);
  const counted = requireCovers(db, functionId);
  if (counted.priceBookCode === undefined) {
    throw conflict('charge.nobook', `${functionId} names no price book`, functionId);
  }
  const code = catalogCode(itemCode);
  const item = requireItem(db, slot.propertyCode, code);
  if (!item.isUpcharge) {
    throw invalidInput('charge.upcharge', `${code} is not sold as an upcharge`);
  }
  const price = requirePriceOn(
    db,
    slot.propertyCode,
    counted.priceBookCode,
    'ITEM',
    code,
    counted.contractDate,
  );
  return addCharge(db, functionId, {
    category: item.kind === 'BEVERAGE' ? 'BEVERAGE' : 'FOOD',
    description: `${item.name} upcharge`,
    quantity: covers,
    unitMinor: price.amount,
    itemCode: code,
    source: 'UPCHARGE',
  });
}

/**
 * Draw the bar onto the bill.
 *
 * The bar is worked out in its own module because the two ways of selling it
 * have nothing in common, but it has to land on the invoice like everything
 * else. A cash bar draws no line at all rather than a line for nothing, which
 * is what a coordinator expects to see.
 */
export function drawBarCharges(db: Database, functionId: EntityId<'functionSlot'>): ChargeLine[] {
  const charge = barCharge(db, functionId);

  return inTransaction(db, (handle) => {
    removeChargesFrom(handle, functionId, 'BAR');
    if (charge.amount.amount === 0) {
      return [];
    }
    addCharge(handle, functionId, {
      category: 'BEVERAGE',
      description:
        charge.kind === 'PACKAGE'
          ? `Package bar, ${charge.detail}`
          : `Consumption bar, ${charge.detail}`,
      quantity: 1,
      unitMinor: charge.amount.amount,
      source: 'BAR',
      serviceable: true,
      taxable: true,
    });
    return listCharges(handle, functionId).filter((line) => line.source === 'BAR');
  });
}
