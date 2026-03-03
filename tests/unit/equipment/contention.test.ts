import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedFunction, seedPropertyAccountBooking } from '../../support/fixtures.js';
import { seedEquipment } from '../../support/equipment.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { pullFor, savePull } from '../../../src/equipment/store.js';
import {
  contentionFor,
  contentionOn,
  renderContention,
} from '../../../src/equipment/contention.js';
import type { Database } from '../../../src/store/database.js';
import type { FunctionSlot } from '../../../src/booking/types.js';

const DAY = calendarDate('2025-04-18');
const LECTERN = code('LECTERN');

function house(db: Database) {
  const booking = seedPropertyAccountBooking(db);
  seedEquipment(db);
  return booking;
}

/** Pull the rules for a function and save them, which is what the CLI does. */
function pull(db: Database, slot: FunctionSlot): void {
  savePull(db, slot.id, pullFor(db, CANYON, slot.setupStyle, slot.expectedCovers));
}

describe('one item across a day', () => {
  it('reads nothing when nothing is pulled', () => {
    withStore((db) => {
      house(db);
      const found = contentionFor(db, CANYON, DAY, LECTERN);
      expect(found.peak).toBe(0);
      expect(found.shortfall).toBe(0);
      expect(found.atPeak).toEqual([]);
    });
  });

  it('is covered when one function wants less than the house owns', () => {
    withStore((db) => {
      const booking = house(db);
      pull(db, seedFunction(db, booking.id));
      const found = contentionFor(db, CANYON, DAY, LECTERN);
      expect(found.owned).toBe(2);
      expect(found.peak).toBe(1);
      expect(found.shortfall).toBe(0);
    });
  });

  it('adds the demand of two overlapping functions', () => {
    withStore((db) => {
      const booking = house(db);
      pull(db, seedFunction(db, booking.id, { startMinute: 1080, endMinute: 1380 }));
      pull(
        db,
        seedFunction(db, booking.id, {
          spaceCode: 'ASPEN',
          name: 'Breakout Dinner',
          startMinute: 1140,
          endMinute: 1320,
          expectedCovers: 20,
        }),
      );
      const found = contentionFor(db, CANYON, DAY, LECTERN);
      expect(found.peak).toBe(2);
      expect(found.shortfall).toBe(0);
      expect(found.atPeak).toHaveLength(2);
    });
  });

  it('is short when three overlapping functions want more than the house owns', () => {
    withStore((db) => {
      const booking = house(db);
      pull(db, seedFunction(db, booking.id, { startMinute: 1080, endMinute: 1380 }));
      pull(
        db,
        seedFunction(db, booking.id, {
          spaceCode: 'ASPEN',
          name: 'Breakout Dinner',
          startMinute: 1140,
          endMinute: 1320,
          expectedCovers: 20,
        }),
      );
      pull(
        db,
        seedFunction(db, booking.id, {
          spaceCode: 'GRAND-B',
          name: 'Board Dinner',
          startMinute: 1100,
          endMinute: 1300,
          expectedCovers: 16,
        }),
      );
      const found = contentionFor(db, CANYON, DAY, LECTERN);
      expect(found.peak).toBe(3);
      expect(found.owned).toBe(2);
      expect(found.shortfall).toBe(1);
      expect(found.atPeak.map((row) => row.name).sort()).toEqual([
        'Awards Dinner',
        'Board Dinner',
        'Breakout Dinner',
      ]);
    });
  });

  it('does not contend when the two are far enough apart', () => {
    withStore((db) => {
      const booking = house(db);
      pull(
        db,
        seedFunction(db, booking.id, {
          name: 'Morning Plenary',
          startMinute: 360,
          endMinute: 540,
        }),
      );
      pull(db, seedFunction(db, booking.id, { startMinute: 1080, endMinute: 1380 }));
      const found = contentionFor(db, CANYON, DAY, LECTERN);
      expect(found.peak).toBe(1);
      expect(found.shortfall).toBe(0);
    });
  });

  it('prices the shortfall at the rental rate', () => {
    withStore((db) => {
      const booking = house(db);
      const covers: Record<string, number> = { 'GRAND-A': 180, 'GRAND-B': 180, ASPEN: 60 };
      for (const [spaceCode, expectedCovers] of Object.entries(covers)) {
        pull(
          db,
          seedFunction(db, booking.id, {
            spaceCode,
            name: `Dinner in ${spaceCode}`,
            startMinute: 1080,
            endMinute: 1320,
            expectedCovers,
          }),
        );
      }
      // Three hundred and twenty settings on the shelf against four hundred
      // and twenty on the floor at eight o'clock.
      const found = contentionFor(db, CANYON, DAY, code('PLACE-SETTING'));
      expect(found.peak).toBe(420);
      expect(found.owned).toBe(320);
      expect(found.shortfall).toBe(100);
      expect(found.rental.amount).toBe(275);
      expect(found.hireCost.amount).toBe(27_500);
    });
  });
});

describe('the whole day', () => {
  it('lists only what is pulled, shortest first', () => {
    withStore((db) => {
      const booking = house(db);
      pull(db, seedFunction(db, booking.id));
      const day = contentionOn(db, CANYON, DAY);
      expect(day.items.length).toBeGreaterThan(0);
      expect(day.items.every((row) => row.peak > 0)).toBe(true);
      expect(day.short).toEqual([]);
      expect(day.hireCost.amount).toBe(0);
    });
  });

  it('totals the hire cost of everything it is short of', () => {
    withStore((db) => {
      const booking = house(db);
      for (const spaceCode of ['GRAND-A', 'ASPEN', 'GRAND-B']) {
        pull(
          db,
          seedFunction(db, booking.id, {
            spaceCode,
            name: `Dinner in ${spaceCode}`,
            startMinute: 1080,
            endMinute: 1320,
            expectedCovers: 20,
          }),
        );
      }
      const day = contentionOn(db, CANYON, DAY);
      const lectern = day.short.find((row) => row.equipmentCode === 'LECTERN');
      expect(lectern?.shortfall).toBe(1);
      expect(day.hireCost.amount).toBe(
        day.short.reduce((total, row) => total + row.hireCost.amount, 0),
      );
    });
  });
});

describe('printing it', () => {
  it('says so when nothing is pulled', () => {
    withStore((db) => {
      house(db);
      expect(renderContention(contentionOn(db, CANYON, DAY))).toContain('nothing is pulled');
    });
  });

  it('names the functions that are short', () => {
    withStore((db) => {
      const booking = house(db);
      for (const spaceCode of ['GRAND-A', 'ASPEN', 'GRAND-B']) {
        pull(
          db,
          seedFunction(db, booking.id, {
            spaceCode,
            name: `Dinner in ${spaceCode}`,
            startMinute: 1080,
            endMinute: 1320,
            expectedCovers: 20,
          }),
        );
      }
      const text = renderContention(contentionOn(db, CANYON, DAY));
      expect(text).toContain('item(s) short');
      expect(text).toContain('LECTERN');
      expect(text).toContain('Dinner in ASPEN wants 1');
    });
  });
});
