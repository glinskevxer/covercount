import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import {
  CANYON,
  FIXED_NOW,
  seedAccount,
  seedBooking,
  seedFullProperty,
} from '../../support/fixtures.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { calendarDate } from '../../../src/core/calendar.js';
import {
  challengeHold,
  competingHolds,
  findHold,
  holdsOn,
  lapsedHolds,
  placeHold,
  releaseHold,
  requireHold,
} from '../../../src/property/holds.js';
import type { Database } from '../../../src/store/database.js';

const MARCH = calendarDate('2025-03-14');
const SIGN_BY = calendarDate('2025-02-14');

function house(db: Database): void {
  seedFullProperty(db);
  seedAccount(db);
}

function bookingFor(db: Database, postAs: string) {
  return seedBooking(db, { postAs });
}

function hold(
  db: Database,
  bookingId: Parameters<typeof placeHold>[1] extends never ? never : string,
  space = 'GRAND-A',
) {
  return placeHold(
    db,
    CANYON,
    {
      spaceCode: code(space),
      bookingId: bookingId as never,
      serviceDate: MARCH,
      startMinute: 1080,
      endMinute: 1380,
      holdsUntil: SIGN_BY,
    },
    FIXED_NOW,
  );
}

describe('taking a hold', () => {
  it('gives the first one rank one', () => {
    withStore((db) => {
      house(db);
      const booking = bookingFor(db, 'Fenwick Annual Symposium');
      const first = hold(db, booking.id);
      expect(first.rank).toBe(1);
      expect(first.releasedAt).toBeUndefined();
      expect(requireHold(db, first.id).spaceCode).toBe('GRAND-A');
      expect(holdsOn(db, CANYON, MARCH)).toHaveLength(1);
    });
  });

  it('ranks the next one behind it rather than refusing it', () => {
    withStore((db) => {
      house(db);
      const first = hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      const second = hold(db, bookingFor(db, 'Halvorsen Wedding').id);
      const third = hold(db, bookingFor(db, 'Okada Retirement').id);
      expect([first.rank, second.rank, third.rank]).toEqual([1, 2, 3]);
      expect(holdsOn(db, CANYON, MARCH).map((each) => each.rank)).toEqual([1, 2, 3]);
    });
  });

  it('will not let one booking hold the same space twice', () => {
    withStore((db) => {
      house(db);
      const booking = bookingFor(db, 'Fenwick Annual Symposium');
      hold(db, booking.id);
      expect(() => hold(db, booking.id)).toThrow(/already holds that space/);
    });
  });

  it('ranks against the footprint, not against the room name', () => {
    withStore((db) => {
      house(db);
      hold(db, bookingFor(db, 'Fenwick Annual Symposium').id, 'GRAND-A');
      const combined = hold(db, bookingFor(db, 'Halvorsen Wedding').id, 'GRAND');
      expect(combined.rank).toBe(2);
      expect(
        competingHolds(db, CANYON, code('GRAND-B'), MARCH, 1080, 1380).map((each) => each.rank),
      ).toEqual([2]);
    });
  });

  it('ignores a hold in another room at the same hour', () => {
    withStore((db) => {
      house(db);
      hold(db, bookingFor(db, 'Fenwick Annual Symposium').id, 'GRAND-A');
      const elsewhere = hold(db, bookingFor(db, 'Halvorsen Wedding').id, 'ASPEN');
      expect(elsewhere.rank).toBe(1);
    });
  });

  it('refuses a backwards window and a hold that outlives the date', () => {
    withStore((db) => {
      house(db);
      const booking = bookingFor(db, 'Fenwick Annual Symposium');
      expect(() =>
        placeHold(
          db,
          CANYON,
          {
            spaceCode: code('GRAND-A'),
            bookingId: booking.id,
            serviceDate: MARCH,
            startMinute: 1380,
            endMinute: 1080,
            holdsUntil: SIGN_BY,
          },
          FIXED_NOW,
        ),
      ).toThrow(/ends after it starts/);
      expect(() =>
        placeHold(
          db,
          CANYON,
          {
            spaceCode: code('GRAND-A'),
            bookingId: booking.id,
            serviceDate: MARCH,
            startMinute: 1080,
            endMinute: 1380,
            holdsUntil: calendarDate('2025-03-20'),
          },
          FIXED_NOW,
        ),
      ).toThrow(/nothing left to sign/);
    });
  });
});

