/**
 * Menu items, what they contain and which diets they satisfy.
 *
 * The two lists are stored, not derived. A dish with no dairy in it is not
 * automatically dairy free, because the kitchen may not be able to guarantee
 * the surface it was made on, and that judgement belongs to the chef rather
 * than to a rule in this file. What the file does enforce is that the two
 * lists cannot contradict each other.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import {
  isAllergen,
  isCourse,
  isDiet,
  isItemKind,
  isSoldBy,
  type Allergen,
  type Course,
  type Diet,
  type ItemKind,
  type MenuItem,
  type SoldBy,
} from './types.js';

/**
 * A diet that an allergen rules out. A dish carrying MILK cannot be sold as
 * dairy free however it was cooked, and this is the one direction that is a
 * fact rather than a judgement.
 */
export const ALLERGEN_BLOCKS_DIET: Readonly<Record<Allergen, readonly Diet[]>> = {
  MILK: ['VEGAN', 'DAIRY-FREE'],
  EGG: ['VEGAN'],
  FISH: ['VEGETARIAN', 'VEGAN'],
  SHELLFISH: ['VEGETARIAN', 'VEGAN', 'PESCATARIAN'],
  TREENUT: ['NUT-FREE'],
  PEANUT: ['NUT-FREE'],
  WHEAT: ['GLUTEN-FREE'],
  SOY: [],
  SESAME: [],
  SULPHITE: [],
  ALCOHOL: ['HALAL'],
  PORK: ['VEGETARIAN', 'VEGAN', 'PESCATARIAN', 'HALAL', 'KOSHER'],
  BEEF: ['VEGETARIAN', 'VEGAN', 'PESCATARIAN'],
  GELATIN: ['VEGETARIAN', 'VEGAN'],
};

interface ItemRow {
  property_code: string;
  code: string;
  name: string;
  kind: string;
  course: string;
  sold_by: string;
  is_upcharge: number;
  active: number;
  description: string;
  created_at: string;
}

function toItem(row: ItemRow): MenuItem {
  return {
    propertyCode: catalogCode(row.property_code),
    code: catalogCode(row.code),
    name: row.name,
    kind: row.kind as ItemKind,
    course: row.course as Course,
    soldBy: row.sold_by as SoldBy,
    isUpcharge: row.is_upcharge === 1,
    active: row.active === 1,
    description: row.description,
    createdAt: row.created_at,
  };
}

export interface CreateItemInput {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly course?: string;
  readonly soldBy?: string;
  readonly isUpcharge?: boolean;
  readonly description?: string;
  readonly allergens?: readonly string[];
  readonly diets?: readonly string[];
}

