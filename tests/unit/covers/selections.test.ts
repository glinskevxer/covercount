import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { seedFunction, seedPropertyAccountBooking } from '../../support/fixtures.js';
import { seedFullCatalog } from '../../support/menu.js';
import { openCovers, setGuarantee } from '../../../src/covers/guarantee.js';
import { addSpecialMeal } from '../../../src/covers/special.js';
import {
  assertSplitsAddUp,
  clearSelections,
  listSelections,
  plateCounts,
  selectionsForCourse,
  setCourseSplit,
  splitProblems,
  splitsAddUp,
} from '../../../src/covers/selections.js';
import type { Database } from '../../../src/store/database.js';

const BEFORE = '2025-04-10T09:00:00.000Z';

function plated(db: Database, guarantee = 180) {
  const booking = seedPropertyAccountBooking(db);
  seedFullCatalog(db);
  const slot = seedFunction(db, booking.id);
  openCovers(db, slot.id, { packageCode: 'PLATED-THREE', contractDate: '2025-01-20' });
  setGuarantee(db, slot.id, guarantee, BEFORE);
  return slot;
}

describe('setting a split', () => {
  it('records the covers per item in a course', () => {
    withStore((db) => {
      const slot = plated(db);
      const split = setCourseSplit(db, slot.id, 'MAIN', [
        { itemCode: 'SHORT-RIB', covers: 110 },
        { itemCode: 'HALIBUT', covers: 50 },
        { itemCode: 'ROOT-PLATE', covers: 20 },
      ]);
      expect(split.map((row) => [row.itemCode, row.covers])).toEqual([
        ['HALIBUT', 50],
        ['ROOT-PLATE', 20],
        ['SHORT-RIB', 110],
      ]);
    });
  });

  it('replaces the whole course rather than adding to it', () => {
    withStore((db) => {
      const slot = plated(db);
      setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 180 }]);
      setCourseSplit(db, slot.id, 'MAIN', [
        { itemCode: 'HALIBUT', covers: 90 },
        { itemCode: 'SHORT-RIB', covers: 90 },
      ]);
      expect(selectionsForCourse(db, slot.id, 'MAIN')).toHaveLength(2);
    });
  });

  it('drops an item that was given zero covers', () => {
    withStore((db) => {
      const slot = plated(db);
      setCourseSplit(db, slot.id, 'MAIN', [
        { itemCode: 'SHORT-RIB', covers: 180 },
        { itemCode: 'HALIBUT', covers: 0 },
      ]);
      expect(selectionsForCourse(db, slot.id, 'MAIN').map((row) => row.itemCode)).toEqual([
        'SHORT-RIB',
      ]);
    });
  });

  it('refuses an item the package does not offer in that course', () => {
    withStore((db) => {
      const slot = plated(db);
      expect(() =>
        setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'MUSHROOM-WELL', covers: 180 }]),
      ).toThrow(/is not offered in the MAIN course/);
    });
  });

  it('refuses a course the package does not carry and one that is not a course', () => {
    withStore((db) => {
      const slot = plated(db);
      expect(() => setCourseSplit(db, slot.id, 'SOUP', [])).toThrow(/carries no SOUP course/);
      expect(() => setCourseSplit(db, slot.id, 'AMUSE', [])).toThrow(/is not a course/);
    });
  });

  it('refuses the same item twice and a count that is not whole', () => {
    withStore((db) => {
      const slot = plated(db);
      expect(() =>
        setCourseSplit(db, slot.id, 'MAIN', [
          { itemCode: 'SHORT-RIB', covers: 90 },
          { itemCode: 'short-rib', covers: 90 },
        ]),
      ).toThrow(/appears twice in the MAIN split/);
      expect(() =>
        setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 1.5 }]),
      ).toThrow(/whole count of covers/);
    });
  });

  it('refuses a split on a function with no package on it', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFullCatalog(db);
      const slot = seedFunction(db, booking.id);
      openCovers(db, slot.id, { contractDate: '2025-01-20' });
      setGuarantee(db, slot.id, 100, BEFORE);
      expect(() => setCourseSplit(db, slot.id, 'MAIN', [])).toThrow(/has no package on it/);
      expect(splitProblems(db, slot.id)).toEqual([]);
    });
  });
});

