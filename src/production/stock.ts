/**
 * What is on the shelf.
 *
 * A requisition says what a function needs. It says nothing about whether the
 * house already has it, and a chef who orders against need rather than against
 * the gap ends up with four cases of shallots and no room in the walk in.
 *
 * So stock is held two ways and they are deliberately different numbers. The
 * on hand figure is what the last count said, moved by everything issued or
 * received since. The par is what the house wants sitting there before a
 * normal week starts. The order quantity is neither: it is need plus par minus
 * on hand, rounded up to whole packs, because a supplier does not sell a third
 * of a case.
 */

import { invalidInput, notFound } from '../core/errors.js';
import type { CatalogCode } from '../core/ids.js';
import {
  addQuantity,
  convertQuantity,
  MILLI,
  quantityFromMilli,
  subtractQuantity,
  zeroQuantity,
  type Quantity,
} from '../core/quantity.js';
import type { UnitCode } from '../core/units.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import { requireIngredient } from './ingredients.js';

export interface StockLevel {
  readonly ingredientCode: CatalogCode;
  readonly onHand: Quantity;
  readonly par: Quantity;
  readonly countedAt: string;
}

interface LevelRow {
  readonly ingredient_code: string;
  readonly on_hand_milli: number;
  readonly par_milli: number;
  readonly unit: string;
  readonly counted_at: string;
}

function toLevel(row: LevelRow): StockLevel {
  return {
    ingredientCode: row.ingredient_code as CatalogCode,
    onHand: quantityFromMilli(row.on_hand_milli, row.unit as UnitCode),
    par: quantityFromMilli(row.par_milli, row.unit as UnitCode),
    countedAt: row.counted_at,
  };
}

/**
 * Everything is held in the ingredient's own purchase unit. A count taken in
 * kilograms against an item bought in grams is converted on the way in rather
 * than stored as it was typed, so two counts in two units still add up.
 */
function inPurchaseUnit(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
  value: Quantity,
): { milli: number; unit: UnitCode } {
  const ingredient = requireIngredient(db, propertyCode, ingredientCode);
  const converted = convertQuantity(value, ingredient.purchaseUnit);
  return { milli: converted.milli, unit: ingredient.purchaseUnit };
}

export interface CountStockInput {
  readonly onHand: Quantity;
  readonly par?: Quantity;
}

/** Record a physical count, which replaces the running figure outright. */
export function countStock(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
  input: CountStockInput,
  now: string,
): StockLevel {
  requireProperty(db, propertyCode);
  const onHand = inPurchaseUnit(db, propertyCode, ingredientCode, input.onHand);
  if (onHand.milli < 0) {
    throw invalidInput('stock.count', 'a shelf cannot hold less than nothing');
  }
  const par =
    input.par === undefined
      ? undefined
      : inPurchaseUnit(db, propertyCode, ingredientCode, input.par);
  if (par !== undefined && par.milli < 0) {
    throw invalidInput('stock.par', 'a par level is nil or more');
  }

  return inTransaction(db, (handle) => {
    const existing = handle
      .prepare<
        [string, string],
        LevelRow
      >('select * from stock_level where property_code = ? and ingredient_code = ?')
      .get(propertyCode, ingredientCode);
    const parMilli = par?.milli ?? existing?.par_milli ?? 0;
    handle
      .prepare(
        `insert into stock_level
           (property_code, ingredient_code, on_hand_milli, par_milli, unit, counted_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict (property_code, ingredient_code) do update set
           on_hand_milli = excluded.on_hand_milli,
           par_milli = excluded.par_milli,
           unit = excluded.unit,
           counted_at = excluded.counted_at`,
      )
      .run(propertyCode, ingredientCode, onHand.milli, parMilli, onHand.unit, now);
    handle
      .prepare(
        `insert into stock_movement
           (property_code, ingredient_code, moved_milli, unit, reason, reference, moved_at)
         values (?, ?, ?, ?, 'COUNT', '', ?)`,
      )
      .run(
        propertyCode,
        ingredientCode,
        onHand.milli - (existing?.on_hand_milli ?? 0),
        onHand.unit,
        now,
      );
    return {
      ingredientCode,
      onHand: quantityFromMilli(onHand.milli, onHand.unit),
      par: quantityFromMilli(parMilli, onHand.unit),
      countedAt: now,
    };
  });
}

/**
 * Move stock without recounting it. Issuing to a function is negative,
 * receiving a delivery is positive, and both leave a movement row so the next
 * count has something to be reconciled against.
 */
