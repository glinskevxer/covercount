import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { seedFunction, seedPropertyAccountBooking } from '../../support/fixtures.js';
import { seedFullCatalog } from '../../support/menu.js';
import {
  billedCovers,
  findCovers,
  guaranteeAtCutoff,
  listMovements,
  openCovers,
  overageCovers,
  oversetFor,
  recordServed,
  requireCovers,
  setCoversFor,
  setGuarantee,
  shortfallCovers,
} from '../../../src/covers/guarantee.js';
import { setFunctionStatus } from '../../../src/booking/functions.js';
import { rateFromPercent } from '../../../src/core/rate.js';
import { formatZoned } from '../../../src/core/clock.js';

const BEFORE = '2025-04-10T09:00:00.000Z';
const AFTER = '2025-04-17T09:00:00.000Z';

function openFunction(db: Parameters<typeof openCovers>[0]) {
  const booking = seedPropertyAccountBooking(db);
  seedFullCatalog(db);
  const slot = seedFunction(db, booking.id);
  openCovers(db, slot.id, {
    packageCode: 'PLATED-THREE',
    priceBookCode: 'RACK-2025',
    contractDate: '2025-01-20',
  });
  return slot;
}

describe('the overset', () => {
  it('rounds a part cover up to a whole place setting', () => {
    expect(oversetFor(180, rateFromPercent(5), 25)).toBe(9);
    expect(oversetFor(181, rateFromPercent(5), 25)).toBe(10);
    expect(oversetFor(1, rateFromPercent(5), 25)).toBe(1);
    expect(oversetFor(0, rateFromPercent(5), 25)).toBe(0);
  });

  it('stops at the property cap', () => {
    expect(oversetFor(1000, rateFromPercent(5), 25)).toBe(25);
    expect(oversetFor(500, rateFromPercent(5), 25)).toBe(25);
    expect(oversetFor(400, rateFromPercent(5), 25)).toBe(20);
  });

  it('adds the overset to the guarantee for what the room is set at', () => {
    expect(setCoversFor(180, rateFromPercent(5), 25)).toBe(189);
    expect(setCoversFor(1000, rateFromPercent(5), 25)).toBe(1025);
  });

  it('refuses a guarantee that is not a whole count', () => {
    expect(() => oversetFor(-1, rateFromPercent(5), 25)).toThrow(/whole count of covers/);
    expect(() => oversetFor(1.5, rateFromPercent(5), 25)).toThrow(/whole count of covers/);
  });
});

describe('opening a cover count', () => {
  it('computes the deadline off the property and the service date', () => {
    withStore((db) => {
      const slot = openFunction(db);
      const covers = requireCovers(db, slot.id);
      expect(formatZoned(covers.guaranteeDue)).toBe('2025-04-15 12:00 America/Denver');
      expect(covers.contractDate).toBe('2025-01-20');
      expect(covers.packageCode).toBe('PLATED-THREE');
      expect(covers.priceBookCode).toBe('RACK-2025');
      expect(covers.guaranteedCovers).toBeUndefined();
      expect(covers.servedCovers).toBeUndefined();
    });
  });

  it('refuses a second count on the same function', () => {
    withStore((db) => {
      const slot = openFunction(db);
      expect(() => openCovers(db, slot.id, { contractDate: '2025-01-20' })).toThrow(
        /already has a cover count open/,
      );
    });
  });

  it('refuses a package whose service style is not the function style', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFullCatalog(db);
      const slot = seedFunction(db, booking.id, { serviceStyle: 'RECEPTION' });
      expect(() =>
        openCovers(db, slot.id, { packageCode: 'PLATED-THREE', contractDate: '2025-01-20' }),
      ).toThrow(/is a PLATED package and .* is RECEPTION/);
    });
  });

  it('refuses a package or a book that is not on file', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      seedFullCatalog(db);
      const slot = seedFunction(db, booking.id);
      expect(() =>
        openCovers(db, slot.id, { packageCode: 'UNICORN', contractDate: '2025-01-20' }),
      ).toThrow(/has no package UNICORN/);
      expect(() =>
        openCovers(db, slot.id, { priceBookCode: 'NOBOOK', contractDate: '2025-01-20' }),
      ).toThrow(/has no price book NOBOOK/);
    });
  });

  it('takes a count with no package on it yet', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      const covers = openCovers(db, slot.id, { contractDate: '2025-01-20' });
      expect(covers.packageCode).toBeUndefined();
      expect(covers.priceBookCode).toBeUndefined();
    });
  });

  it('answers for a function with no count open', () => {
    withStore((db) => {
      const booking = seedPropertyAccountBooking(db);
      const slot = seedFunction(db, booking.id);
      expect(findCovers(db, slot.id)).toBeUndefined();
      expect(() => requireCovers(db, slot.id)).toThrow(/has no cover count open/);
    });
  });
});

