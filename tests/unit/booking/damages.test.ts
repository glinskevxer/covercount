import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { readyFunction } from '../../support/production.js';
import { drawPackageCharges } from '../../../src/billing/charges.js';
import {
  assessDamages,
  bandFor,
  cancellationBands,
  removeCancellationBand,
  setCancellationBand,
} from '../../../src/booking/damages.js';
import { ratePercent } from '../../../src/core/rate.js';
import { calendarDate } from '../../../src/core/calendar.js';
import type { Database } from '../../../src/store/database.js';

/** The scale a convention hotel actually prints on the back of a contract. */
function seedScale(db: Database): void {
  setCancellationBand(db, CANYON, 180, 250_000, 'six months out');
  setCancellationBand(db, CANYON, 90, 500_000, 'a quarter out');
  setCancellationBand(db, CANYON, 30, 750_000, 'a month out');
  setCancellationBand(db, CANYON, 0, 1_000_000, 'inside a month');
}

describe('the published scale', () => {
  it('reads furthest out first', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedScale(db);
      expect(cancellationBands(db, CANYON).map((band) => band.daysBefore)).toEqual([
        180, 90, 30, 0,
      ]);
    });
  });

  it('replaces a band rather than doubling it', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedScale(db);
      setCancellationBand(db, CANYON, 90, 600_000, 'renegotiated');
      const bands = cancellationBands(db, CANYON);
      expect(bands).toHaveLength(4);
      expect(ratePercent(bands[1]?.charge ?? { ppm: 0 })).toBe(60);
      expect(bands[1]?.note).toBe('renegotiated');
    });
  });

  it('refuses damages over the whole contract, and negative days', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      expect(() => setCancellationBand(db, CANYON, 30, 1_000_001)).toThrow(
        /between nil and a hundred percent/,
      );
      expect(() => setCancellationBand(db, CANYON, -1, 500_000)).toThrow(/nil or more/);
    });
  });

  it('drops a band again', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedScale(db);
      expect(removeCancellationBand(db, CANYON, 30)).toBe(true);
      expect(removeCancellationBand(db, CANYON, 30)).toBe(false);
      expect(cancellationBands(db, CANYON)).toHaveLength(3);
    });
  });
});

describe('choosing the band', () => {
  it('takes the strictest band the notice still clears', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      seedScale(db);
      expect(bandFor(db, CANYON, 400).daysBefore).toBe(180);
      expect(bandFor(db, CANYON, 180).daysBefore).toBe(180);
      expect(bandFor(db, CANYON, 179).daysBefore).toBe(90);
      expect(bandFor(db, CANYON, 90).daysBefore).toBe(90);
      expect(bandFor(db, CANYON, 89).daysBefore).toBe(30);
      expect(bandFor(db, CANYON, 29).daysBefore).toBe(0);
      expect(bandFor(db, CANYON, 0).daysBefore).toBe(0);
    });
  });

  it('says so rather than charging nothing when the scale has a hole in it', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      setCancellationBand(db, CANYON, 90, 500_000);
      expect(() => bandFor(db, CANYON, 30)).toThrow(/publishes no cancellation band/);
    });
  });
});

describe('quoting the damages', () => {
  it('prices the contract off the charges actually drawn', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedScale(db);
      drawPackageCharges(db, slot.id);
      const assessment = assessDamages(db, slot.bookingId, calendarDate('2025-01-20'));
      expect(assessment.lines).toHaveLength(1);
      expect(assessment.contracted.amount).toBeGreaterThan(0);
      expect(assessment.damages.amount).toBeLessThan(assessment.contracted.amount);
    });
  });

  it('charges nothing on a function nobody has priced', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedScale(db);
      const assessment = assessDamages(db, slot.bookingId, calendarDate('2025-01-20'));
      expect(assessment.contracted.amount).toBe(0);
      expect(assessment.damages.amount).toBe(0);
    });
  });

  it('reads the days out from the function date, not the arrival', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedScale(db);
      drawPackageCharges(db, slot.id);
      const line = assessDamages(db, slot.bookingId, calendarDate('2025-01-20')).lines[0];
      expect(line?.serviceDate).toBe('2025-04-18');
      expect(line?.daysOut).toBe(88);
      expect(ratePercent(line?.band.charge ?? { ppm: 0 })).toBe(75);
    });
  });

  it('steps hard across a threshold', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedScale(db);
      drawPackageCharges(db, slot.id);
      const early = assessDamages(db, slot.bookingId, calendarDate('2025-01-18')).lines[0];
      const late = assessDamages(db, slot.bookingId, calendarDate('2025-01-19')).lines[0];
      expect(early?.daysOut).toBe(90);
      expect(late?.daysOut).toBe(89);
      expect(ratePercent(early?.band.charge ?? { ppm: 0 })).toBe(50);
      expect(ratePercent(late?.band.charge ?? { ppm: 0 })).toBe(75);
      expect(late?.damages.amount).toBeGreaterThan(early?.damages.amount ?? 0);
    });
  });

  it('leaves out a function that has already happened', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedScale(db);
      drawPackageCharges(db, slot.id);
      expect(() => assessDamages(db, slot.bookingId, calendarDate('2025-05-01'))).toThrow(
        /nothing left to cancel/,
      );
    });
  });

  it('totals the lines rather than rating the total', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedScale(db);
      drawPackageCharges(db, slot.id);
      const assessment = assessDamages(db, slot.bookingId, calendarDate('2025-01-20'));
      const summed = assessment.lines.reduce((total, line) => total + line.damages.amount, 0);
      expect(assessment.damages.amount).toBe(summed);
    });
  });
});
