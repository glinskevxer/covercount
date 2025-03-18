/**
 * A working menu to test against. Every item is a real thing a banquet kitchen
 * sells, and between them they cover the allergen and diet cases the rules
 * downstream have to handle.
 */

import { createItem } from '../../src/catalog/items.js';
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
