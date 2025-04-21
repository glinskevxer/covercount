/**
 * Recipes.
 *
 * A recipe is a batch, not a portion. Holding it as a batch is what makes the
 * scaling honest: a sauce that is made in gallons and serves ninety does not
 * become a ninetieth of a gallon per cover, it becomes however many whole
 * batches cover the plate count. The yield percent on each line is applied
 * before the pack rounding, never after, because ordering the plate weight and
 * then rounding up to a case still leaves the line short on trim.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { quantity, scaleQuantityByRatio, type Quantity } from '../core/quantity.js';
import { isUnitCode, unitsAreCompatible, type UnitCode } from '../core/units.js';
import { findItem } from '../catalog/items.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import { requireIngredient } from './ingredients.js';
import { isStation, type Recipe, type RecipeLine, type Station } from './types.js';

interface RecipeRow {
  property_code: string;
  code: string;
  name: string;
  item_code: string | null;
  batch_portions: number;
  station: string;
  method: string;
  created_at: string;
}

interface LineRow {
  position: number;
  ingredient_code: string;
  quantity_milli: number;
  quantity_unit: string;
  yield_percent: number;
  note: string;
}

function toRecipe(row: RecipeRow): Recipe {
  return {
    propertyCode: catalogCode(row.property_code),
    code: catalogCode(row.code),
    name: row.name,
    itemCode: row.item_code === null ? undefined : catalogCode(row.item_code),
    batchPortions: row.batch_portions,
    station: row.station as Station,
    method: row.method,
    createdAt: row.created_at,
  };
}

export interface RecipeLineInput {
  readonly ingredientCode: string;
  readonly quantity: number;
  readonly unit: string;
  readonly yieldPercent?: number;
  readonly note?: string;
}

export interface CreateRecipeInput {
  readonly code: string;
  readonly name: string;
  readonly batchPortions: number;
  readonly station: string;
  readonly itemCode?: string;
  readonly method?: string;
  readonly lines: readonly RecipeLineInput[];
}

export function createRecipe(
  db: Database,
  propertyCode: CatalogCode,
  input: CreateRecipeInput,
  now: string,
): Recipe {
  requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  const name = input.name.trim();
  if (name.length === 0) {
    throw invalidInput('recipe.name', 'a recipe needs a name');
  }
  if (!Number.isInteger(input.batchPortions) || input.batchPortions < 1) {
    throw invalidInput('recipe.batch', `a batch of ${code} has to make at least one portion`);
  }
  const station = input.station.trim().toUpperCase();
  if (!isStation(station)) {
    throw invalidInput('recipe.station', `${input.station} is not a station in this kitchen`);
  }
  const itemCode = input.itemCode === undefined ? undefined : catalogCode(input.itemCode);
  if (itemCode !== undefined && findItem(db, propertyCode, itemCode) === undefined) {
    throw notFound('item.missing', itemCode, `${propertyCode} has no menu item ${itemCode}`);
  }
  if (input.lines.length === 0) {
    throw invalidInput('recipe.lines', `${code} has no ingredients on it`);
  }

  const lines = input.lines.map((line, index) =>
    normaliseLine(db, propertyCode, code, line, index),
  );
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.ingredientCode)) {
      throw invalidInput('recipe.lines', `${code} lists ${line.ingredientCode} twice`);
    }
    seen.add(line.ingredientCode);
  }

  return inTransaction(db, (handle) => {
    const clash = handle
      .prepare<
        [string, string],
        { code: string }
      >('select code from recipe where property_code = ? and code = ?')
      .get(propertyCode, code);
    if (clash !== undefined) {
      throw conflict('recipe.exists', `${propertyCode} already has a recipe ${code}`, code);
    }

    handle
      .prepare(
        `insert into recipe (property_code, code, name, item_code, batch_portions, station,
          method, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        propertyCode,
        code,
        name,
        itemCode ?? null,
        input.batchPortions,
        station,
        (input.method ?? '').trim(),
        now,
      );

    const insert = handle.prepare(
      `insert into recipe_line (property_code, recipe_code, position, ingredient_code,
        quantity_milli, quantity_unit, yield_percent, note)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const line of lines) {
      insert.run(
        propertyCode,
        code,
        line.position,
        line.ingredientCode,
        line.quantity.milli,
        line.quantity.unit,
        line.yieldPercent,
        line.note,
      );
    }

    return requireRecipe(handle, propertyCode, code);
  });
}

function normaliseLine(
  db: Database,
  propertyCode: CatalogCode,
  recipeCode: CatalogCode,
  line: RecipeLineInput,
  index: number,
): RecipeLine {
  const ingredientCode = catalogCode(line.ingredientCode);
  const ingredient = requireIngredient(db, propertyCode, ingredientCode);
  const unit = line.unit.trim().toUpperCase();
  if (!isUnitCode(unit)) {
    throw invalidInput('recipe.unit', `${line.unit} is not a unit`);
  }
  if (!unitsAreCompatible(unit, ingredient.purchaseUnit)) {
    throw invalidInput(
      'recipe.unit',
      `${recipeCode} asks for ${ingredientCode} in ${unit} but it is bought in ${ingredient.purchaseUnit}`,
    );
  }
  if (!(line.quantity > 0)) {
    throw invalidInput(
      'recipe.quantity',
      `${recipeCode} asks for ${line.quantity} of ${ingredientCode}, which is not a quantity`,
    );
  }
  const yieldPercent = line.yieldPercent ?? 100;
  if (!Number.isInteger(yieldPercent) || yieldPercent < 1 || yieldPercent > 100) {
    throw invalidInput(
      'recipe.yield',
      `a yield is a whole percent between 1 and 100, got ${yieldPercent} on ${ingredientCode}`,
    );
  }
  return {
    position: index + 1,
    ingredientCode,
    quantity: quantity(line.quantity, unit),
    yieldPercent,
    note: (line.note ?? '').trim(),
  };
}

export function findRecipe(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): Recipe | undefined {
  const row = db
    .prepare<
      [string, string],
      RecipeRow
    >('select * from recipe where property_code = ? and code = ?')
    .get(propertyCode, code);
  return row === undefined ? undefined : toRecipe(row);
}

export function requireRecipe(db: Database, propertyCode: CatalogCode, code: CatalogCode): Recipe {
  const found = findRecipe(db, propertyCode, code);
  if (found === undefined) {
    throw notFound('recipe.missing', code, `${propertyCode} has no recipe ${code}`);
  }
  return found;
}

export function listRecipes(
  db: Database,
  propertyCode: CatalogCode,
  options: { station?: string; itemCode?: string } = {},
): Recipe[] {
  const clauses = ['property_code = ?'];
  const params: string[] = [propertyCode];
  if (options.station !== undefined) {
    const station = options.station.trim().toUpperCase();
    if (!isStation(station)) {
      throw invalidInput('recipe.station', `${options.station} is not a station in this kitchen`);
    }
    clauses.push('station = ?');
    params.push(station);
  }
  if (options.itemCode !== undefined) {
    clauses.push('item_code = ?');
    params.push(catalogCode(options.itemCode));
  }
  return db
    .prepare<string[], RecipeRow>(
      `select * from recipe where ${clauses.join(' and ')} order by code`,
    )
    .all(...params)
    .map(toRecipe);
}

export function recipeLines(
  db: Database,
  propertyCode: CatalogCode,
  recipeCode: CatalogCode,
): RecipeLine[] {
  return db
    .prepare<[string, string], LineRow>(
      `select position, ingredient_code, quantity_milli, quantity_unit, yield_percent, note
       from recipe_line where property_code = ? and recipe_code = ? order by position`,
    )
    .all(propertyCode, recipeCode)
    .map((row) => ({
      position: row.position,
      ingredientCode: catalogCode(row.ingredient_code),
      quantity: { milli: row.quantity_milli, unit: row.quantity_unit as UnitCode },
      yieldPercent: row.yield_percent,
      note: row.note,
    }));
}

/**
 * The gross quantity to buy for one batch: the plate quantity divided by the
 * yield. A line needing nine pounds at ninety percent yield needs ten bought.
 */
export function grossQuantity(line: RecipeLine): Quantity {
  if (line.yieldPercent === 100) {
    return line.quantity;
  }
  return scaleQuantityByRatio(line.quantity, 100, line.yieldPercent, 'up');
}

/** Whole batches needed to cover a plate count. */
export function batchesFor(recipe: Recipe, portions: number): number {
  if (!Number.isInteger(portions) || portions < 0) {
    throw invalidInput('recipe.portions', 'a plate count is a whole number');
  }
  return Math.ceil(portions / recipe.batchPortions);
}

/** The recipe that makes a menu item, if one is on file. */
export function recipeForItem(
  db: Database,
  propertyCode: CatalogCode,
  itemCode: CatalogCode,
): Recipe | undefined {
  return listRecipes(db, propertyCode, { itemCode })[0];
}