describe('moving the guarantee before the deadline', () => {
  it('takes a number and records the movement', () => {
    withStore((db) => {
      const slot = openFunction(db);
      const covers = setGuarantee(db, slot.id, 180, BEFORE, 'r.okonkwo');
      expect(covers.guaranteedCovers).toBe(180);
      expect(covers.guaranteedAt).toBe(BEFORE);
      expect(covers.setCovers).toBe(189);
      const movements = listMovements(db, slot.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]?.fromCovers).toBeUndefined();
      expect(movements[0]?.toCovers).toBe(180);
      expect(movements[0]?.afterCutoff).toBe(false);
      expect(movements[0]?.actor).toBe('r.okonkwo');
    });
  });

  it('goes up and down freely', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      setGuarantee(db, slot.id, 150, BEFORE);
      expect(requireCovers(db, slot.id).guaranteedCovers).toBe(150);
      expect(requireCovers(db, slot.id).setCovers).toBe(158);
      setGuarantee(db, slot.id, 190, BEFORE);
      expect(requireCovers(db, slot.id).guaranteedCovers).toBe(190);
      expect(listMovements(db, slot.id).map((row) => row.toCovers)).toEqual([180, 150, 190]);
    });
  });

  it('records where each movement came from', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      setGuarantee(db, slot.id, 150, BEFORE);
      expect(listMovements(db, slot.id)[1]?.fromCovers).toBe(180);
    });
  });

  it('refuses a count that is not a whole number of covers', () => {
    withStore((db) => {
      const slot = openFunction(db);
      expect(() => setGuarantee(db, slot.id, -1, BEFORE)).toThrow(/whole count of covers/);
      expect(() => setGuarantee(db, slot.id, 1.5, BEFORE)).toThrow(/whole count of covers/);
    });
  });

  it('refuses a guarantee the room cannot be set for', () => {
    withStore((db) => {
      const slot = openFunction(db);
      expect(() => setGuarantee(db, slot.id, 195, BEFORE)).toThrow(
        /over the ROUNDS-10 capacity of 200/,
      );
      expect(setGuarantee(db, slot.id, 190, BEFORE).setCovers).toBe(200);
    });
  });

  it('refuses a guarantee on a released or cancelled function', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setFunctionStatus(db, slot.id, 'RELEASED', BEFORE);
      expect(() => setGuarantee(db, slot.id, 180, BEFORE)).toThrow(/takes no guarantee/);
    });
  });
});

describe('moving the guarantee after the deadline', () => {
  it('lets the count rise', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      const raised = setGuarantee(db, slot.id, 186, AFTER, 'r.okonkwo');
      expect(raised.guaranteedCovers).toBe(186);
      expect(listMovements(db, slot.id).at(-1)?.afterCutoff).toBe(true);
    });
  });

  it('refuses to let it fall', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      expect(() => setGuarantee(db, slot.id, 170, AFTER)).toThrow(
        /closed on 2025-04-15 and cannot be lowered from 180 to 170/,
      );
      expect(requireCovers(db, slot.id).guaranteedCovers).toBe(180);
    });
  });

  it('lets a manager override the cutoff and records that they did', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      const lowered = setGuarantee(db, slot.id, 170, AFTER, 'j.marsh', {
        overrideCutoff: true,
        note: 'coach cancelled, agreed with the chef',
      });
      expect(lowered.guaranteedCovers).toBe(170);
      const last = listMovements(db, slot.id).at(-1);
      expect(last?.afterCutoff).toBe(true);
      expect(last?.note).toBe('coach cancelled, agreed with the chef');
      expect(last?.actor).toBe('j.marsh');
    });
  });

  it('takes a first guarantee after the deadline without complaint', () => {
    withStore((db) => {
      const slot = openFunction(db);
      expect(setGuarantee(db, slot.id, 120, AFTER).guaranteedCovers).toBe(120);
    });
  });

  it('reports what the guarantee was when the deadline passed', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      setGuarantee(db, slot.id, 186, AFTER);
      expect(guaranteeAtCutoff(db, slot.id)).toBe(180);
      expect(requireCovers(db, slot.id).guaranteedCovers).toBe(186);
    });
  });

  it('reports nothing at the cutoff when the count was opened late', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 120, AFTER);
      expect(guaranteeAtCutoff(db, slot.id)).toBeUndefined();
    });
  });
});

describe('reconciling against what was served', () => {
  const SERVICE = '2025-04-18T23:30:00.000Z';

  it('bills the guarantee when fewer turn up', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      const covers = recordServed(db, slot.id, 172, SERVICE);
      expect(billedCovers(covers)).toBe(180);
      expect(shortfallCovers(covers)).toBe(8);
      expect(overageCovers(covers)).toBe(0);
    });
  });

  it('bills what went out when more turn up', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      const covers = recordServed(db, slot.id, 188, SERVICE);
      expect(billedCovers(covers)).toBe(188);
      expect(overageCovers(covers)).toBe(8);
      expect(shortfallCovers(covers)).toBe(0);
    });
  });

  it('bills the guarantee before anybody has been counted', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      const covers = requireCovers(db, slot.id);
      expect(billedCovers(covers)).toBe(180);
      expect(overageCovers(covers)).toBe(0);
      expect(shortfallCovers(covers)).toBe(0);
    });
  });

  it('refuses a served count with no guarantee behind it', () => {
    withStore((db) => {
      const slot = openFunction(db);
      expect(() => recordServed(db, slot.id, 180, SERVICE)).toThrow(/was never guaranteed/);
      expect(() => billedCovers(requireCovers(db, slot.id))).toThrow(/cannot be billed/);
    });
  });

  it('refuses a served count that is not a whole number', () => {
    withStore((db) => {
      const slot = openFunction(db);
      setGuarantee(db, slot.id, 180, BEFORE);
      expect(() => recordServed(db, slot.id, -1, SERVICE)).toThrow(/whole count of covers/);
      expect(() => recordServed(db, slot.id, 1.5, SERVICE)).toThrow(/whole count of covers/);
    });
  });
});
