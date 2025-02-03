import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedFunction, seedPropertyAccountBooking } from '../../support/fixtures.js';
import {
  absoluteMinute,
  assertNoClash,
  findClashes,
  functionsOnDate,
  occupiedWindow,
  windowsOverlap,
} from '../../../src/booking/diary.js';
import { editFunction, setFunctionStatus } from '../../../src/booking/functions.js';
import { catalogCode } from '../../../src/core/ids.js';
import { calendarDate } from '../../../src/core/calendar.js';

const LATER = '2025-02-02T09:00:00.000Z';
const d = calendarDate;

describe('the absolute minute line', () => {
  it('runs continuously across a date boundary', () => {
    expect(absoluteMinute(d('2025-04-19'), 0) - absoluteMinute(d('2025-04-18'), 0)).toBe(1440);
    expect(absoluteMinute(d('2025-04-18'), 1500)).toBe(absoluteMinute(d('2025-04-19'), 60));
  });

  it('overlaps two half open windows', () => {
    expect(windowsOverlap({ from: 0, to: 10 }, { from: 5, to: 15 })).toBe(true);
    expect(windowsOverlap({ from: 0, to: 10 }, { from: 10, to: 20 })).toBe(false);
    expect(windowsOverlap({ from: 10, to: 20 }, { from: 0, to: 10 })).toBe(false);
    expect(windowsOverlap({ from: 0, to: 100 }, { from: 40, to: 50 })).toBe(true);
  });
});

describe('the window a function occupies', () => {
  it('reaches back over the setup and forward over the teardown', () => {
    withStore((db) => {
      seedPropertyAccountBooking(db);
      const window = occupiedWindow(db, {
        propertyCode: CANYON,
        spaceCode: catalogCode('GRAND-A'),
        serviceDate: d('2025-04-18'),
        startMinute: 1080,
        endMinute: 1380,
      });
      expect(window.from).toBe(absoluteMinute(d('2025-04-18'), 1080 - 120));
      expect(window.to).toBe(absoluteMinute(d('2025-04-18'), 1380 + 60));
    });
  });
});

describe('finding a clash', () => {
  it('finds none in an empty diary', () => {
    withStore((db) => {
      seedPropertyAccountBooking(db);
      expect(
        findClashes(db, {
          propertyCode: CANYON,
          spaceCode: catalogCode('GRAND-A'),
          serviceDate: d('2025-04-18'),
          startMinute: 600,
          endMinute: 700,
        }),
      ).toEqual([]);
    });
  });

  it('refuses a second function in the same room at the same time', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      expect(() => seedFunction(db, booking.id, { name: 'Second Dinner' })).toThrow(
        /is already taken by FN-2025-0001/,
      );
    });
  });

  it('lets two functions sit in the same room with the turnaround between them', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { name: 'Lunch', startMinute: 660, endMinute: 840 });
      expect(() =>
        seedFunction(db, booking.id, { name: 'Dinner', startMinute: 1080, endMinute: 1380 }),
      ).not.toThrow();
    });
  });

  it('counts the setup and teardown as occupied', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { name: 'Lunch', startMinute: 660, endMinute: 840 });
      expect(() =>
        seedFunction(db, booking.id, { name: 'Tea', startMinute: 900, endMinute: 960 }),
      ).toThrow(/already taken/);
      expect(() =>
        seedFunction(db, booking.id, { name: 'Tea', startMinute: 1020, endMinute: 1080 }),
      ).not.toThrow();
    });
  });

  it('makes the combined ballroom clash with either half', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { spaceCode: 'GRAND-A' });
      expect(() =>
        seedFunction(db, booking.id, { spaceCode: 'GRAND', name: 'Whole Room' }),
      ).toThrow(/already taken/);
    });
  });

  it('makes a half clash with the combined room already booked', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { spaceCode: 'GRAND', name: 'Whole Room' });
      expect(() => seedFunction(db, booking.id, { spaceCode: 'GRAND-B' })).toThrow(/already taken/);
    });
  });

  it('lets the two halves run at once', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { spaceCode: 'GRAND-A' });
      expect(() => seedFunction(db, booking.id, { spaceCode: 'GRAND-B' })).not.toThrow();
    });
  });

  it('names which physical rooms are shared', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { spaceCode: 'GRAND-A' });
      const clashes = findClashes(db, {
        propertyCode: CANYON,
        spaceCode: catalogCode('GRAND'),
        serviceDate: d('2025-04-18'),
        startMinute: 1080,
        endMinute: 1380,
      });
      expect(clashes).toHaveLength(1);
      expect(clashes[0]?.sharedSpaces).toEqual(['GRAND-A']);
      expect(clashes[0]?.spaceCode).toBe('GRAND-A');
      expect(clashes[0]?.name).toBe('Awards Dinner');
    });
  });
});

