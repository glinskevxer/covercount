import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import {
  CANYON,
  FENWICK,
  seedBooking,
  seedFunction,
  seedPropertyAccountBooking,
} from '../../support/fixtures.js';
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  cancelBooking,
  closeBooking,
  makeDefinite,
  makeTentative,
  transitionBooking,
} from '../../../src/booking/lifecycle.js';
import { listEvents, requireBooking, updateBooking } from '../../../src/booking/store.js';
import { listFunctions, setFunctionStatus } from '../../../src/booking/functions.js';
import { setCreditStatus } from '../../../src/booking/accounts.js';
import { calendarDate } from '../../../src/core/calendar.js';

const NOW = '2025-02-04T10:00:00.000Z';
const d = calendarDate;

describe('the transition table', () => {
  it('lets a booking climb and lets it be cancelled at every live stage', () => {
    expect(canTransition('INQUIRY', 'TENTATIVE')).toBe(true);
    expect(canTransition('TENTATIVE', 'DEFINITE')).toBe(true);
    expect(canTransition('DEFINITE', 'CLOSED')).toBe(true);
    expect(canTransition('INQUIRY', 'CANCELLED')).toBe(true);
    expect(canTransition('TENTATIVE', 'CANCELLED')).toBe(true);
    expect(canTransition('DEFINITE', 'CANCELLED')).toBe(true);
  });

  it('refuses to skip a stage or to go back from definite', () => {
    expect(canTransition('INQUIRY', 'DEFINITE')).toBe(false);
    expect(canTransition('DEFINITE', 'TENTATIVE')).toBe(false);
    expect(canTransition('TENTATIVE', 'CLOSED')).toBe(false);
  });

  it('lets a tentative booking drop back to an inquiry', () => {
    expect(canTransition('TENTATIVE', 'INQUIRY')).toBe(true);
  });

  it('leaves a finished booking with nowhere to go', () => {
    expect(ALLOWED_TRANSITIONS.CANCELLED).toEqual([]);
    expect(ALLOWED_TRANSITIONS.CLOSED).toEqual([]);
  });
});

describe('making a booking tentative', () => {
  it('needs a function holding space', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() => makeTentative(db, booking.id, NOW)).toThrow(/holds no space/);
      seedFunction(db, booking.id);
      expect(makeTentative(db, booking.id, NOW).status).toBe('TENTATIVE');
    });
  });

  it('does not count a released function as space held', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      setFunctionStatus(db, slot.id, 'RELEASED', NOW);
      expect(() => makeTentative(db, booking.id, NOW)).toThrow(/holds no space/);
    });
  });

  it('is a no operation when it is already tentative', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW);
      const before = listEvents(db, booking.id).length;
      expect(makeTentative(db, booking.id, NOW).status).toBe('TENTATIVE');
      expect(listEvents(db, booking.id)).toHaveLength(before);
    });
  });

  it('can drop back to an inquiry', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW);
      expect(transitionBooking(db, booking.id, 'INQUIRY', NOW).status).toBe('INQUIRY');
    });
  });
});

describe('making a booking definite', () => {
  it('turns every held function definite with it', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      seedFunction(db, booking.id, { spaceCode: 'GRAND-B', name: 'Second' });
      makeTentative(db, booking.id, NOW);
      expect(makeDefinite(db, booking.id, NOW).status).toBe('DEFINITE');
      expect(listFunctions(db, booking.id).map((row) => row.status)).toEqual([
        'DEFINITE',
        'DEFINITE',
      ]);
    });
  });

  it('leaves a released function alone', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const first = seedFunction(db, booking.id);
      seedFunction(db, booking.id, { spaceCode: 'GRAND-B', name: 'Second' });
      setFunctionStatus(db, first.id, 'RELEASED', NOW);
      makeTentative(db, booking.id, NOW);
      makeDefinite(db, booking.id, NOW);
      expect(listFunctions(db, booking.id).map((row) => row.status)).toEqual([
        'RELEASED',
        'DEFINITE',
      ]);
    });
  });

  it('refuses a booking with no account on it', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      updateBooking(db, booking.id, { accountCode: null }, NOW);
      makeTentative(db, booking.id, NOW);
      expect(() => makeDefinite(db, booking.id, NOW)).toThrow(/has no account on it/);
    });
  });

  it('refuses an account the controller has stopped', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW);
      setCreditStatus(db, CANYON, FENWICK, 'HOLD');
      expect(() => makeDefinite(db, booking.id, NOW)).toThrow(/on credit hold/);
      setCreditStatus(db, CANYON, FENWICK, 'PREPAY');
      expect(makeDefinite(db, booking.id, NOW).status).toBe('DEFINITE');
    });
  });

  it('refuses a jump straight from an inquiry', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      expect(() => makeDefinite(db, booking.id, NOW)).toThrow(
        /a booking that is INQUIRY cannot become DEFINITE/,
      );
    });
  });

  it('leaves the functions held when it refuses', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW);
      setCreditStatus(db, CANYON, FENWICK, 'HOLD');
      expect(() => makeDefinite(db, booking.id, NOW)).toThrow();
      expect(listFunctions(db, booking.id)[0]?.status).toBe('HELD');
      expect(requireBooking(db, booking.id).status).toBe('TENTATIVE');
    });
  });
});

