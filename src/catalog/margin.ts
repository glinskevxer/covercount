/**
 * What a package costs the house, and what it makes.
 *
 * The interesting rule is that a package does not cost the sum of its items.
 * A main course offering three dishes costs whichever of the three is
 * dearest, because any guest can pick any of them and the house has to be able
 * to serve a room that all picks the same one. Averaging the three is how a
 * package looks profitable on a spreadsheet and loses money on the night the
 * whole room orders the halibut.
 *
 * A course offering more than one choice per cover multiplies that: a station
 * package where every guest takes two of four items costs the two dearest.
 *
 * Where a function is named the actual split is known, and then the honest
 * number is what the room really ordered. Both are reported, because the first
 * is what the package should be priced against and the second is what it
 * actually earned.
 */

import type { CalendarDate } from '../core/calendar.js';
import { notFound } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { addMoney, money, zeroMoney, type Money } from '../core/money.js';
import { requireProperty } from '../property/store.js';
import { requireFunction } from '../booking/functions.js';
import { marginOn, tryCostRecipe, type Margin } from '../production/costing.js';
import { listRecipes } from '../production/recipes.js';
import { plateCounts } from '../covers/selections.js';
import { billedCovers, requireCovers } from '../covers/guarantee.js';
import { packageCourses, requirePackage } from './packages.js';
import { findPriceOn } from './pricing.js';
import type { Course } from './types.js';
import type { Database } from '../store/database.js';

export interface CourseCost {
  readonly course: Course;
  readonly choices: number;
  /** Every item offered, dearest first. */
  readonly options: { itemCode: CatalogCode; cost: Money }[];
  /** The choices that could all be taken at once. */
  readonly worstCase: Money;
  /** Items in the course that no recipe covers, so their cost is unknown. */
  readonly uncosted: CatalogCode[];
}

export interface PackageCost {
  readonly packageCode: CatalogCode;
  readonly on: CalendarDate;
  readonly courses: CourseCost[];
  readonly cost: Money;
  readonly uncosted: number;
}

/**
 * The cost of one item, taken from whichever recipe produces it. An item that
 * two recipes claim is costed at the dearer of the two, which is the same
 * reasoning as the course rule one level down.
 */
function itemCost(
  db: Database,
  propertyCode: CatalogCode,
  itemCode: CatalogCode,
  on: CalendarDate,
): Money | undefined {
  const recipes = listRecipes(db, propertyCode, { itemCode });
  let dearest: Money | undefined;
  for (const recipe of recipes) {
    const costed = tryCostRecipe(db, propertyCode, recipe.code, on)?.portionCost;
    if (costed === undefined) {
      continue;
    }
    if (dearest === undefined || costed.amount > dearest.amount) {
      dearest = costed;
    }
  }
  return dearest;
}

export function costPackage(
  db: Database,
  propertyCode: CatalogCode,
  packageCode: CatalogCode,
  on: CalendarDate,
): PackageCost {
  const property = requireProperty(db, propertyCode);
  requirePackage(db, propertyCode, packageCode);

  const courses: CourseCost[] = [];
  let total = zeroMoney(property.currency);
  let uncosted = 0;

  for (const course of packageCourses(db, propertyCode, packageCode)) {
    const options: { itemCode: CatalogCode; cost: Money }[] = [];
    const missing: CatalogCode[] = [];
    for (const itemCode of course.items) {
      const cost = itemCost(db, propertyCode, itemCode, on);
      if (cost === undefined) {
        missing.push(itemCode);
        continue;
      }
      options.push({ itemCode, cost });
    }
    options.sort((left, right) => right.cost.amount - left.cost.amount);
    const worstCase = options
      .slice(0, Math.max(course.choices, 0))
      .reduce((sum, option) => addMoney(sum, option.cost), zeroMoney(property.currency));
    courses.push({
      course: course.course,
      choices: course.choices,
      options,
      worstCase,
      uncosted: missing,
    });
    total = addMoney(total, worstCase);
    uncosted += missing.length;
  }

  return { packageCode, on, courses, cost: total, uncosted };
}

export interface PackageMargin {
  readonly packageCode: CatalogCode;
  readonly bookCode: CatalogCode;
  readonly on: CalendarDate;
  readonly worstCase: PackageCost;
  readonly margin: Margin;
}

/**
 * The margin the package is priced at, against the worst case the kitchen can
 * be handed. A package with no price in the book on that date has no margin to
 * report, and saying so is more use than reporting a loss of the whole cost.
 */
export function packageMargin(
  db: Database,
  propertyCode: CatalogCode,
  packageCode: CatalogCode,
  bookCode: CatalogCode,
  on: CalendarDate,
): PackageMargin {
  const worstCase = costPackage(db, propertyCode, packageCode, on);
  const price = findPriceOn(db, propertyCode, bookCode, 'PACKAGE', packageCode, on);
  if (price === undefined) {
    throw notFound(
      'margin.price',
      packageCode,
      `${bookCode} carries no price for ${packageCode} on ${on}`,
    );
  }
  return {
    packageCode,
    bookCode,
    on,
    worstCase,
    margin: marginOn(price, worstCase.cost),
  };
}

export interface FunctionMargin {
  readonly functionId: EntityId<'functionSlot'>;
  readonly covers: number;
  /** What the room actually ordered, costed against the real split. */
  readonly actualCost: Money;
  readonly worstCaseCost: Money;
  readonly perCover: Money;
  readonly uncosted: CatalogCode[];
}

/**
 * The cost the room actually ran up, taken from the split rather than from the
 * package. A hundred and eighty covers who all took the beetroot cost what the
 * beetroot costs, whatever the halibut would have cost.
 */
export function functionFoodCost(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  on: CalendarDate,
): FunctionMargin {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const covers = requireCovers(db, functionId);

  let actual = zeroMoney(property.currency);
  const uncosted: CatalogCode[] = [];
  for (const plate of plateCounts(db, functionId)) {
    const cost = itemCost(db, slot.propertyCode, plate.itemCode, on);
    if (cost === undefined) {
      uncosted.push(plate.itemCode);
      continue;
    }
    actual = addMoney(actual, money(cost.amount * plate.plates, property.currency));
  }

  const billed = billedCovers(covers);
  const worst =
    covers.packageCode === undefined
      ? zeroMoney(property.currency)
      : money(
          costPackage(db, slot.propertyCode, covers.packageCode, on).cost.amount * billed,
          property.currency,
        );

  return {
    functionId,
    covers: billed,
    actualCost: actual,
    worstCaseCost: worst,
    perCover:
      billed === 0
        ? zeroMoney(property.currency)
        : money(Math.ceil(actual.amount / billed), property.currency),
    uncosted,
  };
}
