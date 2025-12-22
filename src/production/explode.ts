/**
 * Turning a function into a shopping list.
 *
 * The chain is: the split says how many plates of each dish, the recipe says
 * how many whole batches that takes, each recipe line says what one batch
 * needs at the plate, the yield grosses that up to what has to be bought, and
 * the pack size rounds it up again to what the store can actually issue.
 *
 * Every one of those steps rounds up, and they are applied in that order. Any
 * other order understates the order: rounding to packs before applying the
 * yield loses the trim, and scaling a portion rather than a batch loses the
 * fact that a batch of sauce is a batch whether it serves ninety or ninety
 * two.
 */

import { notFound, ruleViolation } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import {
  addQuantity,
  convertQuantity,
  quantityToNumber,
  scaleQuantity,
  zeroQuantity,
  type Quantity,
} from '../core/quantity.js';
import { requireFunction } from '../booking/functions.js';
import { plateCounts } from '../covers/selections.js';
import { listSpecialMeals } from '../covers/special.js';
import type { Database } from '../store/database.js';
import { requireIngredient } from './ingredients.js';
import { batchesFor, grossQuantity, recipeForItem, recipeLines, requireRecipe } from './recipes.js';
import { pickOrder, type StoreArea } from './types.js';
import { productionFactor, scaleForProduction } from './factors.js';

export interface PlateDemand {
  readonly itemCode: CatalogCode;
  readonly plates: number;
}

export interface BatchDemand {
  readonly recipeCode: CatalogCode;
  readonly itemCode: CatalogCode | undefined;
  /** Plates that reach a guest. */
  readonly plates: number;
  /** Portions the kitchen has to make, which on a buffet is more. */
  readonly produced: number;
  readonly batches: number;
  readonly station: string;
}

export interface IngredientDemand {
  readonly ingredientCode: CatalogCode;
  readonly name: string;
  readonly store: StoreArea;
  readonly needed: Quantity;
  readonly packs: number;
  readonly packSize: Quantity;
}

/**
 * Plates per menu item, the split and the special meal substitutions together.
 * A guest on a vegan substitution eats the substitute, so the plate lands
 * against that dish and not against the one they would otherwise have had.
 */
export function plateDemand(db: Database, functionId: EntityId<'functionSlot'>): PlateDemand[] {
  const tally = new Map<string, number>();
  for (const row of plateCounts(db, functionId)) {
    tally.set(row.itemCode, (tally.get(row.itemCode) ?? 0) + row.plates);
  }
  for (const meal of listSpecialMeals(db, functionId)) {
    if (meal.substituteItemCode === undefined) {
      continue;
    }
    tally.set(meal.substituteItemCode, (tally.get(meal.substituteItemCode) ?? 0) + meal.covers);
  }
  return [...tally.entries()]
    .map(([itemCode, plates]) => ({ itemCode: itemCode as CatalogCode, plates }))
    .sort((left, right) => left.itemCode.localeCompare(right.itemCode));
}

/** Special meals nobody has decided a dish for cannot be exploded. */
export function assertEverySpecialResolved(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): void {
  const open = listSpecialMeals(db, functionId).filter(
    (meal) => meal.substituteItemCode === undefined,
  );
  if (open.length > 0) {
    throw ruleViolation(
      'production.unresolved',
      `${functionId} carries ${open.length} special meals with no dish decided`,
      'give each of them a substitute before the production sheet is drawn',
    );
  }
}

export function batchDemand(db: Database, functionId: EntityId<'functionSlot'>): BatchDemand[] {
  const slot = requireFunction(db, functionId);
  // The service style decides how much more than the plate count the kitchen
  // has to make, and it is applied here rather than after the batching: a
  // buffet at fifteen percent over six batches is seven, not six.
  const factor = productionFactor(db, slot.propertyCode, slot.serviceStyle);
  const out: BatchDemand[] = [];
  for (const demand of plateDemand(db, functionId)) {
    const recipe = recipeForItem(db, slot.propertyCode, demand.itemCode);
    if (recipe === undefined) {
      throw notFound(
        'recipe.missing',
        demand.itemCode,
        `${demand.itemCode} is on the split and no recipe on file makes it`,
      );
    }
    const produced = scaleForProduction(demand.plates, factor);
    out.push({
      recipeCode: recipe.code,
      itemCode: recipe.itemCode,
      plates: demand.plates,
      produced,
      batches: batchesFor(recipe, produced),
      station: recipe.station,
    });
  }
  return out.sort((left, right) => left.recipeCode.localeCompare(right.recipeCode));
}