export function createItem(
  db: Database,
  propertyCode: CatalogCode,
  input: CreateItemInput,
  now: string,
): MenuItem {
  requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  const name = input.name.trim();
  if (name.length === 0) {
    throw invalidInput('item.name', 'a menu item needs a name');
  }
  const kind = input.kind.trim().toUpperCase();
  if (!isItemKind(kind)) {
    throw invalidInput('item.kind', `${input.kind} is not a kind of thing this catalog sells`);
  }
  const course = (input.course ?? 'NONE').trim().toUpperCase();
  if (!isCourse(course)) {
    throw invalidInput('item.course', `${input.course} is not a course`);
  }
  if (kind !== 'FOOD' && kind !== 'BEVERAGE' && course !== 'NONE') {
    throw invalidInput(
      'item.course',
      `${code} is ${kind} and cannot sit in the ${course} course, only food and beverage do`,
    );
  }
  const soldBy = (input.soldBy ?? 'PERSON').trim().toUpperCase();
  if (!isSoldBy(soldBy)) {
    throw invalidInput('item.sold-by', `${input.soldBy} is not a unit of sale`);
  }

  const allergens = normaliseAllergens(input.allergens ?? []);
  const diets = normaliseDiets(input.diets ?? []);
  assertNoContradiction(code, allergens, diets);

  return inTransaction(db, (handle) => {
    const clash = handle
      .prepare<
        [string, string],
        { code: string }
      >('select code from menu_item where property_code = ? and code = ?')
      .get(propertyCode, code);
    if (clash !== undefined) {
      throw conflict('item.exists', `${propertyCode} already has a menu item ${code}`, code);
    }
    handle
      .prepare(
        `insert into menu_item (property_code, code, name, kind, course, sold_by, is_upcharge,
          description, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        propertyCode,
        code,
        name,
        kind,
        course,
        soldBy,
        input.isUpcharge === true ? 1 : 0,
        (input.description ?? '').trim(),
        now,
      );
    writeAllergens(handle, propertyCode, code, allergens);
    writeDiets(handle, propertyCode, code, diets);
    return requireItem(handle, propertyCode, code);
  });
}

function normaliseAllergens(values: readonly string[]): Allergen[] {
  const out: Allergen[] = [];
  for (const value of values) {
    const upper = value.trim().toUpperCase();
    if (upper.length === 0) {
      continue;
    }
    if (!isAllergen(upper)) {
      throw invalidInput('item.allergen', `${value} is not an allergen this catalog tracks`);
    }
    if (!out.includes(upper)) {
      out.push(upper);
    }
  }
  return out.sort();
}

function normaliseDiets(values: readonly string[]): Diet[] {
  const out: Diet[] = [];
  for (const value of values) {
    const upper = value.trim().toUpperCase();
    if (upper.length === 0) {
      continue;
    }
    if (!isDiet(upper)) {
      throw invalidInput('item.diet', `${value} is not a diet this catalog tracks`);
    }
    if (!out.includes(upper)) {
      out.push(upper);
    }
  }
  return out.sort();
}

function assertNoContradiction(
  code: CatalogCode,
  allergens: readonly Allergen[],
  diets: readonly Diet[],
): void {
  for (const allergen of allergens) {
    for (const blocked of ALLERGEN_BLOCKS_DIET[allergen]) {
      if (diets.includes(blocked)) {
        throw invalidInput(
          'item.contradiction',
          `${code} carries ${allergen} and cannot also be sold as ${blocked}`,
        );
      }
    }
  }
}

function writeAllergens(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
  allergens: readonly Allergen[],
): void {
  db.prepare('delete from menu_item_allergen where property_code = ? and item_code = ?').run(
    propertyCode,
    code,
  );
  const insert = db.prepare(
    'insert into menu_item_allergen (property_code, item_code, allergen) values (?, ?, ?)',
  );
  for (const allergen of allergens) {
    insert.run(propertyCode, code, allergen);
  }
}

function writeDiets(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
  diets: readonly Diet[],
): void {
  db.prepare('delete from menu_item_diet where property_code = ? and item_code = ?').run(
    propertyCode,
    code,
  );
  const insert = db.prepare(
    'insert into menu_item_diet (property_code, item_code, diet) values (?, ?, ?)',
  );
  for (const diet of diets) {
    insert.run(propertyCode, code, diet);
  }
}

export function findItem(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): MenuItem | undefined {
  const row = db
    .prepare<
      [string, string],
      ItemRow
    >('select * from menu_item where property_code = ? and code = ?')
    .get(propertyCode, code);
  return row === undefined ? undefined : toItem(row);
}

export function requireItem(db: Database, propertyCode: CatalogCode, code: CatalogCode): MenuItem {
  const found = findItem(db, propertyCode, code);
  if (found === undefined) {
    throw notFound('item.missing', code, `${propertyCode} has no menu item ${code}`);
  }
  return found;
}

export interface ItemQuery {
  readonly course?: string;
  readonly kind?: string;
  readonly activeOnly?: boolean;
}

export function listItems(
  db: Database,
  propertyCode: CatalogCode,
  query: ItemQuery = {},
): MenuItem[] {
  const clauses = ['property_code = ?'];
  const params: string[] = [propertyCode];
  if (query.course !== undefined) {
    const course = query.course.trim().toUpperCase();
    if (!isCourse(course)) {
      throw invalidInput('item.course', `${query.course} is not a course`);
    }
    clauses.push('course = ?');
    params.push(course);
  }
  if (query.kind !== undefined) {
    const kind = query.kind.trim().toUpperCase();
    if (!isItemKind(kind)) {
      throw invalidInput('item.kind', `${query.kind} is not a kind of thing this catalog sells`);
    }
    clauses.push('kind = ?');
    params.push(kind);
  }
  if (query.activeOnly === true) {
    clauses.push('active = 1');
  }
  return db
    .prepare<string[], ItemRow>(
      `select * from menu_item where ${clauses.join(' and ')} order by code`,
    )
    .all(...params)
    .map(toItem);
}

export function itemAllergens(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): Allergen[] {
  return db
    .prepare<[string, string], { allergen: string }>(
      `select allergen from menu_item_allergen
       where property_code = ? and item_code = ? order by allergen`,
    )
    .all(propertyCode, code)
    .map((row) => row.allergen as Allergen);
}

export function itemDiets(db: Database, propertyCode: CatalogCode, code: CatalogCode): Diet[] {
  return db
    .prepare<[string, string], { diet: string }>(
      `select diet from menu_item_diet
       where property_code = ? and item_code = ? order by diet`,
    )
    .all(propertyCode, code)
    .map((row) => row.diet as Diet);
}

export function setItemAllergens(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
  allergens: readonly string[],
): Allergen[] {
  requireItem(db, propertyCode, code);
  const normalised = normaliseAllergens(allergens);
  assertNoContradiction(code, normalised, itemDiets(db, propertyCode, code));
  writeAllergens(db, propertyCode, code, normalised);
  return normalised;
}

export function setItemDiets(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
  diets: readonly string[],
): Diet[] {
  requireItem(db, propertyCode, code);
  const normalised = normaliseDiets(diets);
  assertNoContradiction(code, itemAllergens(db, propertyCode, code), normalised);
  writeDiets(db, propertyCode, code, normalised);
  return normalised;
}

export function setItemActive(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
  active: boolean,
): MenuItem {
  requireItem(db, propertyCode, code);
  db.prepare('update menu_item set active = ? where property_code = ? and code = ?').run(
    active ? 1 : 0,
    propertyCode,
    code,
  );
  return requireItem(db, propertyCode, code);
}

/** Items carrying none of the given allergens, for building a substitution. */
export function itemsWithoutAllergens(
  db: Database,
  propertyCode: CatalogCode,
  allergens: readonly Allergen[],
  query: ItemQuery = {},
): MenuItem[] {
  if (allergens.length === 0) {
    return listItems(db, propertyCode, query);
  }
  const blocked = new Set(
    db
      .prepare<string[], { item_code: string }>(
        `select distinct item_code from menu_item_allergen
         where property_code = ? and allergen in (${allergens.map(() => '?').join(', ')})`,
      )
      .all(propertyCode, ...allergens)
      .map((row) => row.item_code),
  );
  return listItems(db, propertyCode, query).filter((item) => !blocked.has(item.code));
}
