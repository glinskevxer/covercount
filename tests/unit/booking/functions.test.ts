import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import {
  CANYON,
  FIXED_NOW,
  seedFunction,
  seedPropertyAccountBooking,
} from '../../support/fixtures.js';
import {
  MAX_END_MINUTE,
  addFunction,
  assertFits,
  editFunction,
  expectedCoversForBooking,
  findFunction,
  listFunctions,
  requireFunction,
  setFunctionStatus,
} from '../../../src/booking/functions.js';
import { listEvents } from '../../../src/booking/store.js';
import { setSpaceActive } from '../../../src/property/store.js';
import { catalogCode, parseEntityId } from '../../../src/core/ids.js';

const LATER = '2025-02-01T09:00:00.000Z';

describe('adding a function', () => {
  it('starts as a hold and reads back what it was given', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      expect(slot.id).toBe('FN-2025-0001');
      expect(slot.bookingId).toBe(booking.id);
      expect(slot.status).toBe('HELD');
      expect(slot.spaceCode).toBe('GRAND-A');
      expect(slot.name).toBe('Awards Dinner');
      expect(slot.serviceDate).toBe('2025-04-18');
      expect(slot.startMinute).toBe(1080);
      expect(slot.endMinute).toBe(1380);
      expect(slot.setupStyle).toBe('ROUNDS-10');
      expect(slot.serviceStyle).toBe('PLATED');
      expect(slot.expectedCovers).toBe(180);
      expect(slot.createdAt).toBe(FIXED_NOW);
    });
  });

  it('takes a function that runs past midnight', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id, { startMinute: 1200, endMinute: 1560 });
      expect(slot.endMinute).toBe(1560);
    });
  });

  it('records the addition against the booking', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      const events = listEvents(db, booking.id);
      expect(events[1]?.kind).toBe('function-added');
      expect(events[1]?.detail).toBe(`${slot.id} GRAND-A 2025-04-18`);
    });
  });

  it('numbers functions in their own run', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(seedFunction(db, booking.id).id).toBe('FN-2025-0001');
      expect(seedFunction(db, booking.id, { spaceCode: 'GRAND-B' }).id).toBe('FN-2025-0002');
    });
  });

  it('refuses a block that does not make sense', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() => seedFunction(db, booking.id, { startMinute: 1440 })).toThrow(
        /not a minute of the day/,
      );
      expect(() => seedFunction(db, booking.id, { startMinute: -1 })).toThrow(/minute of the day/);
      expect(() => seedFunction(db, booking.id, { endMinute: 1080 })).toThrow(
        /end after it starts/,
      );
      expect(() => seedFunction(db, booking.id, { endMinute: MAX_END_MINUTE + 1 })).toThrow(
        /into the following day/,
      );
      expect(() => seedFunction(db, booking.id, { endMinute: 1380.5 })).toThrow(/whole minute/);
    });
  });

  it('refuses a blank name and a fractional cover count', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() => seedFunction(db, booking.id, { name: '  ' })).toThrow(/needs a name/);
      expect(() => seedFunction(db, booking.id, { expectedCovers: 1.5 })).toThrow(/whole count/);
      expect(() => seedFunction(db, booking.id, { expectedCovers: -1 })).toThrow(/whole count/);
    });
  });

  it('refuses a setup or service style it does not know', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() => seedFunction(db, booking.id, { setupStyle: 'CABARET' })).toThrow(
        /not a setup style/,
      );
      expect(() => seedFunction(db, booking.id, { serviceStyle: 'TAPAS' })).toThrow(
        /not a service style/,
      );
    });
  });

  it('refuses a room that is out of service or not on file', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      setSpaceActive(db, CANYON, catalogCode('GRAND-A'), false);
      expect(() => seedFunction(db, booking.id)).toThrow(/is out of service/);
      expect(() => seedFunction(db, booking.id, { spaceCode: 'TERRACE' })).toThrow(
        /has no room called TERRACE/,
      );
    });
  });
});

describe('the room has to hold the setup', () => {
  it('refuses covers over the published setup capacity', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() => seedFunction(db, booking.id, { expectedCovers: 201 })).toThrow(
        /over the ROUNDS-10 capacity of 200/,
      );
      expect(seedFunction(db, booking.id, { expectedCovers: 200 }).expectedCovers).toBe(200);
    });
  });

  it('refuses covers over the fire capacity before it looks at the setup', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() =>
        seedFunction(db, booking.id, { setupStyle: 'RECEPTION', expectedCovers: 351 }),
      ).toThrow(/over the fire capacity of 350/);
    });
  });

  it('refuses a setup style the room publishes no capacity for', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      expect(() =>
        seedFunction(db, booking.id, { setupStyle: 'BOARDROOM', expectedCovers: 12 }),
      ).toThrow(/no published capacity for BOARDROOM/);
    });
  });

  it('checks a room directly', () => {
    withStore((db) => {
      seedPropertyAccountBooking(db);
      expect(() => assertFits(db, CANYON, catalogCode('ASPEN'), 'ROUNDS-10', 60)).not.toThrow();
      expect(() => assertFits(db, CANYON, catalogCode('ASPEN'), 'ROUNDS-10', 61)).toThrow(
        /over the ROUNDS-10 capacity of 60/,
      );
    });
  });
});