/**
 * What has to come out of the stores. Quantities are converted into whatever
 * the ingredient is bought in before they are added together, so a recipe
 * asking for quarts and another asking for gallons do not end up in two rows.
 */
export function ingredientDemand(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): IngredientDemand[] {
  const slot = requireFunction(db, functionId);
  const tally = new Map<string, Quantity>();

  for (const batch of batchDemand(db, functionId)) {
    if (batch.batches === 0) {
      continue;
    }
    const recipe = requireRecipe(db, slot.propertyCode, batch.recipeCode);
    for (const line of recipeLines(db, slot.propertyCode, recipe.code)) {
      const ingredient = requireIngredient(db, slot.propertyCode, line.ingredientCode);
      const gross = scaleQuantity(grossQuantity(line), batch.batches);
      const inPurchaseUnit = convertQuantity(gross, ingredient.purchaseUnit, 'up');
      const running = tally.get(ingredient.code) ?? zeroQuantity(ingredient.purchaseUnit);
      tally.set(ingredient.code, addQuantity(running, inPurchaseUnit));
    }
  }

  const out: IngredientDemand[] = [];
  for (const [code, needed] of tally) {
    const ingredient = requireIngredient(db, slot.propertyCode, code as CatalogCode);
    out.push({
      ingredientCode: ingredient.code,
      name: ingredient.name,
      store: ingredient.store,
      needed,
      packs: packsFor(needed, ingredient.packSize),
      packSize: ingredient.packSize,
    });
  }

  return out.sort(
    (left, right) =>
      pickOrder(left.store) - pickOrder(right.store) ||
      left.ingredientCode.localeCompare(right.ingredientCode),
  );
}

/** Whole packs that cover a need. The store cannot issue two thirds of a case. */
export function packsFor(needed: Quantity, packSize: Quantity): number {
  if (packSize.milli <= 0) {
    return 0;
  }
  const aligned = convertQuantity(needed, packSize.unit, 'up');
  if (aligned.milli <= 0) {
    return 0;
  }
  return Math.ceil(aligned.milli / packSize.milli);
}

/** Ingredient demand for several functions at once, for a day sheet. */
export function ingredientDemandForFunctions(
  db: Database,
  functionIds: readonly EntityId<'functionSlot'>[],
): IngredientDemand[] {
  const tally = new Map<string, IngredientDemand>();
  for (const functionId of functionIds) {
    for (const demand of ingredientDemand(db, functionId)) {
      const existing = tally.get(demand.ingredientCode);
      if (existing === undefined) {
        tally.set(demand.ingredientCode, demand);
      } else {
        const needed = addQuantity(existing.needed, demand.needed);
        tally.set(demand.ingredientCode, {
          ...existing,
          needed,
          packs: packsFor(needed, existing.packSize),
        });
      }
    }
  }
  return [...tally.values()].sort(
    (left, right) =>
      pickOrder(left.store) - pickOrder(right.store) ||
      left.ingredientCode.localeCompare(right.ingredientCode),
  );
}

/** How much of a pack is left over, as a percentage of what was ordered. */
export function packWastePercent(demand: IngredientDemand): number {
  if (demand.packs === 0) {
    return 0;
  }
  const ordered = quantityToNumber(demand.packSize) * demand.packs;
  const aligned = convertQuantity(demand.needed, demand.packSize.unit, 'up');
  const used = quantityToNumber(aligned);
  return Math.round(((ordered - used) / ordered) * 100);
}