describe('a function that runs past midnight', () => {
  it('clashes with an early function the next morning', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, {
        name: 'Reception',
        serviceDate: '2025-04-18',
        startMinute: 1200,
        endMinute: 1560,
      });
      expect(() =>
        seedFunction(db, booking.id, {
          name: 'Breakfast',
          serviceDate: '2025-04-19',
          startMinute: 60,
          endMinute: 300,
        }),
      ).toThrow(/already taken/);
    });
  });

  it('leaves the rest of the next day free', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, {
        name: 'Reception',
        serviceDate: '2025-04-18',
        startMinute: 1200,
        endMinute: 1560,
      });
      expect(() =>
        seedFunction(db, booking.id, {
          name: 'Lunch',
          serviceDate: '2025-04-19',
          startMinute: 660,
          endMinute: 840,
        }),
      ).not.toThrow();
    });
  });

  it('reaches back a day for a setup that starts the previous evening', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, {
        name: 'Late Supper',
        serviceDate: '2025-04-17',
        startMinute: 1380,
        endMinute: 1500,
      });
      const clashes = findClashes(db, {
        propertyCode: CANYON,
        spaceCode: catalogCode('GRAND-A'),
        serviceDate: d('2025-04-18'),
        startMinute: 0,
        endMinute: 120,
      });
      expect(clashes).toHaveLength(1);
    });
  });
});

describe('a released or cancelled function gives the room back', () => {
  it('stops blocking once it is released', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const first = seedFunction(db, booking.id);
      expect(() => seedFunction(db, booking.id, { name: 'Second' })).toThrow(/already taken/);
      setFunctionStatus(db, first.id, 'RELEASED', LATER);
      expect(() => seedFunction(db, booking.id, { name: 'Second' })).not.toThrow();
    });
  });

  it('stops blocking once it is cancelled', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const first = seedFunction(db, booking.id);
      setFunctionStatus(db, first.id, 'CANCELLED', LATER);
      expect(() => seedFunction(db, booking.id, { name: 'Second' })).not.toThrow();
    });
  });

  it('still blocks once it is definite', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const first = seedFunction(db, booking.id);
      setFunctionStatus(db, first.id, 'DEFINITE', LATER);
      expect(() => seedFunction(db, booking.id, { name: 'Second' })).toThrow(/already taken/);
    });
  });
});

describe('moving a function that is already in the diary', () => {
  it('does not let a function clash with itself', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      expect(() => editFunction(db, slot.id, { startMinute: 1020 }, LATER)).not.toThrow();
    });
  });

  it('still refuses a move onto another function', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { name: 'Lunch', startMinute: 660, endMinute: 840 });
      const dinner = seedFunction(db, booking.id, {
        name: 'Dinner',
        startMinute: 1080,
        endMinute: 1380,
      });
      expect(() => editFunction(db, dinner.id, { startMinute: 780 }, LATER)).toThrow(
        /already taken/,
      );
    });
  });

  it('lets a function move into a room that is free', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { spaceCode: 'GRAND-A' });
      const second = seedFunction(db, booking.id, { spaceCode: 'GRAND-B', name: 'Second' });
      expect(() => editFunction(db, second.id, { spaceCode: 'GRAND-A' }, LATER)).toThrow(
        /already taken/,
      );
      expect(() =>
        editFunction(db, second.id, { spaceCode: 'ASPEN', expectedCovers: 50 }, LATER),
      ).not.toThrow();
    });
  });
});

describe('the function board', () => {
  it('lists one date in start time order', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { name: 'Dinner', startMinute: 1080, endMinute: 1380 });
      seedFunction(db, booking.id, {
        name: 'Breakfast',
        spaceCode: 'ASPEN',
        setupStyle: 'ROUNDS-10',
        expectedCovers: 40,
        startMinute: 420,
        endMinute: 540,
      });
      expect(functionsOnDate(db, CANYON, d('2025-04-18')).map((row) => row.name)).toEqual([
        'Breakfast',
        'Dinner',
      ]);
      expect(functionsOnDate(db, CANYON, d('2025-04-19'))).toEqual([]);
    });
  });

  it('raises a conflict error rather than returning one', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      expect(() =>
        assertNoClash(db, {
          propertyCode: CANYON,
          spaceCode: catalogCode('GRAND-A'),
          serviceDate: d('2025-04-18'),
          startMinute: 1080,
          endMinute: 1380,
        }),
      ).toThrow(/is already taken by/);
    });
  });
});
