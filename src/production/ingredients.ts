/**
 * The ingredients a property buys.
 *
 * A pack size is what actually arrives on the dock: a case of twenty four, a
 * five pound bag, a four litre jug. The requisition rounds up to whole packs
 * because the store cannot issue two thirds of a case, and the difference
 * between what a recipe needs and what has to be ordered is exactly that
 * rounding.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { quantity, type Quantity } from '../core/quantity.js';
import { isUnitCode, unitsAreCompatible, type UnitCode } from '../core/units.js';
import { requireProperty } from '../property/store.js';
import type { Database } from '../store/database.js';
import { isStoreArea, type Ingredient, type StoreArea } from './types.js';

interface IngredientRow {
  property_code: string;
  code: string;
  name: string;
  store: string;
  purchase_unit: string;
  pack_size_milli: number;
  pack_unit: string;
  active: number;
  created_at: string;
}

function toIngredient(row: IngredientRow): Ingredient {
  return {
    propertyCode: catalogCode(row.property_code),
    code: catalogCode(row.code),
    name: row.name,
    store: row.store as StoreArea,
    purchaseUnit: row.purchase_unit as UnitCode,
    packSize: { milli: row.pack_size_milli, unit: row.pack_unit as UnitCode },
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

export interface CreateIngredientInput {
  readonly code: string;
  readonly name: string;
  readonly store: string;
  readonly purchaseUnit: string;
  readonly packSize: number;
  readonly packUnit?: string;
}

export function createIngredient(
  db: Database,
  propertyCode: CatalogCode,
  input: CreateIngredientInput,
  now: string,
): Ingredient {
  requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  const name = input.name.trim();
  if (name.length === 0) {
    throw invalidInput('ingredient.name', 'an ingredient needs a name');
  }
  const store = input.store.trim().toUpperCase();
  if (!isStoreArea(store)) {
    throw invalidInput('ingredient.store', `${input.store} is not a store this kitchen keeps`);
  }
  const purchaseUnit = input.purchaseUnit.trim().toUpperCase();
  if (!isUnitCode(purchaseUnit)) {
    throw invalidInput('ingredient.unit', `${input.purchaseUnit} is not a unit`);
  }
  const packUnit = (input.packUnit ?? purchaseUnit).trim().toUpperCase();
  if (!isUnitCode(packUnit)) {
    throw invalidInput('ingredient.unit', `${input.packUnit} is not a unit`);
  }
  if (!unitsAreCompatible(purchaseUnit, packUnit)) {
    throw invalidInput(
      'ingredient.unit',
      `${code} is bought in ${purchaseUnit} and packed in ${packUnit}, which measure different things`,
    );
  }
  if (!(input.packSize > 0)) {
    throw invalidInput('ingredient.pack', `a pack of ${code} has to hold something`);
  }
  const packSize: Quantity = quantity(input.packSize, packUnit);

  const clash = db
    .prepare<
      [string, string],
      { code: string }
    >('select code from ingredient where property_code = ? and code = ?')
    .get(propertyCode, code);
  if (clash !== undefined) {
    throw conflict('ingredient.exists', `${propertyCode} already has an ingredient ${code}`, code);
  }

  db.prepare(
    `insert into ingredient (property_code, code, name, store, purchase_unit, pack_size_milli,
      pack_unit, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(propertyCode, code, name, store, purchaseUnit, packSize.milli, packUnit, now);

  return requireIngredient(db, propertyCode, code);
}

export function findIngredient(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): Ingredient | undefined {
  const row = db
    .prepare<
      [string, string],
      IngredientRow
    >('select * from ingredient where property_code = ? and code = ?')
    .get(propertyCode, code);
  return row === undefined ? undefined : toIngredient(row);
}

export function requireIngredient(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): Ingredient {
  const found = findIngredient(db, propertyCode, code);
  if (found === undefined) {
    throw notFound('ingredient.missing', code, `${propertyCode} has no ingredient ${code}`);
  }
  return found;
}

export function listIngredients(
  db: Database,
  propertyCode: CatalogCode,
  options: { store?: string; activeOnly?: boolean } = {},
): Ingredient[] {
  const clauses = ['property_code = ?'];
  const params: string[] = [propertyCode];
  if (options.store !== undefined) {
    const store = options.store.trim().toUpperCase();
    if (!isStoreArea(store)) {
      throw invalidInput('ingredient.store', `${options.store} is not a store this kitchen keeps`);
    }
    clauses.push('store = ?');
    params.push(store);
  }
  if (options.activeOnly === true) {
    clauses.push('active = 1');
  }
  return db
    .prepare<string[], IngredientRow>(
      `select * from ingredient where ${clauses.join(' and ')} order by code`,
    )
    .all(...params)
    .map(toIngredient);
}

export function setIngredientActive(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
  active: boolean,
): Ingredient {
  requireIngredient(db, propertyCode, code);
  db.prepare('update ingredient set active = ? where property_code = ? and code = ?').run(
    active ? 1 : 0,
    propertyCode,
    code,
  );
  return requireIngredient(db, propertyCode, code);
}
