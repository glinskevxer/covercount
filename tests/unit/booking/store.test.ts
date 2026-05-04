import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import {
  CANYON,
  FIXED_NOW,
  seedAccount,
  seedBooking,
  seedProperty,
  seedPropertyAccountBooking,
} from '../../support/fixtures.js';
import {
  findBooking,
  listBookings,
  listEvents,
  requireBooking,
  updateBooking,
} from '../../../src/booking/store.js';
import { parseEntityId } from '../../../src/core/ids.js';

const LATER = '2025-01-07T10:30:00.000Z';

describe('creating a booking', () => {
  it('starts as an inquiry with a number for the year of arrival', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(booking.id).toBe('BK-2025-0001');
      expect(booking.status).toBe('INQUIRY');
      expect(booking.postAs).toBe('Fenwick Annual Symposium');
      expect(booking.accountCode).toBe('FENWICK');
      expect(booking.salesManager).toBe('r.okonkwo');
      expect(booking.arrivalDate).toBe('2025-04-17');
      expect(booking.departureDate).toBe('2025-04-19');
      expect(booking.createdAt).toBe(FIXED_NOW);
      expect(booking.closedAt).toBeUndefined();
      expect(booking.cancelReason).toBeUndefined();
    });
  });

  it('numbers by the year the business arrives, not the year it was sold', () => {
    withStore((db) => {
      seedProperty(db);
      const next = seedBooking(db, {
        accountCode: undefined,
        arrivalDate: '2026-02-14',
        departureDate: '2026-02-14',
      });
      expect(next.id).toBe('BK-2026-0001');
    });
  });

  it('takes a booking with no account on it yet', () => {
    withStore((db) => {
      seedProperty(db);
      expect(seedBooking(db, { accountCode: undefined }).accountCode).toBeUndefined();
    });
  });

  it('writes a created event', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const events = listEvents(db, booking.id);
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe('created');
      expect(events[0]?.actor).toBe('r.okonkwo');
      expect(events[0]?.detail).toBe('Fenwick Annual Symposium');
      expect(events[0]?.occurredAt).toBe(FIXED_NOW);
    });
  });

  it('refuses a blank or overlong reader board name', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => seedBooking(db, { accountCode: undefined, postAs: '  ' })).toThrow(
        /the name on the reader board cannot be blank/,
      );
      expect(() => seedBooking(db, { accountCode: undefined, postAs: 'x'.repeat(61) })).toThrow(
        /takes 60 characters and this is/,
      );
    });
  });

  it('refuses a departure before the arrival', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        seedBooking(db, {
          accountCode: undefined,
          arrivalDate: '2025-04-19',
          departureDate: '2025-04-17',
        }),
      ).toThrow(/falls before the arrival/);
    });
  });

  it('takes a single day booking', () => {
    withStore((db) => {
      seedProperty(db);
      const sameDay = seedBooking(db, {
        accountCode: undefined,
        arrivalDate: '2025-04-19',
        departureDate: '2025-04-19',
      });
      expect(sameDay.arrivalDate).toBe(sameDay.departureDate);
    });
  });

  it('refuses an account that is not on file', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => seedBooking(db, { accountCode: 'NOBODY' })).toThrow(/has no account NOBODY/);
    });
  });

  it('rolls the number back when the insert is refused', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => seedBooking(db, { accountCode: 'NOBODY' })).toThrow();
      expect(seedBooking(db, { accountCode: undefined }).id).toBe('BK-2025-0001');
    });
  });
});

