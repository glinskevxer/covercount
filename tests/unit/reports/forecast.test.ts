import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedFunction } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { setFunctionStatus } from '../../../src/booking/functions.js';
import { drawPackageCharges } from '../../../src/billing/charges.js';
import { busyDays, forecast, renderForecast } from '../../../src/reports/forecast.js';

const WEEK_FROM = calendarDate('2025-04-14');
const WEEK_TO = calendarDate('2025-04-20');

describe('the pace report', () => {
  it('reads nothing on an empty week', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const found = forecast(db, CANYON, calendarDate('2025-06-01'), calendarDate('2025-06-07'));
      expect(found.days).toHaveLength(7);
      expect(busyDays(found)).toEqual([]);
      expect(found.definiteCovers).toBe(0);
      expect(renderForecast(found)).toContain('nothing on the books');
    });
  });

  it('keeps signed and held covers apart rather than adding them', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const held = forecast(db, CANYON, WEEK_FROM, WEEK_TO);
      expect(held.heldCovers).toBe(180);
      expect(held.definiteCovers).toBe(0);

      setFunctionStatus(db, slot.id, 'DEFINITE', KITCHEN_NOW);
      const signed = forecast(db, CANYON, WEEK_FROM, WEEK_TO);
      expect(signed.definiteCovers).toBe(180);
      expect(signed.heldCovers).toBe(0);
    });
  });

  it('counts a function once on its own day', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const found = forecast(db, CANYON, WEEK_FROM, WEEK_TO);
      const busy = busyDays(found);
      expect(busy).toHaveLength(1);
      expect(busy[0]?.serviceDate).toBe('2025-04-18');
      expect(busy[0]?.functions).toBe(1);
    });
  });

  it('reads revenue off the charges rather than off the package', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const before = forecast(db, CANYON, WEEK_FROM, WEEK_TO);
      expect(before.heldRevenue.amount).toBe(0);
      expect(before.unpriced).toBe(1);

      drawPackageCharges(db, slot.id);
      const after = forecast(db, CANYON, WEEK_FROM, WEEK_TO);
      expect(after.heldRevenue.amount).toBeGreaterThan(0);
      expect(after.unpriced).toBe(0);
    });
  });

  it('leaves a released function out entirely', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setFunctionStatus(db, slot.id, 'RELEASED', KITCHEN_NOW);
      const found = forecast(db, CANYON, WEEK_FROM, WEEK_TO);
      expect(busyDays(found)).toEqual([]);
      expect(found.heldCovers).toBe(0);
    });
  });

  it('falls back to the expected covers before a guarantee lands', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedFunction(db, slot.bookingId, {
        spaceCode: 'ASPEN',
        name: 'Board Breakfast',
        serviceDate: '2025-04-17',
        startMinute: 420,
        endMinute: 600,
        setupStyle: 'BOARDROOM',
        expectedCovers: 18,
      });
      const found = forecast(db, CANYON, WEEK_FROM, WEEK_TO);
      expect(found.heldCovers).toBe(198);
      expect(busyDays(found)).toHaveLength(2);
    });
  });

  it('adds the days up to the totals', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      drawPackageCharges(db, slot.id);
      const found = forecast(db, CANYON, WEEK_FROM, WEEK_TO);
      expect(found.heldCovers).toBe(found.days.reduce((total, day) => total + day.heldCovers, 0));
      expect(found.heldRevenue.amount).toBe(
        found.days.reduce((total, day) => total + day.heldRevenue.amount, 0),
      );
      expect(FIXED_NOW).toBeDefined();
    });
  });

  it('refuses a backwards range and one longer than a year', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      expect(() => forecast(db, CANYON, WEEK_TO, WEEK_FROM)).toThrow(/runs forwards/);
      expect(() =>
        forecast(db, CANYON, calendarDate('2025-01-01'), calendarDate('2026-06-01')),
      ).toThrow(/a year and a bit/);
    });
  });

  it('prints the property, the split and one line a day', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const text = renderForecast(forecast(db, CANYON, WEEK_FROM, WEEK_TO));
      expect(text).toContain('CANYON pace');
      expect(text).toContain('held 180 covers');
      expect(text).toContain('2025-04-18');
    });
  });
});
