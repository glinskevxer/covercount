import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { FIXED_NOW, seedFunction, seedPropertyAccountBooking } from '../../support/fixtures.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { calendarDate } from '../../../src/core/calendar.js';
import {
  APPOINTMENT_KINDS,
  EARLIEST_BY_KIND,
  bookAppointment,
  cancelAppointment,
  findAppointment,
  isAppointmentKind,
  listAppointments,
  recordOutcome,
  requireAppointment,
  tastingWindow,
} from '../../../src/booking/appointments.js';
import type { Database } from '../../../src/store/database.js';

const JANUARY = calendarDate('2025-01-20');

function booked(db: Database) {
  const booking = seedPropertyAccountBooking(db);
  seedFunction(db, booking.id);
  return booking;
}

describe('booking an appointment', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      const booking = booked(db);
      const appointment = bookAppointment(
        db,
        booking.id,
        {
          kind: 'tasting',
          onDate: JANUARY,
          startMinute: 660,
          endMinute: 780,
          spaceCode: code('ASPEN'),
          attendees: '  Ms Fenwick, the chef  ',
          note: 'three mains to try',
        },
        FIXED_NOW,
      );
      expect(appointment.kind).toBe('TASTING');
      expect(appointment.spaceCode).toBe('ASPEN');
      expect(appointment.attendees).toBe('Ms Fenwick, the chef');
      expect(appointment.outcome).toBeUndefined();
      expect(requireAppointment(db, appointment.id).note).toBe('three mains to try');
    });
  });

  it('takes an appointment with no room named', () => {
    withStore((db) => {
      const booking = booked(db);
      const appointment = bookAppointment(
        db,
        booking.id,
        { kind: 'PLANNING', onDate: JANUARY, startMinute: 600, endMinute: 660 },
        FIXED_NOW,
      );
      expect(appointment.spaceCode).toBeUndefined();
    });
  });

  it('refuses a kind it does not know, a backwards window and a room it does not have', () => {
    withStore((db) => {
      const booking = booked(db);
      const base = { onDate: JANUARY, startMinute: 600, endMinute: 660 };
      expect(() => bookAppointment(db, booking.id, { ...base, kind: 'LUNCH' }, FIXED_NOW)).toThrow(
        /not a kind of appointment/,
      );
      expect(() =>
        bookAppointment(
          db,
          booking.id,
          { ...base, kind: 'TASTING', startMinute: 660, endMinute: 600 },
          FIXED_NOW,
        ),
      ).toThrow(/ends after it starts/);
      expect(() =>
        bookAppointment(
          db,
          booking.id,
          { ...base, kind: 'TASTING', spaceCode: code('NOWHERE') },
          FIXED_NOW,
        ),
      ).toThrow(/room/);
    });
  });

  it('refuses anything after the first function', () => {
    withStore((db) => {
      const booking = booked(db);
      expect(() =>
        bookAppointment(
          db,
          booking.id,
          {
            kind: 'SITE-VISIT',
            onDate: calendarDate('2025-04-19'),
            startMinute: 600,
            endMinute: 660,
          },
          FIXED_NOW,
        ),
      ).toThrow(/falls after the first function on 2025-04-18/);
    });
  });

  it('holds the pre convention meeting close to the event and nothing else', () => {
    withStore((db) => {
      const booking = booked(db);
      expect(EARLIEST_BY_KIND['PRE-CON']).toBe(2);
      expect(() =>
        bookAppointment(
          db,
          booking.id,
          { kind: 'PRE-CON', onDate: JANUARY, startMinute: 600, endMinute: 660 },
          FIXED_NOW,
        ),
      ).toThrow(/sits within 2 days of the first function/);

      const close = bookAppointment(
        db,
        booking.id,
        {
          kind: 'PRE-CON',
          onDate: calendarDate('2025-04-17'),
          startMinute: 600,
          endMinute: 660,
        },
        FIXED_NOW,
      );
      expect(close.kind).toBe('PRE-CON');

      // A tasting eleven weeks out is early, not wrong.
      expect(
        bookAppointment(
          db,
          booking.id,
          { kind: 'TASTING', onDate: JANUARY, startMinute: 600, endMinute: 660 },
          FIXED_NOW,
        ).kind,
      ).toBe('TASTING');
    });
  });

  it('takes any date at all before the booking holds space', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const appointment = bookAppointment(
        db,
        booking.id,
        { kind: 'PRE-CON', onDate: JANUARY, startMinute: 600, endMinute: 660 },
        FIXED_NOW,
      );
      expect(appointment.kind).toBe('PRE-CON');
    });
  });

  it('knows the kinds it takes', () => {
    expect(APPOINTMENT_KINDS).toHaveLength(4);
    expect(isAppointmentKind('SITE-VISIT')).toBe(true);
    expect(isAppointmentKind('LUNCH')).toBe(false);
  });
});

