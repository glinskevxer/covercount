/**
 * The staffing standards a convention hotel actually publishes.
 */

import { setLabourRate, setStaffingRule } from '../../src/labour/staffing.js';
import type { Database } from '../../src/store/database.js';
import { CANYON } from './fixtures.js';

export function seedStaffingRules(db: Database): void {
  setStaffingRule(db, CANYON, {
    serviceStyle: 'PLATED',
    role: 'SERVER',
    coversPerHead: 16,
    minimumHeads: 2,
  });
  setStaffingRule(db, CANYON, {
    serviceStyle: 'PLATED',
    role: 'CAPTAIN',
    coversPerHead: 5,
    minimumHeads: 1,
  });
  setStaffingRule(db, CANYON, {
    serviceStyle: 'PLATED',
    role: 'HOUSEMAN',
    coversPerHead: 100,
    minimumHeads: 1,
  });
  setStaffingRule(db, CANYON, {
    serviceStyle: 'BUFFET',
    role: 'SERVER',
    coversPerHead: 30,
    minimumHeads: 2,
  });
  setStaffingRule(db, CANYON, {
    serviceStyle: 'BUFFET',
    role: 'CAPTAIN',
    coversPerHead: 5,
    minimumHeads: 1,
  });
  setStaffingRule(db, CANYON, {
    serviceStyle: 'RECEPTION',
    role: 'BARTENDER',
    coversPerHead: 75,
    minimumHeads: 1,
  });
  setStaffingRule(db, CANYON, {
    serviceStyle: 'RECEPTION',
    role: 'SERVER',
    coversPerHead: 50,
    minimumHeads: 2,
  });
}

export function seedLabourRates(db: Database): void {
  setLabourRate(db, CANYON, 'SERVER', '2025-01-01', 2400);
  setLabourRate(db, CANYON, 'CAPTAIN', '2025-01-01', 3200);
  setLabourRate(db, CANYON, 'HOUSEMAN', '2025-01-01', 2100);
  setLabourRate(db, CANYON, 'BARTENDER', '2025-01-01', 2900);
}

export function seedLabour(db: Database): void {
  seedStaffingRules(db);
  seedLabourRates(db);
}
