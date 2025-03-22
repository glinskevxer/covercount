/**
 * A working menu to test against. Every item is a real thing a banquet kitchen
 * sells, and between them they cover the allergen and diet cases the rules
 * downstream have to handle.
 */

import { createItem } from '../../src/catalog/items.js';
import { createPackage } from '../../src/catalog/packages.js';
import { createPriceBook, setPrice } from '../../src/catalog/pricing.js';
import type { Database } from '../../src/store/database.js';
import { CANYON, FIXED_NOW } from './fixtures.js';

export interface SeedItem {
  code: string;
  name: string;
  kind: string;
  course?: string;
  soldBy?: string;
  isUpcharge?: boolean;
  allergens?: string[];
  diets?: string[];
}

export const MENU_ITEMS: SeedItem[] = [
  {
    code: 'CRAB-CAKE',
    name: 'Dungeness crab cake',
    kind: 'FOOD',
    course: 'CANAPE',
    soldBy: 'PIECE',
    allergens: ['SHELLFISH', 'EGG', 'WHEAT'],
  },
  {
    code: 'BEET-TART',
    name: 'Golden beet tartare',
    kind: 'FOOD',
    course: 'STARTER',
    diets: ['VEGETARIAN', 'VEGAN', 'DAIRY-FREE'],
  },
  {
    code: 'CAESAR',
    name: 'Little gem caesar',
    kind: 'FOOD',
    course: 'SALAD',
    allergens: ['MILK', 'EGG', 'FISH', 'WHEAT'],
  },
  {
    code: 'SQUASH-SOUP',
    name: 'Roast squash soup',
    kind: 'FOOD',
    course: 'SOUP',
    allergens: ['MILK'],
    diets: ['VEGETARIAN', 'GLUTEN-FREE'],
  },
  {
    code: 'SHORT-RIB',
    name: 'Braised short rib',
    kind: 'FOOD',
    course: 'MAIN',
    allergens: ['BEEF', 'SULPHITE'],
  },
  {
    code: 'HALIBUT',
    name: 'Roast halibut',
    kind: 'FOOD',
    course: 'MAIN',
    allergens: ['FISH', 'MILK'],
    diets: ['PESCATARIAN'],
  },
  {
    code: 'MUSHROOM-WELL',
    name: 'Mushroom wellington',
    kind: 'FOOD',
    course: 'MAIN',
    allergens: ['WHEAT', 'MILK'],
    diets: ['VEGETARIAN'],
  },
  {
    code: 'ROOT-PLATE',
    name: 'Winter root plate',
    kind: 'FOOD',
    course: 'MAIN',
    diets: ['VEGETARIAN', 'VEGAN', 'GLUTEN-FREE', 'DAIRY-FREE', 'NUT-FREE'],
  },
  {
    code: 'CHOC-TART',
    name: 'Bitter chocolate tart',
    kind: 'FOOD',
    course: 'DESSERT',
    allergens: ['MILK', 'EGG', 'WHEAT'],
  },
  {
    code: 'SORBET',
    name: 'Blood orange sorbet',
    kind: 'FOOD',
    course: 'DESSERT',
    diets: ['VEGETARIAN', 'VEGAN', 'GLUTEN-FREE', 'DAIRY-FREE', 'NUT-FREE'],
  },
  {
    code: 'HOUSE-RED',
    name: 'House red',
    kind: 'BEVERAGE',
    course: 'BEVERAGE',
    soldBy: 'EACH',
    allergens: ['ALCOHOL', 'SULPHITE'],
  },
  {
    code: 'COFFEE',
    name: 'Coffee service',
    kind: 'BEVERAGE',
    course: 'BEVERAGE',
    soldBy: 'GALLON',
  },
  {
    code: 'LOBSTER-UP',
    name: 'Butter poached lobster',
    kind: 'FOOD',
    course: 'MAIN',
    isUpcharge: true,
    allergens: ['SHELLFISH', 'MILK'],
  },
  { code: 'CHAFER', name: 'Chafing dish', kind: 'RENTAL', soldBy: 'EACH' },
  { code: 'SCREEN', name: 'Projection screen', kind: 'AV', soldBy: 'EACH' },
  { code: 'CARVER', name: 'Carving station attendant', kind: 'LABOR', soldBy: 'HOUR' },
];

export function seedMenu(db: Database): void {
  for (const item of MENU_ITEMS) {
    createItem(db, CANYON, item, FIXED_NOW);
  }
}

export function seedPackages(db: Database): void {
  createPackage(
    db,
    CANYON,
    {
      code: 'PLATED-THREE',
      name: 'Three course plated dinner',
      serviceStyle: 'PLATED',
      minCovers: 20,
      courses: [
        { course: 'STARTER', choices: 1, items: ['BEET-TART'] },
        { course: 'MAIN', choices: 1, items: ['SHORT-RIB', 'HALIBUT', 'ROOT-PLATE'] },
        { course: 'DESSERT', choices: 1, items: ['CHOC-TART', 'SORBET'] },
      ],
    },
    FIXED_NOW,
  );
  createPackage(
    db,
    CANYON,
    {
      code: 'RECEPTION-HOUR',
      name: 'One hour canape reception',
      serviceStyle: 'RECEPTION',
      minCovers: 30,
      courses: [{ course: 'CANAPE', choices: 1, required: false, items: ['CRAB-CAKE'] }],
    },
    FIXED_NOW,
  );
}

export function seedPrices(db: Database): void {
  createPriceBook(db, CANYON, { code: 'RACK-2025', name: 'Rack rates 2025' }, FIXED_NOW);
  const lines: [string, string, string, number][] = [
    ['PACKAGE', 'PLATED-THREE', '2025-01-01', 8950],
    ['PACKAGE', 'RECEPTION-HOUR', '2025-01-01', 3200],
    ['ITEM', 'LOBSTER-UP', '2025-01-01', 2400],
    ['ITEM', 'CRAB-CAKE', '2025-01-01', 675],
    ['ITEM', 'HOUSE-RED', '2025-01-01', 4200],
    ['ITEM', 'COFFEE', '2025-01-01', 8500],
    ['ITEM', 'CHAFER', '2025-01-01', 1800],
    ['ITEM', 'SCREEN', '2025-01-01', 22500],
    ['ITEM', 'CARVER', '2025-01-01', 4500],
  ];
  for (const [subjectKind, subjectCode, effectiveFrom, priceMinor] of lines) {
    setPrice(db, CANYON, {
      bookCode: 'RACK-2025',
      subjectKind,
      subjectCode,
      effectiveFrom,
      priceMinor,
    });
  }
}

export function seedFullCatalog(db: Database): void {
  seedMenu(db);
  seedPackages(db);
  seedPrices(db);
}
