import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedLabour, seedStaffingRules } from '../../support/labour.js';
import {
  addShift,
  buildRoster,
  listShifts,
  marginalHeadCost,
  removeShift,
  rosterSummary,
  shiftCost,
  shiftWindow,
} from '../../../src/labour/shifts.js';
import { money } from '../../../src/core/money.js';
import type { Database } from '../../../src/store/database.js';

function staffed(db: Database, guarantee = 180) {
  const slot = readyFunction(db, { guarantee });
  seedLabour(db);
  return slot;
}

describe('the block a shift covers', () => {
  it('reaches the lead in before and the lead out after', () => {
    expect(shiftWindow(1080, 1380, 60, 30, 4)).toEqual({ startMinute: 1020, endMinute: 1410 });
  });

  it('stretches the front to reach the minimum call', () => {
    expect(shiftWindow(660, 780, 60, 30, 4)).toEqual({ startMinute: 570, endMinute: 810 });
  });

  it('leaves a long function alone', () => {
    expect(shiftWindow(660, 1380, 60, 30, 4)).toEqual({ startMinute: 600, endMinute: 1410 });
  });

  it('handles a function running past midnight', () => {
    expect(shiftWindow(1200, 1560, 60, 30, 4)).toEqual({ startMinute: 1140, endMinute: 1590 });
  });
});

describe('building a roster', () => {
  it('rosters every role the rules produce', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const shifts = buildRoster(db, slot.id, KITCHEN_NOW);
      expect(shifts.map((row) => row.role).sort()).toEqual(['CAPTAIN', 'HOUSEMAN', 'SERVER']);
    });
  });

  it('counts heads off what the room is set for, not the guarantee', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const server = buildRoster(db, slot.id, KITCHEN_NOW).find((row) => row.role === 'SERVER');
      expect(server?.heads).toBe(12);
    });
  });

  it('takes the block off the function and the rule', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const server = buildRoster(db, slot.id, KITCHEN_NOW).find((row) => row.role === 'SERVER');
      expect(server?.startMinute).toBe(1020);
      expect(server?.endMinute).toBe(1410);
    });
  });

  it('prices each shift off the rate in force on the service date', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const shifts = buildRoster(db, slot.id, KITCHEN_NOW);
      expect(shifts.find((row) => row.role === 'SERVER')?.hourly).toEqual(money(2400, 'USD'));
      expect(shifts.find((row) => row.role === 'CAPTAIN')?.hourly).toEqual(money(3200, 'USD'));
    });
  });

  it('notes a role with no rate rather than refusing the roster', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedStaffingRules(db);
      const shifts = buildRoster(db, slot.id, KITCHEN_NOW);
      expect(shifts.every((row) => row.hourly.amount === 0)).toBe(true);
      expect(shifts[0]?.note).toBe('no rate in force on the service date');
    });
  });

  it('replaces the roster when it is built again', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      buildRoster(db, slot.id, KITCHEN_NOW);
      const second = buildRoster(db, slot.id, KITCHEN_NOW);
      expect(listShifts(db, slot.id)).toHaveLength(second.length);
    });
  });

  it('takes an override cover count', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const shifts = buildRoster(db, slot.id, KITCHEN_NOW, { covers: 32 });
      expect(shifts.find((row) => row.role === 'SERVER')?.heads).toBe(2);
    });
  });

  it('refuses to roster a style with no rules on file', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(() => buildRoster(db, slot.id, KITCHEN_NOW)).toThrow(
        /has no staffing rules for PLATED service/,
      );
    });
  });
});

describe('shifts added by hand', () => {
  it('adds one and prices it off the rate', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const carver = addShift(
        db,
        slot.id,
        { role: 'CARVER', heads: 2, startMinute: 1020, endMinute: 1380, hourlyMinor: 2800 },
        KITCHEN_NOW,
      );
      expect(carver.role).toBe('CARVER');
      expect(carver.heads).toBe(2);
      expect(carver.hourly.amount).toBe(2800);
    });
  });

  it('refuses an unknown role, no heads and a backwards block', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const base = { role: 'CARVER', heads: 1, startMinute: 1020, endMinute: 1380 };
      expect(() => addShift(db, slot.id, { ...base, role: 'SOMMELIER' }, KITCHEN_NOW)).toThrow(
        /not a role this property rosters/,
      );
      expect(() => addShift(db, slot.id, { ...base, heads: 0 }, KITCHEN_NOW)).toThrow(
        /at least one head/,
      );
      expect(() => addShift(db, slot.id, { ...base, endMinute: 900 }, KITCHEN_NOW)).toThrow(
        /end after it starts/,
      );
      expect(() => addShift(db, slot.id, { ...base, hourlyMinor: -1 }, KITCHEN_NOW)).toThrow(
        /whole number of minor units/,
      );
    });
  });

  it('takes one back off', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const carver = addShift(
        db,
        slot.id,
        { role: 'CARVER', heads: 1, startMinute: 1020, endMinute: 1380 },
        KITCHEN_NOW,
      );
      expect(removeShift(db, carver.id)).toBe(true);
      expect(removeShift(db, carver.id)).toBe(false);
    });
  });
});

describe('what the roster costs', () => {
  it('charges head hours at the hourly rate', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const server = buildRoster(db, slot.id, KITCHEN_NOW).find((row) => row.role === 'SERVER');
      expect(shiftCost(server!)).toEqual(money(12 * 390 * 40, 'USD'));
    });
  });

  it('totals the whole roster', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      buildRoster(db, slot.id, KITCHEN_NOW);
      const summary = rosterSummary(db, slot.id);
      expect(summary.heads).toBe(17);
      expect(summary.headHours).toBeCloseTo(110.5, 5);
      expect(summary.cost.amount).toBeGreaterThan(0);
      expect(summary.unpriced).toEqual([]);
    });
  });

  it('names the roles nobody has a rate for', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedStaffingRules(db);
      buildRoster(db, slot.id, KITCHEN_NOW);
      expect(rosterSummary(db, slot.id).unpriced.sort()).toEqual(['CAPTAIN', 'HOUSEMAN', 'SERVER']);
    });
  });

  it('prices one more head of a role', () => {
    withStore((db) => {
      const slot = staffed(db, 180);
      const server = buildRoster(db, slot.id, KITCHEN_NOW).find((row) => row.role === 'SERVER');
      expect(marginalHeadCost(server!)).toEqual(money(390 * 40, 'USD'));
    });
  });
});