describe('cancelling a booking', () => {
  it('needs a reason and puts it on the record', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      expect(() => cancelBooking(db, booking.id, '   ', NOW)).toThrow(/needs a reason/);
      const cancelled = cancelBooking(db, booking.id, 'client postponed to autumn', NOW);
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelReason).toBe('client postponed to autumn');
      expect(cancelled.closedAt).toBe(NOW);
    });
  });

  it('cancels every function that was holding space', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const first = seedFunction(db, booking.id);
      seedFunction(db, booking.id, { spaceCode: 'GRAND-B', name: 'Second' });
      setFunctionStatus(db, first.id, 'RELEASED', NOW);
      cancelBooking(db, booking.id, 'client postponed', NOW);
      expect(listFunctions(db, booking.id).map((row) => row.status)).toEqual([
        'RELEASED',
        'CANCELLED',
      ]);
    });
  });

  it('gives the room back to the diary', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      cancelBooking(db, booking.id, 'client postponed', NOW);
      const second = seedBooking(db, { postAs: 'Replacement' });
      expect(() => seedFunction(db, second.id)).not.toThrow();
    });
  });

  it('can cancel from a definite booking too', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW);
      makeDefinite(db, booking.id, NOW);
      expect(cancelBooking(db, booking.id, 'flood in the ballroom', NOW).status).toBe('CANCELLED');
    });
  });

  it('refuses to move a cancelled booking again, or to edit it', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      cancelBooking(db, booking.id, 'client postponed', NOW);
      expect(() => makeTentative(db, booking.id, NOW)).toThrow(
        /a booking that is CANCELLED cannot become TENTATIVE/,
      );
      expect(() => updateBooking(db, booking.id, { postAs: 'New' }, NOW)).toThrow(
        /is cancelled and cannot be edited/,
      );
    });
  });
});

describe('closing a booking', () => {
  it('needs the date the office believes it is', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW);
      makeDefinite(db, booking.id, NOW);
      expect(() => transitionBooking(db, booking.id, 'CLOSED', NOW)).toThrow(
        /needs the date the office believes it is/,
      );
    });
  });

  it('refuses while a function is still to be served', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW);
      makeDefinite(db, booking.id, NOW);
      expect(() => closeBooking(db, booking.id, d('2025-04-18'), NOW)).toThrow(
        /still has Awards Dinner on 2025-04-18 to serve/,
      );
    });
  });

  it('closes once the last function is behind the office', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW);
      makeDefinite(db, booking.id, NOW);
      const closed = closeBooking(db, booking.id, d('2025-04-19'), NOW);
      expect(closed.status).toBe('CLOSED');
      expect(closed.closedAt).toBe(NOW);
      expect(closed.cancelReason).toBeUndefined();
    });
  });

  it('ignores a function that was released rather than served', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const later = seedFunction(db, booking.id, {
        serviceDate: '2025-06-01',
        spaceCode: 'GRAND-B',
        name: 'Later',
      });
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW);
      makeDefinite(db, booking.id, NOW);
      expect(() => closeBooking(db, booking.id, d('2025-04-19'), NOW)).toThrow(/to serve/);
      setFunctionStatus(db, later.id, 'RELEASED', NOW);
      expect(closeBooking(db, booking.id, d('2025-04-19'), NOW).status).toBe('CLOSED');
    });
  });
});

describe('the trail a transition leaves', () => {
  it('records the move and the reason', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id);
      makeTentative(db, booking.id, NOW, 'r.okonkwo');
      cancelBooking(db, booking.id, 'client postponed', NOW, 'r.okonkwo');
      const events = listEvents(db, booking.id).filter((row) => row.kind === 'status');
      expect(events.map((row) => row.detail)).toEqual([
        'INQUIRY to TENTATIVE',
        'TENTATIVE to CANCELLED: client postponed',
      ]);
      expect(events.every((row) => row.actor === 'r.okonkwo')).toBe(true);
    });
  });
});
