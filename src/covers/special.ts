/**
 * Special meals.
 *
 * The rule that catches people out is that a special meal comes out of the
 * guarantee rather than sitting on top of it. Twelve vegan covers on a
 * guarantee of a hundred and eighty means a hundred and sixty eight standard
 * plates and twelve vegan ones, not a hundred and ninety two plates. Getting
 * that wrong costs the kitchen twelve mains and the client nothing.
 *
 * The substitute is checked against what the guest cannot eat. A dish that
 * still carries the allergen is not a substitution, and the chef finding that
 * out at the pass is the failure this file exists to prevent.
 */

import { invalidInput, notFound, ruleViolation } from '../core/errors.js';
import { catalogCode, type CatalogCode, type EntityId } from '../core/ids.js';
import { itemAllergens, itemDiets, requireItem } from '../catalog/items.js';
import { isAllergen, isDiet, type Allergen, type Diet } from '../catalog/types.js';
import { requireFunction } from '../booking/functions.js';
import { inTransaction, type Database } from '../store/database.js';
import { requireCovers } from './guarantee.js';

export interface SpecialMeal {
  readonly id: number;
  readonly functionId: EntityId<'functionSlot'>;
  readonly guestName: string;
  readonly covers: number;
  readonly diet: Diet | undefined;
  readonly allergens: Allergen[];
  readonly substituteItemCode: CatalogCode | undefined;
  readonly note: string;
  readonly createdAt: string;
}

interface MealRow {
  id: number;
  function_id: string;
  guest_name: string;
  covers: number;
  diet: string;
  allergens: string;
  substitute_item_code: string | null;
  note: string;
  created_at: string;
}

function toMeal(row: MealRow): SpecialMeal {
  return {
    id: row.id,
    functionId: row.function_id as EntityId<'functionSlot'>,
    guestName: row.guest_name,
    covers: row.covers,
    diet: row.diet.length === 0 ? undefined : (row.diet as Diet),
    allergens: row.allergens.length === 0 ? [] : (row.allergens.split(',') as Allergen[]),
    substituteItemCode:
      row.substitute_item_code === null ? undefined : catalogCode(row.substitute_item_code),
    note: row.note,
    createdAt: row.created_at,
  };
}

export interface AddSpecialMealInput {
  readonly guestName?: string;
  readonly covers?: number;
  readonly diet?: string;
  readonly allergens?: readonly string[];
  readonly substituteItemCode?: string;
  readonly note?: string;
}