export function moveStock(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
  amount: Quantity,
  reason: string,
  now: string,
  reference = '',
): StockLevel {
  requireProperty(db, propertyCode);
  const moved = inPurchaseUnit(db, propertyCode, ingredientCode, amount);
  const label = reason.trim().toUpperCase();
  if (label.length === 0) {
    throw invalidInput('stock.reason', 'a stock movement needs a reason');
  }

  return inTransaction(db, (handle) => {
    const existing = handle
      .prepare<
        [string, string],
        LevelRow
      >('select * from stock_level where property_code = ? and ingredient_code = ?')
      .get(propertyCode, ingredientCode);
    const before = existing?.on_hand_milli ?? 0;
    const after = before + moved.milli;
    if (after < 0) {
      throw invalidInput(
        'stock.short',
        `there is not that much ${ingredientCode} on the shelf to move`,
      );
    }
    handle
      .prepare(
        `insert into stock_level
           (property_code, ingredient_code, on_hand_milli, par_milli, unit, counted_at)
         values (?, ?, ?, ?, ?, ?)
         on conflict (property_code, ingredient_code) do update set
           on_hand_milli = excluded.on_hand_milli`,
      )
      .run(propertyCode, ingredientCode, after, existing?.par_milli ?? 0, moved.unit, now);
    handle
      .prepare(
        `insert into stock_movement
           (property_code, ingredient_code, moved_milli, unit, reason, reference, moved_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(propertyCode, ingredientCode, moved.milli, moved.unit, label, reference.trim(), now);
    return {
      ingredientCode,
      onHand: quantityFromMilli(after, moved.unit),
      par: quantityFromMilli(existing?.par_milli ?? 0, moved.unit),
      countedAt: existing?.counted_at ?? now,
    };
  });
}

export function findStockLevel(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
): StockLevel | undefined {
  const row = db
    .prepare<
      [string, string],
      LevelRow
    >('select * from stock_level where property_code = ? and ingredient_code = ?')
    .get(propertyCode, ingredientCode);
  return row === undefined ? undefined : toLevel(row);
}

/**
 * What is on the shelf, which for an ingredient nobody has ever counted is
 * nothing rather than an error. A kitchen that has not counted the flour still
 * has a flour requirement.
 */
export function onHand(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
): Quantity {
  const ingredient = requireIngredient(db, propertyCode, ingredientCode);
  return (
    findStockLevel(db, propertyCode, ingredientCode)?.onHand ??
    zeroQuantity(ingredient.purchaseUnit)
  );
}

export function requireStockLevel(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
): StockLevel {
  const found = findStockLevel(db, propertyCode, ingredientCode);
  if (found === undefined) {
    throw notFound('stock.missing', ingredientCode, `${ingredientCode} has never been counted`);
  }
  return found;
}

export function listStockLevels(db: Database, propertyCode: CatalogCode): StockLevel[] {
  return db
    .prepare<
      [string],
      LevelRow
    >('select * from stock_level where property_code = ? order by ingredient_code')
    .all(propertyCode)
    .map(toLevel);
}

export interface StockMovement {
  readonly id: number;
  readonly ingredientCode: CatalogCode;
  readonly moved: Quantity;
  readonly reason: string;
  readonly reference: string;
  readonly movedAt: string;
}

export function stockMovements(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
): StockMovement[] {
  return db
    .prepare<
      [string, string],
      {
        id: number;
        ingredient_code: string;
        moved_milli: number;
        unit: string;
        reason: string;
        reference: string;
        moved_at: string;
      }
    >(
      `select * from stock_movement
       where property_code = ? and ingredient_code = ? order by id`,
    )
    .all(propertyCode, ingredientCode)
    .map((row) => ({
      id: row.id,
      ingredientCode: row.ingredient_code as CatalogCode,
      moved: quantityFromMilli(row.moved_milli, row.unit as UnitCode),
      reason: row.reason,
      reference: row.reference,
      movedAt: row.moved_at,
    }));
}

export interface OrderLine {
  readonly ingredientCode: CatalogCode;
  readonly needed: Quantity;
  readonly onHand: Quantity;
  readonly par: Quantity;
  /** Need plus par less what is there, before it is rounded to packs. */
  readonly gap: Quantity;
  readonly packs: number;
}

/**
 * Turn a requirement into an order.
 *
 * The par is added to the need rather than compared against it. A house that
 * ordered only the shortfall would come out of every big weekend with an empty
 * walk in, which is what the par level exists to stop.
 */
export function orderLine(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
  needed: Quantity,
): OrderLine {
  const ingredient = requireIngredient(db, propertyCode, ingredientCode);
  const level = findStockLevel(db, propertyCode, ingredientCode);
  const need = convertQuantity(needed, ingredient.purchaseUnit);
  const have = level?.onHand ?? zeroQuantity(ingredient.purchaseUnit);
  const par = level?.par ?? zeroQuantity(ingredient.purchaseUnit);
  const raw = subtractQuantity(addQuantity(need, par), have);
  const gap = raw.milli > 0 ? raw : zeroQuantity(ingredient.purchaseUnit);
  const packMilli = convertQuantity(ingredient.packSize, ingredient.purchaseUnit).milli;
  const packs = packMilli <= 0 ? 0 : Math.ceil(gap.milli / packMilli);
  return { ingredientCode, needed: need, onHand: have, par, gap, packs };
}

/** Everything sitting under its par, which is the reorder report. */
export function belowPar(db: Database, propertyCode: CatalogCode): StockLevel[] {
  return listStockLevels(db, propertyCode).filter((level) => level.onHand.milli < level.par.milli);
}

/** The whole shelf in one number, for a rough valuation or a sanity check. */
export function countedItems(db: Database, propertyCode: CatalogCode): number {
  const row = db
    .prepare<
      [string],
      { total: number }
    >('select count(*) as total from stock_level where property_code = ?')
    .get(propertyCode);
  return row?.total ?? 0;
}

export { MILLI };