describe('letting a hold go', () => {
  it('moves everybody behind it up one', () => {
    withStore((db) => {
      house(db);
      const first = hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      const second = hold(db, bookingFor(db, 'Halvorsen Wedding').id);
      const third = hold(db, bookingFor(db, 'Okada Retirement').id);

      const result = releaseHold(db, first.id, FIXED_NOW);
      expect(result.released.releasedAt).toBe(FIXED_NOW);
      expect(result.promoted.map((each) => each.id)).toEqual([second.id, third.id]);
      expect(requireHold(db, second.id).rank).toBe(1);
      expect(requireHold(db, third.id).rank).toBe(2);
      expect(holdsOn(db, CANYON, MARCH)).toHaveLength(2);
    });
  });

  it('leaves the ranks alone when the last one goes', () => {
    withStore((db) => {
      house(db);
      const first = hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      const second = hold(db, bookingFor(db, 'Halvorsen Wedding').id);
      releaseHold(db, second.id, FIXED_NOW);
      expect(requireHold(db, first.id).rank).toBe(1);
      expect(holdsOn(db, CANYON, MARCH).map((each) => each.id)).toEqual([first.id]);
    });
  });

  it('will not release the same hold twice', () => {
    withStore((db) => {
      house(db);
      const first = hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      releaseHold(db, first.id, FIXED_NOW);
      expect(() => releaseHold(db, first.id, FIXED_NOW)).toThrow(/already released/);
    });
  });

  it('leaves a released hold readable', () => {
    withStore((db) => {
      house(db);
      const first = hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      releaseHold(db, first.id, FIXED_NOW);
      expect(findHold(db, first.id)?.releasedAt).toBe(FIXED_NOW);
    });
  });
});

describe('challenging the hold in front', () => {
  it('names the incumbent and the date they have to decide by', () => {
    withStore((db) => {
      house(db);
      const first = hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      const second = hold(db, bookingFor(db, 'Halvorsen Wedding').id);
      const challenge = challengeHold(db, second.id, calendarDate('2025-02-01'));
      expect(challenge.challenger.id).toBe(second.id);
      expect(challenge.incumbent?.id).toBe(first.id);
      expect(challenge.decideBy).toBe('2025-02-01');
      // Nothing moves until somebody decides.
      expect(requireHold(db, first.id).rank).toBe(1);
      expect(requireHold(db, second.id).rank).toBe(2);
    });
  });

  it('refuses a challenge from first hold', () => {
    withStore((db) => {
      house(db);
      const first = hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      expect(() => challengeHold(db, first.id, calendarDate('2025-02-01'))).toThrow(
        /already first on that space/,
      );
    });
  });

  it('refuses a decision date after the function', () => {
    withStore((db) => {
      house(db);
      hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      const second = hold(db, bookingFor(db, 'Halvorsen Wedding').id);
      expect(() => challengeHold(db, second.id, calendarDate('2025-03-20'))).toThrow(
        /after the function itself/,
      );
    });
  });
});

describe('holds that have run out', () => {
  it('lists the ones whose own date has passed', () => {
    withStore((db) => {
      house(db);
      const first = hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      expect(lapsedHolds(db, CANYON, calendarDate('2025-02-14'))).toEqual([]);
      const lapsed = lapsedHolds(db, CANYON, calendarDate('2025-02-15'));
      expect(lapsed.map((each) => each.id)).toEqual([first.id]);
    });
  });

  it('leaves a released hold out of the sweep', () => {
    withStore((db) => {
      house(db);
      const first = hold(db, bookingFor(db, 'Fenwick Annual Symposium').id);
      releaseHold(db, first.id, FIXED_NOW);
      expect(lapsedHolds(db, CANYON, calendarDate('2025-03-01'))).toEqual([]);
    });
  });
});
