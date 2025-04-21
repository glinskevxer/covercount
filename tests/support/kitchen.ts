/**
 * A kitchen with enough of a larder to explode a real menu against.
 */

import { createIngredient } from '../../src/production/ingredients.js';
import { createRecipe } from '../../src/production/recipes.js';
import type { Database } from '../../src/store/database.js';
import { CANYON, FIXED_NOW } from './fixtures.js';

export const INGREDIENTS = [
  {
    code: 'SHORT-RIB',
    name: 'Beef short rib, bone in',
    store: 'BUTCHER',
    purchaseUnit: 'LB',
    packSize: 40,
  },
  { code: 'MIREPOIX', name: 'Mirepoix mix', store: 'PRODUCE', purchaseUnit: 'LB', packSize: 10 },
  { code: 'RED-WINE', name: 'Cooking red', store: 'CELLAR', purchaseUnit: 'GAL', packSize: 3 },
  { code: 'VEAL-STOCK', name: 'Veal stock', store: 'FREEZE', purchaseUnit: 'QT', packSize: 4 },
  { code: 'ROOT-VEG', name: 'Winter root mix', store: 'PRODUCE', purchaseUnit: 'LB', packSize: 25 },
  { code: 'OLIVE-OIL', name: 'Olive oil', store: 'DRY', purchaseUnit: 'L', packSize: 5 },
  {
    code: 'BLOOD-ORANGE',
    name: 'Blood orange',
    store: 'PRODUCE',
    purchaseUnit: 'EA',
    packSize: 48,
  },
  { code: 'SUGAR', name: 'Caster sugar', store: 'DRY', purchaseUnit: 'LB', packSize: 25 },
  { code: 'BEETROOT', name: 'Golden beetroot', store: 'PRODUCE', purchaseUnit: 'LB', packSize: 20 },
];

export function seedLarder(db: Database): void {
  for (const ingredient of INGREDIENTS) {
    createIngredient(db, CANYON, ingredient, FIXED_NOW);
  }
}

export function seedRecipes(db: Database): void {
  createRecipe(
    db,
    CANYON,
    {
      code: 'BRAISED-SHORT-RIB',
      name: 'Braised short rib',
      itemCode: 'SHORT-RIB',
      batchPortions: 20,
      station: 'ROAST',
      method: 'sear, braise four hours, rest, portion',
      lines: [
        { ingredientCode: 'SHORT-RIB', quantity: 16, unit: 'LB', yieldPercent: 65 },
        { ingredientCode: 'MIREPOIX', quantity: 4, unit: 'LB', yieldPercent: 85 },
        { ingredientCode: 'RED-WINE', quantity: 3, unit: 'QT' },
        { ingredientCode: 'VEAL-STOCK', quantity: 5, unit: 'QT' },
      ],
    },
    FIXED_NOW,
  );
  createRecipe(
    db,
    CANYON,
    {
      code: 'WINTER-ROOT-PLATE',
      name: 'Winter root plate',
      itemCode: 'ROOT-PLATE',
      batchPortions: 12,
      station: 'GARDE-MANGER',
      lines: [
        { ingredientCode: 'ROOT-VEG', quantity: 9, unit: 'LB', yieldPercent: 80 },
        { ingredientCode: 'OLIVE-OIL', quantity: 500, unit: 'ML' },
      ],
    },
    FIXED_NOW,
  );
  createRecipe(
    db,
    CANYON,
    {
      code: 'BLOOD-ORANGE-SORBET',
      name: 'Blood orange sorbet',
      itemCode: 'SORBET',
      batchPortions: 30,
      station: 'PASTRY',
      lines: [
        { ingredientCode: 'BLOOD-ORANGE', quantity: 24, unit: 'EA', yieldPercent: 45 },
        { ingredientCode: 'SUGAR', quantity: 3, unit: 'LB' },
      ],
    },
    FIXED_NOW,
  );
  createRecipe(
    db,
    CANYON,
    {
      code: 'BEET-TARTARE',
      name: 'Golden beet tartare',
      itemCode: 'BEET-TART',
      batchPortions: 16,
      station: 'GARDE-MANGER',
      lines: [
        { ingredientCode: 'BEETROOT', quantity: 6, unit: 'LB', yieldPercent: 70 },
        { ingredientCode: 'OLIVE-OIL', quantity: 250, unit: 'ML' },
      ],
    },
    FIXED_NOW,
  );
}

export function seedKitchen(db: Database): void {
  seedLarder(db);
  seedRecipes(db);
}