describe('the diary of appointments', () => {
  it('lists them in the order they happen', () => {
    withStore((db) => {
      const booking = booked(db);
      bookAppointment(
        db,
        booking.id,
        { kind: 'TASTING', onDate: calendarDate('2025-02-10'), startMinute: 660, endMinute: 780 },
        FIXED_NOW,
      );
      bookAppointment(
        db,
        booking.id,
        { kind: 'SITE-VISIT', onDate: JANUARY, startMinute: 600, endMinute: 660 },
        FIXED_NOW,
      );
      expect(listAppointments(db, booking.id).map((row) => row.kind)).toEqual([
        'SITE-VISIT',
        'TASTING',
      ]);
    });
  });

  it('records an outcome and refuses an empty one', () => {
    withStore((db) => {
      const booking = booked(db);
      const appointment = bookAppointment(
        db,
        booking.id,
        { kind: 'TASTING', onDate: JANUARY, startMinute: 660, endMinute: 780 },
        FIXED_NOW,
      );
      expect(recordOutcome(db, appointment.id, '  took the halibut  ').outcome).toBe(
        'took the halibut',
      );
      expect(() => recordOutcome(db, appointment.id, '   ')).toThrow(/an outcome cannot be blank/);
      expect(() => recordOutcome(db, 9_999, 'anything')).toThrow(/is not on file/);
    });
  });

  it('cancels one away again', () => {
    withStore((db) => {
      const booking = booked(db);
      const appointment = bookAppointment(
        db,
        booking.id,
        { kind: 'TASTING', onDate: JANUARY, startMinute: 660, endMinute: 780 },
        FIXED_NOW,
      );
      expect(cancelAppointment(db, appointment.id)).toBe(true);
      expect(cancelAppointment(db, appointment.id)).toBe(false);
      expect(findAppointment(db, appointment.id)).toBeUndefined();
    });
  });
});

describe('when a tasting still means something', () => {
  it('closes the window with the guarantee', () => {
    withStore((db) => {
      const booking = booked(db);
      const window = tastingWindow(db, booking.id);
      expect(window.firstService).toBe('2025-04-18');
      expect(window.closesOn).toBe('2025-04-15');
      expect(window.booked).toEqual([]);
      expect(window.tooLate).toEqual([]);
    });
  });

  it('picks out a tasting booked past the close', () => {
    withStore((db) => {
      const booking = booked(db);
      bookAppointment(
        db,
        booking.id,
        { kind: 'TASTING', onDate: JANUARY, startMinute: 660, endMinute: 780 },
        FIXED_NOW,
      );
      const late = bookAppointment(
        db,
        booking.id,
        {
          kind: 'TASTING',
          onDate: calendarDate('2025-04-17'),
          startMinute: 660,
          endMinute: 780,
        },
        FIXED_NOW,
      );
      const window = tastingWindow(db, booking.id);
      expect(window.booked).toHaveLength(2);
      expect(window.tooLate.map((row) => row.id)).toEqual([late.id]);
    });
  });

  it('says so when the booking holds no space', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() => tastingWindow(db, booking.id)).toThrow(/nothing to taste for/);
    });
  });
});
