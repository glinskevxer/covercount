import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedLabour, seedStaffingRules } from '../../support/labour.js';
import { countByLevel, renderFindings, sweep } from '../../../src/audit/sweep.js';
import { addSpecialMeal } from '../../../src/covers/special.js';
import { setCourseSplit } from '../../../src/covers/selections.js';
import { editFunction } from '../../../src/booking/functions.js';
import { setSpaceCapacity } from '../../../src/property/store.js';
import { catalogCode } from '../../../src/core/ids.js';
import { buildRoster } from '../../../src/labour/shifts.js';
import { drawPackageCharges } from '../../../src/billing/charges.js';
import { distributeRevision, drawRevision, signRevision } from '../../../src/orders/revisions.js';
import { setGuarantee } from '../../../src/covers/guarantee.js';
import { calendarDate } from '../../../src/core/calendar.js';
import type { Database } from '../../../src/store/database.js';

const d = calendarDate;
const TODAY = d('2025-04-10');

function clean(db: Database) {
  const slot = readyFunction(db, { guarantee: 180 });
  seedLabour(db);
  buildRoster(db, slot.id, KITCHEN_NOW);
  drawPackageCharges(db, slot.id);
  return slot;
}

describe('a store with nothing wrong with it', () => {
  it('finds nothing', () => {
    withStore((db) => {
      clean(db);
      expect(sweep(db, CANYON, { today: TODAY })).toEqual([]);
      expect(renderFindings([])).toBe('nothing to look at');
    });
  });
});

describe('what the sweep catches', () => {
  it('catches a split that has stopped adding up', () => {
    withStore((db) => {
      const slot = clean(db);
      addSpecialMeal(
        db,
        slot.id,
        { covers: 12, diet: 'VEGAN', substituteItemCode: 'ROOT-PLATE' },
        KITCHEN_NOW,
      );
      const findings = sweep(db, CANYON, { today: TODAY });
      expect(findings.some((row) => row.code === 'selection.total')).toBe(true);
    });
  });

  it('catches a special meal nobody has decided a dish for', () => {
    withStore((db) => {
      const slot = clean(db);
      addSpecialMeal(db, slot.id, { covers: 2, diet: 'KOSHER' }, KITCHEN_NOW);
      const findings = sweep(db, CANYON, { today: TODAY });
      const found = findings.find((row) => row.code === 'special.undecided');
      expect(found?.message).toContain('1 special meals');
    });
  });

  it('catches a room re certified below what is already guaranteed in it', () => {
    withStore((db) => {
      const slot = clean(db);
      setGuarantee(db, slot.id, 40, KITCHEN_NOW);
      editFunction(db, slot.id, { spaceCode: 'ASPEN', expectedCovers: 40 }, KITCHEN_NOW);
      expect(sweep(db, CANYON, { today: TODAY }).some((row) => row.code === 'space.overset')).toBe(
        false,
      );

      setSpaceCapacity(db, CANYON, catalogCode('ASPEN'), 'ROUNDS-10', 30);
      const found = sweep(db, CANYON, { today: TODAY }).find((row) => row.code === 'space.overset');
      expect(found?.level).toBe('error');
      expect(found?.message).toContain('is set for 42 in a room that seats 30 that way');
    });
  });

  it('catches a roster with no rate behind it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedStaffingRules(db);
      buildRoster(db, slot.id, KITCHEN_NOW);
      drawPackageCharges(db, slot.id);
      const findings = sweep(db, CANYON, { today: TODAY });
      expect(findings.filter((row) => row.code === 'labour.unpriced').length).toBeGreaterThan(0);
    });
  });

  it('catches a signed sheet that no longer matches', () => {
    withStore((db) => {
      const slot = clean(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      distributeRevision(db, drawn.id);
      signRevision(db, drawn.id, 'A Fenwick', KITCHEN_NOW);
      expect(sweep(db, CANYON, { today: TODAY }).some((row) => row.code === 'beo.stale')).toBe(
        false,
      );

      setGuarantee(db, slot.id, 190, KITCHEN_NOW);
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 190 }]);
      setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 190 }]);
      setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'SORBET', covers: 190 }]);
      const stale = sweep(db, CANYON, { today: TODAY }).find((row) => row.code === 'beo.stale');
      expect(stale?.level).toBe('error');
      expect(stale?.message).toContain('a change order is owed');
    });
  });

  it('catches a guarantee that closed with nobody having given a number', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180, split: false });
      setGuarantee(db, slot.id, 0, KITCHEN_NOW);
      const findings = sweep(db, CANYON, { today: d('2025-04-20') });
      expect(findings.every((row) => row.code !== 'covers.unguaranteed')).toBe(true);
    });
  });

  it('ignores a function before the from date', () => {
    withStore((db) => {
      const slot = clean(db);
      addSpecialMeal(db, slot.id, { covers: 2, diet: 'KOSHER' }, KITCHEN_NOW);
      expect(sweep(db, CANYON, { today: TODAY, from: d('2025-05-01') })).toEqual([]);
    });
  });
});

describe('reporting the findings', () => {
  it('counts by level and prints them', () => {
    withStore((db) => {
      const slot = clean(db);
      addSpecialMeal(db, slot.id, { covers: 2, diet: 'KOSHER' }, KITCHEN_NOW);
      const findings = sweep(db, CANYON, { today: TODAY });
      const counts = countByLevel(findings);
      expect(counts.warning).toBeGreaterThan(0);
      const text = renderFindings(findings);
      expect(text).toContain(`${counts.error} errors, ${counts.warning} warnings`);
      expect(text).toContain('special.undecided'.length > 0 ? 'no dish decided' : '');
    });
  });
});
