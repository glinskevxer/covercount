/**
 * The two sheets a kitchen actually works from.
 *
 * The production sheet is by station, because that is how the brigade is
 * organised: a chef de partie wants everything their own station makes and
 * nothing else. The pick list is by store, because that is how a porter walks
 * the building, and it goes dry goods first so nothing sits out of the walk in
 * while somebody counts flour.
 */

import { formatCalendarDate, type CalendarDate } from '../core/calendar.js';
import { formatQuantity } from '../core/quantity.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { requireFunction } from '../booking/functions.js';
import { functionsOnDate } from '../booking/diary.js';
import { holdsSpace } from '../booking/types.js';
import { requireItem } from '../catalog/items.js';
import { coverBreakdown, listSpecialMeals } from '../covers/special.js';
import { requireRecipe } from '../production/recipes.js';
import {
  assertEverySpecialResolved,
  batchDemand,
  ingredientDemandForFunctions,
  type IngredientDemand,
} from '../production/explode.js';
import type { Database } from '../store/database.js';

export interface ProductionRow {
  readonly station: string;
  readonly recipeCode: CatalogCode;
  readonly recipeName: string;
  readonly plates: number;
  readonly batches: number;
  readonly batchPortions: number;
}

export interface ProductionSheet {
  readonly functionId: EntityId<'functionSlot'>;
  readonly functionName: string;
  readonly serviceDate: CalendarDate;
  readonly guaranteed: number;
  readonly standard: number;
  readonly special: number;
  readonly rows: ProductionRow[];
  readonly allergens: string[];
  readonly specialNotes: string[];
}

export function productionSheet(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): ProductionSheet {
  const slot = requireFunction(db, functionId);
  const breakdown = coverBreakdown(db, functionId);
  assertEverySpecialResolved(db, functionId);

  const rows: ProductionRow[] = batchDemand(db, functionId).map((batch) => {
    const recipe = requireRecipe(db, slot.propertyCode, batch.recipeCode);
    return {
      station: batch.station,
      recipeCode: recipe.code,
      recipeName: recipe.name,
      plates: batch.plates,
      batches: batch.batches,
      batchPortions: recipe.batchPortions,
    };
  });

  const allergens = new Set<string>();
  const specialNotes: string[] = [];
  for (const meal of listSpecialMeals(db, functionId)) {
    for (const allergen of meal.allergens) {
      allergens.add(allergen);
    }
    const dish =
      meal.substituteItemCode === undefined
        ? 'not decided'
        : requireItem(db, slot.propertyCode, meal.substituteItemCode).name;
    const reason = [meal.diet ?? '', meal.allergens.join(' ')].filter((part) => part.length > 0);
    specialNotes.push(
      `${meal.covers} x ${dish}${reason.length > 0 ? ` (${reason.join(', ')})` : ''}`,
    );
  }

  return {
    functionId,
    functionName: slot.name,
    serviceDate: slot.serviceDate,
    guaranteed: breakdown.guaranteed,
    standard: breakdown.standard,
    special: breakdown.special,
    rows: rows.sort(
      (left, right) =>
        left.station.localeCompare(right.station) ||
        left.recipeCode.localeCompare(right.recipeCode),
    ),
    allergens: [...allergens].sort(),
    specialNotes,
  };
}

export function renderProductionSheet(sheet: ProductionSheet): string {
  const lines: string[] = [];
  lines.push(`PRODUCTION SHEET  ${sheet.functionId}  ${sheet.functionName}`);
  lines.push(formatCalendarDate(sheet.serviceDate));
  lines.push(
    `${sheet.guaranteed} guaranteed, ${sheet.standard} standard plates, ${sheet.special} special`,
  );
  if (sheet.allergens.length > 0) {
    lines.push(`ALLERGENS IN THE ROOM: ${sheet.allergens.join(', ')}`);
  }

  let station = '';
  for (const row of sheet.rows) {
    if (row.station !== station) {
      station = row.station;
      lines.push('');
      lines.push(station);
    }
    lines.push(
      `  ${String(row.plates).padStart(4)} plates  ${String(row.batches).padStart(3)} x ${String(
        row.batchPortions,
      ).padStart(3)}  ${row.recipeName}`,
    );
  }

  if (sheet.specialNotes.length > 0) {
    lines.push('');
    lines.push('SPECIAL MEALS');
    for (const note of sheet.specialNotes) {
      lines.push(`  ${note}`);
    }
  }
  return lines.join('\n');
}

export interface PickRow {
  readonly store: string;
  readonly ingredientCode: CatalogCode;
  readonly name: string;
  readonly needed: string;
  readonly packs: number;
  readonly packSize: string;
}

export interface PickList {
  readonly serviceDate: CalendarDate;
  readonly functionIds: EntityId<'functionSlot'>[];
  readonly rows: PickRow[];
}

function toPickRow(demand: IngredientDemand): PickRow {
  return {
    store: demand.store,
    ingredientCode: demand.ingredientCode,
    name: demand.name,
    needed: formatQuantity(demand.needed),
    packs: demand.packs,
    packSize: formatQuantity(demand.packSize),
  };
}

/**
 * Everything the stores have to issue for one date, across every function
 * still holding space. A released function is not cooked, so it is not picked.
 */
export function pickList(
  db: Database,
  propertyCode: Parameters<typeof functionsOnDate>[1],
  date: CalendarDate,
): PickList {
  const functionIds = functionsOnDate(db, propertyCode, date)
    .filter((slot) => holdsSpace(slot.status))
    .map((slot) => slot.id);

  return {
    serviceDate: date,
    functionIds,
    rows: ingredientDemandForFunctions(db, functionIds).map(toPickRow),
  };
}

export function pickListForFunctions(
  db: Database,
  date: CalendarDate,
  functionIds: readonly EntityId<'functionSlot'>[],
): PickList {
  return {
    serviceDate: date,
    functionIds: [...functionIds],
    rows: ingredientDemandForFunctions(db, functionIds).map(toPickRow),
  };
}

export function renderPickList(list: PickList): string {
  const lines: string[] = [];
  lines.push(`PICK LIST  ${formatCalendarDate(list.serviceDate)}`);
  lines.push(
    list.functionIds.length === 0
      ? 'nothing is in the diary'
      : `for ${list.functionIds.join(', ')}`,
  );
  if (list.rows.length === 0) {
    lines.push('');
    lines.push('nothing to pick');
    return lines.join('\n');
  }

  const width = list.rows.reduce((widest, row) => Math.max(widest, row.name.length), 0);
  let store = '';
  for (const row of list.rows) {
    if (row.store !== store) {
      store = row.store;
      lines.push('');
      lines.push(store);
    }
    lines.push(
      `  ${row.name.padEnd(width)}  ${row.needed.padStart(14)}  ${String(row.packs).padStart(
        3,
      )} x ${row.packSize}`,
    );
  }
  return lines.join('\n');
}

/** Packs by store, for the porter who wants to know how many trips it is. */
export function packsByStore(list: PickList): { store: string; packs: number }[] {
  const tally = new Map<string, number>();
  for (const row of list.rows) {
    tally.set(row.store, (tally.get(row.store) ?? 0) + row.packs);
  }
  return [...tally.entries()].map(([store, packs]) => ({ store, packs }));
}
