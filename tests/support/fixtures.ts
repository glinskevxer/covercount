/**
 * A property to hang tests off. It is a real convention hotel shape rather
 * than one room, because most of the rules that matter only appear when two
 * rooms combine or a function moves between them.
 */

import { catalogCode, type CatalogCode } from '../../src/core/ids.js';
import { createProperty, addSpace } from '../../src/property/store.js';
import { defineCombination } from '../../src/property/combinations.js';
import type { Database } from '../../src/store/database.js';
import type { Property } from '../../src/property/types.js';

export const CANYON: CatalogCode = catalogCode('CANYON');

export const FIXED_NOW = '2025-01-06T09:00:00.000Z';

export function seedProperty(
  db: Database,
  overrides: Partial<Parameters<typeof createProperty>[1]> = {},
): Property {
  return createProperty(
    db,
    {
      code: 'CANYON',
      name: 'Canyon Ridge Hotel',
      timeZone: 'America/Denver',
      currency: 'USD',
      guaranteeLeadDays: 3,
      guaranteeDueMinute: 720,
      oversetPpm: 50_000,
      oversetCap: 25,
      ...overrides,
    },
    FIXED_NOW,
  );
}

export function seedSpaces(db: Database): void {
  addSpace(db, CANYON, {
    code: 'GRAND-A',
    name: 'Grand Ballroom A',
    floor: 'Lobby',
    areaSqFt: 3200,
    fireCapacity: 350,
    setupMinutes: 120,
    teardownMinutes: 60,
    capacities: [
      { setupStyle: 'ROUNDS-10', capacity: 200 },
      { setupStyle: 'THEATER', capacity: 300 },
      { setupStyle: 'RECEPTION', capacity: 350 },
    ],
  });
  addSpace(db, CANYON, {
    code: 'GRAND-B',
    name: 'Grand Ballroom B',
    floor: 'Lobby',
    areaSqFt: 3200,
    fireCapacity: 350,
    setupMinutes: 120,
    teardownMinutes: 60,
    capacities: [
      { setupStyle: 'ROUNDS-10', capacity: 200 },
      { setupStyle: 'THEATER', capacity: 300 },
    ],
  });
  addSpace(db, CANYON, {
    code: 'ASPEN',
    name: 'Aspen Room',
    floor: 'Second',
    areaSqFt: 900,
    fireCapacity: 80,
    setupMinutes: 45,
    teardownMinutes: 30,
    capacities: [
      { setupStyle: 'ROUNDS-10', capacity: 60 },
      { setupStyle: 'U-SHAPE', capacity: 28 },
      { setupStyle: 'BOARDROOM', capacity: 20 },
    ],
  });
}

export function seedPropertyWithSpaces(db: Database): Property {
  const property = seedProperty(db);
  seedSpaces(db);
  return property;
}

export function seedCombination(db: Database): void {
  defineCombination(db, CANYON, {
    code: 'GRAND',
    name: 'Grand Ballroom',
    components: ['GRAND-A', 'GRAND-B'],
  });
}

export function seedFullProperty(db: Database): Property {
  const property = seedPropertyWithSpaces(db);
  seedCombination(db);
  return property;
}
