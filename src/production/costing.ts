/**
 * What a plate costs to put out.
 *
 * The number the chef wants is cost per portion, and every step between the
 * supplier's invoice and that number loses something. A pack price is for a
 * pack, not for the quantity a recipe calls for. A recipe calls for a gross
 * quantity, and the yield factor has already taken a bite out of it. A batch
 * makes a batch, and the last one is rarely full.
 *
 * So the arithmetic runs pack price to unit price, unit price to line cost,
 * line cost to batch cost, and batch cost to portion. It is done in that order
 * and in integers throughout, because a tenth of a cent per portion times a
 * thousand covers is a real dollar on a real invoice.
 */

import { calendarDate, type CalendarDate } from '../core/calendar.js';
import { invalidInput, notFound } from '../core/errors.js';
import type { CatalogCode } from '../core/ids.js';
import { money, subtractMoney, zeroMoney, type Money } from '../core/money.js';
import { convertQuantity, type Quantity } from '../core/quantity.js';
import { divideRound } from '../core/rounding.js';
import { PPM, rate, type Rate } from '../core/rate.js';
import { requireProperty } from '../property/store.js';
import { INGREDIENT_COSTS, seriesFor, valueOn } from '../store/effective.js';
import { requireIngredient } from './ingredients.js';
import { grossQuantity, recipeLines, requireRecipe } from './recipes.js';
import type { Database } from '../store/database.js';

export interface IngredientCost {
  readonly ingredientCode: CatalogCode;
  readonly effectiveFrom: CalendarDate;
  readonly pack: Money;
  readonly supplier: string;
}

export function setIngredientCost(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
  effectiveFrom: CalendarDate,
  packMinor: number,
  supplier = '',
): IngredientCost {
  const property = requireProperty(db, propertyCode);
  requireIngredient(db, propertyCode, ingredientCode);
  if (!Number.isSafeInteger(packMinor) || packMinor < 0) {
    throw invalidInput('cost.pack', 'a pack price is a whole amount of minor units, nil or more');
  }
  db.prepare(
    `insert into ingredient_cost
       (property_code, ingredient_code, effective_from, pack_minor, supplier)
     values (?, ?, ?, ?, ?)
     on conflict (property_code, ingredient_code, effective_from) do update set
       pack_minor = excluded.pack_minor, supplier = excluded.supplier`,
  ).run(propertyCode, ingredientCode, effectiveFrom, packMinor, supplier.trim());
  return {
    ingredientCode,
    effectiveFrom,
    pack: money(packMinor, property.currency),
    supplier: supplier.trim(),
  };
}

export function findPackCost(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
  on: CalendarDate,
): Money | undefined {
  const property = requireProperty(db, propertyCode);
  const minor = valueOn(db, INGREDIENT_COSTS, [propertyCode, ingredientCode], on);
  return minor === undefined ? undefined : money(minor, property.currency);
}

export function requirePackCost(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
  on: CalendarDate,
): Money {
  const found = findPackCost(db, propertyCode, ingredientCode, on);
  if (found === undefined) {
    throw notFound(
      'cost.missing',
      ingredientCode,
      `${ingredientCode} has no quoted price on or before ${on}`,
    );
  }
  return found;
}

export function costHistory(
  db: Database,
  propertyCode: CatalogCode,
  ingredientCode: CatalogCode,
): IngredientCost[] {
  const property = requireProperty(db, propertyCode);
  return seriesFor(db, INGREDIENT_COSTS, [propertyCode, ingredientCode]).map((row) => ({
    ingredientCode,
    effectiveFrom: calendarDate(row.effectiveFrom),
    pack: money(row.value, property.currency),
    supplier: '',
  }));
}

export interface RecipeCostLine {
  readonly ingredientCode: CatalogCode;
  /** What the recipe calls for once the yield loss is added back. */
  readonly gross: Quantity;
  readonly packCost: Money;
  readonly packSize: Quantity;
  readonly lineCost: Money;
}

export interface RecipeCost {
  readonly recipeCode: CatalogCode;
  readonly on: CalendarDate;
  readonly batchPortions: number;
  readonly lines: RecipeCostLine[];
  readonly batchCost: Money;
  readonly portionCost: Money;
}

/**
 * Cost one batch, then one portion of it.
 *
 * The portion cost rounds up. A plate that costs a hundredth of a cent more
 * than the house thinks is a plate the house loses money on at volume, and
 * rounding the other way is how a menu ends up underwater by a rounding rule
 * nobody chose on purpose.
 */
export function costRecipe(
  db: Database,
  propertyCode: CatalogCode,
  recipeCode: CatalogCode,
  on: CalendarDate,
): RecipeCost {
  const property = requireProperty(db, propertyCode);
  const recipe = requireRecipe(db, propertyCode, recipeCode);
  const lines: RecipeCostLine[] = [];
  let batchMinor = 0;

  for (const line of recipeLines(db, propertyCode, recipeCode)) {
    const ingredient = requireIngredient(db, propertyCode, line.ingredientCode);
    const packCost = requirePackCost(db, propertyCode, line.ingredientCode, on);
    const gross = grossQuantity(line);
    const grossInPackUnit = convertQuantity(gross, ingredient.packSize.unit);
    const packMilli = ingredient.packSize.milli;
    if (packMilli <= 0) {
      throw invalidInput(
        'cost.pack-size',
        `${line.ingredientCode} has no pack size, so its cost cannot be spread over one`,
      );
    }
    // Cost of the exact quantity used, not of the packs opened to get it.
    const lineMinor = divideRound(packCost.amount * grossInPackUnit.milli, packMilli, 'half-up');
    lines.push({
      ingredientCode: line.ingredientCode,
      gross,
      packCost,
      packSize: ingredient.packSize,
      lineCost: money(lineMinor, property.currency),
    });
    batchMinor += lineMinor;
  }

  const portionMinor =
    recipe.batchPortions <= 0 ? 0 : divideRound(batchMinor, recipe.batchPortions, 'up');
  return {
    recipeCode,
    on,
    batchPortions: recipe.batchPortions,
    lines,
    batchCost: money(batchMinor, property.currency),
    portionCost: money(portionMinor, property.currency),
  };
}

export interface Margin {
  readonly cost: Money;
  readonly price: Money;
  readonly gross: Money;
  /** Gross over price, which is the number a chef is asked about. */
  readonly marginRate: Rate;
  /** Cost over price, the same number the other way up. */
  readonly costRate: Rate;
}

/**
 * The margin on a plate. A price of nothing has no margin rather than an
 * infinite loss, because a package inclusion is not sold on its own and
 * reporting minus infinity on the beetroot helps nobody.
 */
export function marginOn(price: Money, cost: Money): Margin {
  if (price.currency !== cost.currency) {
    throw invalidInput('cost.currency', 'cannot take a margin across two currencies');
  }
  const gross = subtractMoney(price, cost);
  if (price.amount === 0) {
    return { cost, price, gross, marginRate: rate(0), costRate: rate(0) };
  }
  return {
    cost,
    price,
    gross,
    marginRate: rate(divideRound(gross.amount * PPM, price.amount, 'half-up')),
    costRate: rate(divideRound(cost.amount * PPM, price.amount, 'half-up')),
  };
}

/** A zero cost in the property's currency, for a recipe with no lines. */
export function noCost(db: Database, propertyCode: CatalogCode): Money {
  return zeroMoney(requireProperty(db, propertyCode).currency);
}
