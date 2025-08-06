/**
 * The staffing standards a convention hotel actually publishes.
 */

import { setLabourRate, setStaffingRule } from '../../src/labour/staffing.js';
import { setTemplateStep } from '../../src/timeline/runofshow.js';
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

export function seedTimelineTemplate(db: Database): void {
  const steps = [
    {
      sequence: 1,
      label: 'crew in, room set',
      anchor: 'SETUP',
      offsetMinutes: 0,
      owner: 'HOUSEMAN',
    },
    { sequence: 2, label: 'mise en place', anchor: 'DOORS', offsetMinutes: -180, owner: 'CHEF' },
    {
      sequence: 3,
      label: 'plate up starts',
      anchor: 'SERVICE',
      offsetMinutes: 0,
      perCoverSeconds: 20,
      owner: 'CHEF',
    },
    { sequence: 4, label: 'doors open', anchor: 'DOORS', offsetMinutes: 0, owner: 'CAPTAIN' },
    { sequence: 5, label: 'guests seated', anchor: 'SERVICE', offsetMinutes: 0, owner: 'CAPTAIN' },
    { sequence: 6, label: 'main fired', anchor: 'SERVICE', offsetMinutes: 45, owner: 'CHEF' },
    { sequence: 7, label: 'dessert away', anchor: 'SERVICE', offsetMinutes: 105, owner: 'CHEF' },
    { sequence: 8, label: 'bar closes', anchor: 'CLOSE', offsetMinutes: -30, owner: 'BARTENDER' },
    { sequence: 9, label: 'room struck', anchor: 'TEARDOWN', offsetMinutes: 0, owner: 'HOUSEMAN' },
  ];
  for (const step of steps) {
    setTemplateStep(db, CANYON, { serviceStyle: 'PLATED', ...step });
  }
}