describe('reading functions', () => {
  it('answers for one that is not there', () => {
    withStore((db) => {
      seedPropertyAccountBooking(db);
      const missing = parseEntityId('functionSlot', 'FN-2025-9999');
      expect(findFunction(db, missing)).toBeUndefined();
      expect(() => requireFunction(db, missing)).toThrow(/is not on file/);
    });
  });

  it('lists by date then start time', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFunction(db, booking.id, { name: 'Dinner', serviceDate: '2025-04-18' });
      seedFunction(db, booking.id, {
        name: 'Breakfast',
        serviceDate: '2025-04-18',
        spaceCode: 'ASPEN',
        setupStyle: 'ROUNDS-10',
        expectedCovers: 40,
        startMinute: 420,
        endMinute: 540,
      });
      seedFunction(db, booking.id, {
        name: 'Welcome',
        serviceDate: '2025-04-17',
        spaceCode: 'GRAND-B',
        startMinute: 1080,
        endMinute: 1200,
      });
      expect(listFunctions(db, booking.id).map((row) => row.name)).toEqual([
        'Welcome',
        'Breakfast',
        'Dinner',
      ]);
    });
  });

  it('reports the largest cover count still holding space', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const dinner = seedFunction(db, booking.id, { expectedCovers: 180 });
      seedFunction(db, booking.id, { spaceCode: 'GRAND-B', expectedCovers: 120 });
      expect(expectedCoversForBooking(db, booking.id)).toBe(180);
      setFunctionStatus(db, dinner.id, 'RELEASED', LATER);
      expect(expectedCoversForBooking(db, booking.id)).toBe(120);
    });
  });
});

describe('editing a function', () => {
  it('moves the room, the date and the block', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      const moved = editFunction(
        db,
        slot.id,
        { spaceCode: 'GRAND-B', serviceDate: '2025-04-19', startMinute: 1140 },
        LATER,
        'r.okonkwo',
      );
      expect(moved.spaceCode).toBe('GRAND-B');
      expect(moved.serviceDate).toBe('2025-04-19');
      expect(moved.startMinute).toBe(1140);
      expect(moved.endMinute).toBe(1380);
      expect(moved.updatedAt).toBe(LATER);
    });
  });

  it('validates the merged shape, not just what changed', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      expect(() => editFunction(db, slot.id, { startMinute: 1400 }, LATER)).toThrow(
        /end after it starts/,
      );
      expect(() => editFunction(db, slot.id, { expectedCovers: 201 }, LATER)).toThrow(
        /over the ROUNDS-10 capacity/,
      );
      expect(() => editFunction(db, slot.id, { spaceCode: 'ASPEN' }, LATER)).toThrow(
        /over the fire capacity of 80 in ASPEN/,
      );
    });
  });

  it('records the edit and leaves the row alone when it refuses', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      editFunction(db, slot.id, { name: 'Gala Dinner' }, LATER, 'r.okonkwo');
      expect(listEvents(db, booking.id).at(-1)?.kind).toBe('function-edited');
      expect(() => editFunction(db, slot.id, { expectedCovers: 900 }, LATER)).toThrow();
      expect(requireFunction(db, slot.id).name).toBe('Gala Dinner');
    });
  });
});

describe('moving a function status', () => {
  it('moves and records', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      expect(setFunctionStatus(db, slot.id, 'DEFINITE', LATER, 'r.okonkwo').status).toBe(
        'DEFINITE',
      );
      expect(listEvents(db, booking.id).at(-1)?.detail).toBe(`${slot.id} HELD to DEFINITE`);
    });
  });

  it('is a no operation when the status is already there', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      const before = listEvents(db, booking.id).length;
      expect(setFunctionStatus(db, slot.id, 'HELD', LATER).status).toBe('HELD');
      expect(listEvents(db, booking.id)).toHaveLength(before);
    });
  });

  it('will not move a cancelled function again, or edit it', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      setFunctionStatus(db, slot.id, 'CANCELLED', LATER);
      expect(() => setFunctionStatus(db, slot.id, 'HELD', LATER)).toThrow(/cannot move again/);
      expect(() => editFunction(db, slot.id, { name: 'New' }, LATER)).toThrow(/is cancelled/);
    });
  });

  it('refuses a function added to a booking that is not on file', () => {
    withStore((db) => {
      seedPropertyAccountBooking(db);
      expect(() =>
        addFunction(
          db,
          parseEntityId('booking', 'BK-2025-9999'),
          {
            spaceCode: 'GRAND-A',
            name: 'x',
            serviceDate: '2025-04-18',
            startMinute: 600,
            endMinute: 700,
            setupStyle: 'ROUNDS-10',
            serviceStyle: 'PLATED',
            expectedCovers: 10,
          },
          LATER,
        ),
      ).toThrow(/is not on file/);
    });
  });
});
