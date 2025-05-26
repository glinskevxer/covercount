import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedProperty } from '../../support/fixtures.js';
import { seedLabour, seedStaffingRules } from '../../support/labour.js';
import {
  findLabourRate,
  findStaffingRule,
  headCounts,
  labourRateHistory,
  listStaffingRules,
  rateChangesBefore,
  requireLabourRate,
  requireStaffingRule,
  setLabourRate,
  setStaffingRule,
} from '../../../src/labour/staffing.js';
import {
  ROLES,
  isKitchenRole,
  isRole,
  isSupervisory,
  shiftHeadHours,
  shiftMinutes,
} from '../../../src/labour/types.js';
import { calendarDate } from '../../../src/core/calendar.js';

const d = calendarDate;

describe('the role vocabulary', () => {
  it('recognises a role and picks out the supervisory ones', () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
    expect(isRole('SOMMELIER')).toBe(false);
    expect(isSupervisory('CAPTAIN')).toBe(true);
    expect(isSupervisory('SERVER')).toBe(false);
  });

  it('separates the kitchen roles from the dining room', () => {
    expect(isKitchenRole('CHEF')).toBe(true);
    expect(isKitchenRole('CARVER')).toBe(true);
    expect(isKitchenRole('SERVER')).toBe(false);
    expect(isKitchenRole('BARTENDER')).toBe(false);
  });

  it('measures a shift and its head hours', () => {
    expect(shiftMinutes({ startMinute: 1020, endMinute: 1440 })).toBe(420);
    expect(shiftHeadHours({ startMinute: 1020, endMinute: 1440, heads: 12 })).toBe(84);
  });
});

describe('staffing rules', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      seedProperty(db);
      const rule = setStaffingRule(db, CANYON, {
        serviceStyle: 'plated',
        role: 'server',
        coversPerHead: 16,
        minimumHeads: 2,
        minimumHours: 5,
        leadInMinutes: 90,
      });
      expect(rule.serviceStyle).toBe('PLATED');
      expect(rule.role).toBe('SERVER');
      expect(rule.coversPerHead).toBe(16);
      expect(rule.minimumHeads).toBe(2);
      expect(rule.minimumHours).toBe(5);
      expect(rule.leadInMinutes).toBe(90);
      expect(rule.leadOutMinutes).toBe(30);
    });
  });

  it('replaces a rule set twice', () => {
    withStore((db) => {
      seedProperty(db);
      setStaffingRule(db, CANYON, { serviceStyle: 'PLATED', role: 'SERVER', coversPerHead: 16 });
      setStaffingRule(db, CANYON, { serviceStyle: 'PLATED', role: 'SERVER', coversPerHead: 20 });
      expect(requireStaffingRule(db, CANYON, 'PLATED', 'SERVER').coversPerHead).toBe(20);
      expect(listStaffingRules(db, CANYON, 'PLATED')).toHaveLength(1);
    });
  });

  it('refuses an unknown style, role or ratio', () => {
    withStore((db) => {
      seedProperty(db);
      const base = { serviceStyle: 'PLATED', role: 'SERVER', coversPerHead: 16 };
      expect(() => setStaffingRule(db, CANYON, { ...base, serviceStyle: 'TAPAS' })).toThrow(
        /not a service style/,
      );
      expect(() => setStaffingRule(db, CANYON, { ...base, role: 'SOMMELIER' })).toThrow(
        /not a role this property rosters/,
      );
      expect(() => setStaffingRule(db, CANYON, { ...base, coversPerHead: 0 })).toThrow(
        /one head per a whole number of covers/,
      );
      expect(() => setStaffingRule(db, CANYON, { ...base, minimumHours: 0 })).toThrow(
        /at least one whole hour/,
      );
    });
  });

  it('answers for a rule that is not on file', () => {
    withStore((db) => {
      seedProperty(db);
      expect(findStaffingRule(db, CANYON, 'PLATED', 'SERVER')).toBeUndefined();
      expect(() => requireStaffingRule(db, CANYON, 'PLATED', 'SERVER')).toThrow(
        /has no SERVER rule for PLATED service/,
      );
      expect(listStaffingRules(db, CANYON)).toEqual([]);
    });
  });
});