describe('the split has to add up to the standard covers', () => {
  it('is happy when every required course is covered', () => {
    withStore((db) => {
      const slot = plated(db, 180);
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 180 }]);
      setCourseSplit(db, slot.id, 'MAIN', [
        { itemCode: 'SHORT-RIB', covers: 110 },
        { itemCode: 'HALIBUT', covers: 50 },
        { itemCode: 'ROOT-PLATE', covers: 20 },
      ]);
      setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'CHOC-TART', covers: 180 }]);
      expect(splitProblems(db, slot.id)).toEqual([]);
      expect(splitsAddUp(db, slot.id)).toBe(true);
      expect(() => assertSplitsAddUp(db, slot.id)).not.toThrow();
    });
  });

  it('names a course that has been left short', () => {
    withStore((db) => {
      const slot = plated(db, 180);
      setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 170 }]);
      const main = splitProblems(db, slot.id).find((row) => row.course === 'MAIN');
      expect(main).toEqual({ course: 'MAIN', expected: 180, chosen: 170, required: true });
      expect(splitsAddUp(db, slot.id)).toBe(false);
      expect(() => assertSplitsAddUp(db, slot.id)).toThrow(
        /the STARTER split on .* adds to 0 against 180 standard covers/,
      );
    });
  });

  it('names a course that has been counted twice', () => {
    withStore((db) => {
      const slot = plated(db, 180);
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 180 }]);
      setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'SORBET', covers: 180 }]);
      setCourseSplit(db, slot.id, 'MAIN', [
        { itemCode: 'SHORT-RIB', covers: 120 },
        { itemCode: 'HALIBUT', covers: 90 },
      ]);
      expect(splitProblems(db, slot.id)).toEqual([
        { course: 'MAIN', expected: 180, chosen: 210, required: true },
      ]);
    });
  });

  it('takes the special meals out of the count the split has to reach', () => {
    withStore((db) => {
      const slot = plated(db, 180);
      addSpecialMeal(
        db,
        slot.id,
        { diet: 'VEGAN', covers: 12, substituteItemCode: 'ROOT-PLATE' },
        BEFORE,
      );
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 168 }]);
      setCourseSplit(db, slot.id, 'MAIN', [
        { itemCode: 'SHORT-RIB', covers: 110 },
        { itemCode: 'HALIBUT', covers: 58 },
      ]);
      setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'CHOC-TART', covers: 168 }]);
      expect(splitProblems(db, slot.id)).toEqual([]);
    });
  });

  it('turns a split that used to add up into one that does not when a special is added', () => {
    withStore((db) => {
      const slot = plated(db, 180);
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 180 }]);
      setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 180 }]);
      setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'SORBET', covers: 180 }]);
      expect(splitsAddUp(db, slot.id)).toBe(true);
      addSpecialMeal(db, slot.id, { diet: 'VEGAN', covers: 6 }, BEFORE);
      expect(splitsAddUp(db, slot.id)).toBe(false);
      expect(splitProblems(db, slot.id)).toHaveLength(3);
    });
  });

  it('expects a course with two choices to be split twice over', () => {
    withStore((db) => {
      const slot = plated(db, 10);
      const problem = splitProblems(db, slot.id).find((row) => row.course === 'MAIN');
      expect(problem?.expected).toBe(10);
    });
  });

  it('ignores an optional course nobody has started splitting', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFullCatalog(db);
      const slot = seedFunction(db, booking.id, {
        serviceStyle: 'RECEPTION',
        setupStyle: 'RECEPTION',
        expectedCovers: 200,
      });
      openCovers(db, slot.id, { packageCode: 'RECEPTION-HOUR', contractDate: '2025-01-20' });
      setGuarantee(db, slot.id, 200, BEFORE);
      expect(splitProblems(db, slot.id)).toEqual([]);
      setCourseSplit(db, slot.id, 'CANAPE', [{ itemCode: 'CRAB-CAKE', covers: 150 }]);
      expect(splitProblems(db, slot.id)).toEqual([
        { course: 'CANAPE', expected: 200, chosen: 150, required: false },
      ]);
    });
  });
});

describe('the plate count the kitchen works from', () => {
  it('totals per item across every course', () => {
    withStore((db) => {
      const slot = plated(db, 180);
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 180 }]);
      setCourseSplit(db, slot.id, 'MAIN', [
        { itemCode: 'SHORT-RIB', covers: 110 },
        { itemCode: 'HALIBUT', covers: 70 },
      ]);
      expect(plateCounts(db, slot.id)).toEqual([
        { course: 'MAIN', itemCode: 'HALIBUT', plates: 110 - 40 },
        { course: 'MAIN', itemCode: 'SHORT-RIB', plates: 110 },
        { course: 'STARTER', itemCode: 'BEET-TART', plates: 180 },
      ]);
    });
  });

  it('is empty before anything is split', () => {
    withStore((db) => {
      const slot = plated(db, 180);
      expect(plateCounts(db, slot.id)).toEqual([]);
      expect(listSelections(db, slot.id)).toEqual([]);
    });
  });

  it('clears every split at once', () => {
    withStore((db) => {
      const slot = plated(db, 180);
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 180 }]);
      setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 180 }]);
      expect(clearSelections(db, slot.id)).toBe(2);
      expect(listSelections(db, slot.id)).toEqual([]);
    });
  });
});