export function addSpecialMeal(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  input: AddSpecialMealInput,
  now: string,
): SpecialMeal {
  const slot = requireFunction(db, functionId);
  const covers = requireCovers(db, functionId);
  const count = input.covers ?? 1;
  if (!Number.isInteger(count) || count < 1) {
    throw invalidInput('special.covers', 'a special meal is for one cover or more');
  }

  const diet = normaliseDiet(input.diet);
  const allergens = normaliseAllergens(input.allergens ?? []);
  if (diet === undefined && allergens.length === 0) {
    throw invalidInput(
      'special.reason',
      'a special meal needs a diet or an allergen on it, otherwise it is just a cover',
    );
  }

  const substituteItemCode =
    input.substituteItemCode === undefined ? undefined : catalogCode(input.substituteItemCode);
  if (substituteItemCode !== undefined) {
    assertSubstituteWorks(db, slot.propertyCode, substituteItemCode, diet, allergens);
  }

  if (covers.guaranteedCovers !== undefined) {
    const already = totalSpecialCovers(db, functionId);
    if (already + count > covers.guaranteedCovers) {
      throw ruleViolation(
        'special.overrun',
        `${functionId} is guaranteed for ${covers.guaranteedCovers} and already carries ${already} special covers, so ${count} more will not fit`,
        'special meals come out of the guarantee, they do not sit on top of it',
      );
    }
  }

  return inTransaction(db, (handle) => {
    const result = handle
      .prepare(
        `insert into special_meal (function_id, guest_name, covers, diet, allergens,
          substitute_item_code, note, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        functionId,
        (input.guestName ?? '').trim(),
        count,
        diet ?? '',
        allergens.join(','),
        substituteItemCode ?? null,
        (input.note ?? '').trim(),
        now,
      );
    return requireSpecialMeal(handle, Number(result.lastInsertRowid));
  });
}

function normaliseDiet(value: string | undefined): Diet | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const upper = value.trim().toUpperCase();
  if (!isDiet(upper)) {
    throw invalidInput('special.diet', `${value} is not a diet this catalog tracks`);
  }
  return upper;
}

function normaliseAllergens(values: readonly string[]): Allergen[] {
  const out: Allergen[] = [];
  for (const value of values) {
    const upper = value.trim().toUpperCase();
    if (upper.length === 0) {
      continue;
    }
    if (!isAllergen(upper)) {
      throw invalidInput('special.allergen', `${value} is not an allergen this catalog tracks`);
    }
    if (!out.includes(upper)) {
      out.push(upper);
    }
  }
  return out.sort();
}

/** A substitute has to actually be safe for the guest it is for. */
export function assertSubstituteWorks(
  db: Database,
  propertyCode: CatalogCode,
  substituteItemCode: CatalogCode,
  diet: Diet | undefined,
  allergens: readonly Allergen[],
): void {
  requireItem(db, propertyCode, substituteItemCode);
  const carries = itemAllergens(db, propertyCode, substituteItemCode);
  const clashing = allergens.filter((allergen) => carries.includes(allergen));
  if (clashing.length > 0) {
    throw ruleViolation(
      'special.substitute',
      `${substituteItemCode} carries ${clashing.join(', ')} and is not a substitute for a guest avoiding it`,
    );
  }
  if (diet !== undefined) {
    const satisfies = itemDiets(db, propertyCode, substituteItemCode);
    if (!satisfies.includes(diet)) {
      throw ruleViolation(
        'special.substitute',
        `${substituteItemCode} is not sold as ${diet}, so it cannot be the substitution for one`,
      );
    }
  }
}

export function findSpecialMeal(db: Database, id: number): SpecialMeal | undefined {
  const row = db.prepare<[number], MealRow>('select * from special_meal where id = ?').get(id);
  return row === undefined ? undefined : toMeal(row);
}

export function requireSpecialMeal(db: Database, id: number): SpecialMeal {
  const found = findSpecialMeal(db, id);
  if (found === undefined) {
    throw notFound('special.missing', String(id), `special meal ${id} is not on file`);
  }
  return found;
}

export function listSpecialMeals(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): SpecialMeal[] {
  return db
    .prepare<[string], MealRow>('select * from special_meal where function_id = ? order by id')
    .all(functionId)
    .map(toMeal);
}

export function removeSpecialMeal(db: Database, id: number): boolean {
  return db.prepare('delete from special_meal where id = ?').run(id).changes > 0;
}

export function totalSpecialCovers(db: Database, functionId: EntityId<'functionSlot'>): number {
  const row = db
    .prepare<
      [string],
      { total: number | null }
    >('select sum(covers) as total from special_meal where function_id = ?')
    .get(functionId);
  return row?.total ?? 0;
}

/**
 * The plate count the kitchen works to. Standard covers are what is left of
 * the guarantee after the special meals are taken out, and the room is still
 * set for the full overset because a spare chair is not a spare plate.
 */
export interface CoverBreakdown {
  readonly guaranteed: number;
  readonly special: number;
  readonly standard: number;
  readonly setFor: number;
  readonly byDiet: { diet: Diet | 'ALLERGEN-ONLY'; covers: number }[];
}

export function coverBreakdown(db: Database, functionId: EntityId<'functionSlot'>): CoverBreakdown {
  const covers = requireCovers(db, functionId);
  if (covers.guaranteedCovers === undefined) {
    throw ruleViolation(
      'covers.unguaranteed',
      `${functionId} has no guarantee, so there is no plate count to work to`,
    );
  }
  const meals = listSpecialMeals(db, functionId);
  const special = meals.reduce((total, meal) => total + meal.covers, 0);

  const tally = new Map<Diet | 'ALLERGEN-ONLY', number>();
  for (const meal of meals) {
    const key = meal.diet ?? 'ALLERGEN-ONLY';
    tally.set(key, (tally.get(key) ?? 0) + meal.covers);
  }

  return {
    guaranteed: covers.guaranteedCovers,
    special,
    standard: covers.guaranteedCovers - special,
    setFor: covers.setCovers ?? covers.guaranteedCovers,
    byDiet: [...tally.entries()]
      .map(([diet, count]) => ({ diet, covers: count }))
      .sort((left, right) => left.diet.localeCompare(right.diet)),
  };
}

/** Every allergen the room between them has to be kept away from. */
export function allergensInTheRoom(db: Database, functionId: EntityId<'functionSlot'>): Allergen[] {
  const out = new Set<Allergen>();
  for (const meal of listSpecialMeals(db, functionId)) {
    for (const allergen of meal.allergens) {
      out.add(allergen);
    }
  }
  return [...out].sort();
}

/** Special meals nobody has yet decided what to cook for. */
export function unresolvedSpecialMeals(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): SpecialMeal[] {
  return listSpecialMeals(db, functionId).filter((meal) => meal.substituteItemCode === undefined);
}

export function assignSubstitute(
  db: Database,
  id: number,
  substituteItemCode: string,
): SpecialMeal {
  const meal = requireSpecialMeal(db, id);
  const slot = requireFunction(db, meal.functionId);
  const code = catalogCode(substituteItemCode);
  assertSubstituteWorks(db, slot.propertyCode, code, meal.diet, meal.allergens);
  db.prepare('update special_meal set substitute_item_code = ? where id = ?').run(code, id);
  return requireSpecialMeal(db, id);
}