describe('finding bookings', () => {
  it('answers for one that is not there', () => {
    withStore((db) => {
      seedProperty(db);
      const missing = parseEntityId('booking', 'BK-2025-9999');
      expect(findBooking(db, missing)).toBeUndefined();
      expect(() => requireBooking(db, missing)).toThrow(/is not on file/);
    });
  });

  it('lists in arrival order', () => {
    withStore((db) => {
      seedProperty(db);
      seedBooking(db, {
        accountCode: undefined,
        postAs: 'Later',
        arrivalDate: '2025-06-01',
        departureDate: '2025-06-02',
      });
      seedBooking(db, {
        accountCode: undefined,
        postAs: 'Earlier',
        arrivalDate: '2025-03-01',
        departureDate: '2025-03-02',
      });
      expect(listBookings(db, CANYON).map((row) => row.postAs)).toEqual(['Earlier', 'Later']);
    });
  });

  it('filters by status and by account', () => {
    withStore((db) => {
      seedPropertyAccountBooking(db);
      seedBooking(db, { accountCode: undefined, postAs: 'Walk in' });
      expect(listBookings(db, CANYON, { status: 'INQUIRY' })).toHaveLength(2);
      expect(listBookings(db, CANYON, { status: 'definite' })).toHaveLength(0);
      expect(listBookings(db, CANYON, { accountCode: 'FENWICK' })).toHaveLength(1);
    });
  });

  it('filters by an overlapping date window rather than by containment', () => {
    withStore((db) => {
      seedProperty(db);
      seedBooking(db, {
        accountCode: undefined,
        postAs: 'Straddles',
        arrivalDate: '2025-04-28',
        departureDate: '2025-05-03',
      });
      expect(listBookings(db, CANYON, { from: '2025-05-01', to: '2025-05-31' })).toHaveLength(1);
      expect(listBookings(db, CANYON, { from: '2025-04-01', to: '2025-04-27' })).toHaveLength(0);
      expect(listBookings(db, CANYON, { from: '2025-05-04' })).toHaveLength(0);
      expect(listBookings(db, CANYON, { to: '2025-04-28' })).toHaveLength(1);
    });
  });

  it('refuses a status filter it does not know', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => listBookings(db, CANYON, { status: 'PENCILLED' })).toThrow(
        /not a booking status/,
      );
    });
  });
});

describe('editing a booking', () => {
  it('changes the reader board name and the dates', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const edited = updateBooking(
        db,
        booking.id,
        { postAs: 'Fenwick Symposium', departureDate: '2025-04-20' },
        LATER,
        'r.okonkwo',
      );
      expect(edited.postAs).toBe('Fenwick Symposium');
      expect(edited.departureDate).toBe('2025-04-20');
      expect(edited.arrivalDate).toBe('2025-04-17');
      expect(edited.updatedAt).toBe(LATER);
      expect(edited.createdAt).toBe(FIXED_NOW);
    });
  });

  it('records what actually moved', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      updateBooking(db, booking.id, { departureDate: '2025-04-20' }, LATER, 'r.okonkwo');
      const events = listEvents(db, booking.id);
      expect(events).toHaveLength(2);
      expect(events[1]?.kind).toBe('edited');
      expect(events[1]?.detail).toBe('departure 2025-04-19 to 2025-04-20');
    });
  });

  it('attaches and detaches an account', () => {
    withStore((db) => {
      seedProperty(db);
      seedAccount(db);
      const booking = seedBooking(db, { accountCode: undefined });
      expect(updateBooking(db, booking.id, { accountCode: 'FENWICK' }, LATER).accountCode).toBe(
        'FENWICK',
      );
      expect(
        updateBooking(db, booking.id, { accountCode: null }, LATER).accountCode,
      ).toBeUndefined();
    });
  });

  it('refuses an edit that would put departure before arrival', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() => updateBooking(db, booking.id, { departureDate: '2025-04-16' }, LATER)).toThrow(
        /falls before the arrival/,
      );
    });
  });

  it('refuses a blank reader board name and an account that is not on file', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() => updateBooking(db, booking.id, { postAs: '  ' }, LATER)).toThrow(
        /the name on the reader board cannot be blank/,
      );
      expect(() => updateBooking(db, booking.id, { accountCode: 'NOBODY' }, LATER)).toThrow(
        /has no account NOBODY/,
      );
    });
  });

  it('leaves the row alone when it refuses', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() =>
        updateBooking(db, booking.id, { postAs: 'Changed', departureDate: '2025-04-16' }, LATER),
      ).toThrow();
      expect(requireBooking(db, booking.id).postAs).toBe('Fenwick Annual Symposium');
    });
  });
});

describe('the audit trail', () => {
  it('is empty for a booking that is not there and ordered for one that is', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      updateBooking(db, booking.id, { postAs: 'One' }, LATER, 'a.singh');
      updateBooking(db, booking.id, { postAs: 'Two' }, LATER, 'a.singh');
      const events = listEvents(db, booking.id);
      expect(events.map((row) => row.kind)).toEqual(['created', 'edited', 'edited']);
      expect(events.map((row) => row.seq)).toEqual([1, 2, 3]);
      expect(listEvents(db, parseEntityId('booking', 'BK-2025-9999'))).toEqual([]);
    });
  });

  it('falls back to a system actor when none is named', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      updateBooking(db, booking.id, { postAs: 'One' }, LATER, '   ');
      expect(listEvents(db, booking.id)[1]?.actor).toBe('system');
    });
  });
});