describe('head counts off a cover count', () => {
  it('divides the covers and rounds up', () => {
    withStore((db) => {
      seedProperty(db);
      seedStaffingRules(db);
      const counts = headCounts(db, CANYON, 'PLATED', 180);
      const server = counts.find((row) => row.role === 'SERVER');
      expect(server?.heads).toBe(12);
      const houseman = counts.find((row) => row.role === 'HOUSEMAN');
      expect(houseman?.heads).toBe(2);
    });
  });

  it('counts a captain off the servers rather than off the covers', () => {
    withStore((db) => {
      seedProperty(db);
      seedStaffingRules(db);
      const captain = headCounts(db, CANYON, 'PLATED', 180).find((row) => row.role === 'CAPTAIN');
      expect(captain?.heads).toBe(3);
    });
  });

  it('adds a captain when the guarantee pushes the server count over a boundary', () => {
    withStore((db) => {
      seedProperty(db);
      seedStaffingRules(db);
      const at160 = headCounts(db, CANYON, 'PLATED', 160);
      expect(at160.find((row) => row.role === 'SERVER')?.heads).toBe(10);
      expect(at160.find((row) => row.role === 'CAPTAIN')?.heads).toBe(2);
      const at176 = headCounts(db, CANYON, 'PLATED', 176);
      expect(at176.find((row) => row.role === 'SERVER')?.heads).toBe(11);
      expect(at176.find((row) => row.role === 'CAPTAIN')?.heads).toBe(3);
    });
  });

  it('floors at the minimum head count for a small function', () => {
    withStore((db) => {
      seedProperty(db);
      seedStaffingRules(db);
      const counts = headCounts(db, CANYON, 'PLATED', 10);
      expect(counts.find((row) => row.role === 'SERVER')?.heads).toBe(2);
      expect(counts.find((row) => row.role === 'HOUSEMAN')?.heads).toBe(1);
    });
  });

  it('calls nobody in for no covers at all', () => {
    withStore((db) => {
      seedProperty(db);
      seedStaffingRules(db);
      expect(headCounts(db, CANYON, 'PLATED', 0).every((row) => row.heads === 0)).toBe(true);
    });
  });

  it('uses a different ratio for a different service style', () => {
    withStore((db) => {
      seedProperty(db);
      seedStaffingRules(db);
      expect(headCounts(db, CANYON, 'BUFFET', 180).find((r) => r.role === 'SERVER')?.heads).toBe(6);
      expect(
        headCounts(db, CANYON, 'RECEPTION', 180).find((r) => r.role === 'BARTENDER')?.heads,
      ).toBe(3);
    });
  });

  it('is empty for a style with no rules on file', () => {
    withStore((db) => {
      seedProperty(db);
      seedStaffingRules(db);
      expect(headCounts(db, CANYON, 'BOXED', 180)).toEqual([]);
    });
  });

  it('refuses a cover count that is not a whole number', () => {
    withStore((db) => {
      seedProperty(db);
      seedStaffingRules(db);
      expect(() => headCounts(db, CANYON, 'PLATED', 1.5)).toThrow(/whole number/);
    });
  });
});

describe('labour rates', () => {
  it('takes the rate in force on the service date', () => {
    withStore((db) => {
      seedProperty(db);
      seedLabour(db);
      setLabourRate(db, CANYON, 'SERVER', '2025-07-01', 2600);
      expect(requireLabourRate(db, CANYON, 'SERVER', d('2025-06-30')).amount).toBe(2400);
      expect(requireLabourRate(db, CANYON, 'SERVER', d('2025-07-01')).amount).toBe(2600);
    });
  });

  it('has no rate before the first one and answers for a role with none', () => {
    withStore((db) => {
      seedProperty(db);
      seedLabour(db);
      expect(findLabourRate(db, CANYON, 'SERVER', d('2024-12-31'))).toBeUndefined();
      expect(() => requireLabourRate(db, CANYON, 'COOK', d('2025-04-18'))).toThrow(
        /has no COOK rate in force/,
      );
    });
  });

  it('lists a history and reports which changes land before a function', () => {
    withStore((db) => {
      seedProperty(db);
      seedLabour(db);
      setLabourRate(db, CANYON, 'SERVER', '2025-07-01', 2600);
      const history = labourRateHistory(db, CANYON, 'SERVER');
      expect(history.map((row) => row.hourly.amount)).toEqual([2400, 2600]);
      expect(rateChangesBefore(history, d('2025-04-18'))).toHaveLength(1);
      expect(rateChangesBefore(history, d('2025-08-18'))).toHaveLength(2);
    });
  });

  it('refuses an unknown role and a rate that is not a whole amount', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => setLabourRate(db, CANYON, 'SOMMELIER', '2025-01-01', 2400)).toThrow(
        /not a role this property rosters/,
      );
      expect(() => setLabourRate(db, CANYON, 'SERVER', '2025-01-01', -1)).toThrow(
        /whole number of minor units/,
      );
      expect(() => setLabourRate(db, CANYON, 'SERVER', '2025-01-01', 1.5)).toThrow(
        /whole number of minor units/,
      );
    });
  });
});
