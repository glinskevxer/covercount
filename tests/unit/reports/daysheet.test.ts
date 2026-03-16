import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedFunction } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedEquipment } from '../../support/equipment.js';
import { seedLabour } from '../../support/labour.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { buildRoster } from '../../../src/labour/shifts.js';
import { drawPackageCharges } from '../../../src/billing/charges.js';
import { pullFor, savePull } from '../../../src/equipment/store.js';
import { setTurnStandard } from '../../../src/property/turns.js';
import { daySheet, renderDaySheet } from '../../../src/reports/daysheet.js';

const DAY = calendarDate('2025-04-18');

describe('the day sheet', () => {
  it('says nothing is on when nothing is on', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const sheet = daySheet(db, CANYON, calendarDate('2025-06-01'));
      expect(sheet.functions).toEqual([]);
      expect(sheet.covers).toBe(0);
      expect(renderDaySheet(sheet)).toContain('nothing on the books');
    });
  });

  it('lists the functions in the order they start', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedFunction(db, slot.bookingId, {
        spaceCode: 'ASPEN',
        name: 'Board Breakfast',
        startMinute: 420,
        endMinute: 600,
        setupStyle: 'BOARDROOM',
        expectedCovers: 18,
      });
      const sheet = daySheet(db, CANYON, DAY);
      expect(sheet.functions.map((row) => row.name)).toEqual(['Board Breakfast', 'Awards Dinner']);
      expect(sheet.covers).toBe(198);
    });
  });

  it('marks a function that has no guarantee yet', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedFunction(db, slot.bookingId, {
        spaceCode: 'ASPEN',
        name: 'Board Breakfast',
        startMinute: 420,
        endMinute: 600,
        setupStyle: 'BOARDROOM',
        expectedCovers: 18,
      });
      const sheet = daySheet(db, CANYON, DAY);
      expect(sheet.ungaranteed).toBe(1);
      expect(sheet.functions.find((row) => row.name === 'Awards Dinner')?.guaranteed).toBe(true);
      expect(renderDaySheet(sheet)).toContain('(expected)');
    });
  });

  it('carries the revenue and the labour it is told about', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedLabour(db);
      buildRoster(db, slot.id, KITCHEN_NOW);
      drawPackageCharges(db, slot.id);
      const sheet = daySheet(db, CANYON, DAY);
      expect(sheet.revenue.amount).toBeGreaterThan(0);
      expect(sheet.labour.amount).toBeGreaterThan(0);
      expect(sheet.functions[0]?.heads).toBeGreaterThan(0);
      expect(sheet.revenue.amount).toBe(
        sheet.functions.reduce((total, row) => total + row.revenue.amount, 0),
      );
    });
  });

  it('prints a turn that does not fit', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedFunction(db, slot.bookingId, {
        name: 'Morning Plenary',
        startMinute: 480,
        endMinute: 900,
        setupStyle: 'THEATER',
        expectedCovers: 180,
      });
      setTurnStandard(db, CANYON, 'THEATER', 'ROUNDS-10', 240, 6);
      const sheet = daySheet(db, CANYON, DAY);
      expect(sheet.tightTurns).toHaveLength(1);
      expect(renderDaySheet(sheet)).toContain('turns that do not fit');
    });
  });

  it('prints what the cupboard is short of', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedEquipment(db);
      for (const spaceCode of ['GRAND-A', 'GRAND-B', 'ASPEN']) {
        const each =
          spaceCode === 'GRAND-A'
            ? slot
            : seedFunction(db, slot.bookingId, {
                spaceCode,
                name: `Dinner in ${spaceCode}`,
                startMinute: 1080,
                endMinute: 1320,
                expectedCovers: spaceCode === 'ASPEN' ? 60 : 180,
              });
        savePull(db, each.id, pullFor(db, CANYON, each.setupStyle, each.expectedCovers));
      }
      const sheet = daySheet(db, CANYON, DAY);
      expect(sheet.shortOfKit.length).toBeGreaterThan(0);
      expect(renderDaySheet(sheet)).toContain('short of kit');
    });
  });

  it('leaves out the sections with nothing in them', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const text = renderDaySheet(daySheet(db, CANYON, DAY));
      expect(text).toContain('Awards Dinner');
      expect(text).not.toContain('turns that do not fit');
      expect(text).not.toContain('short of kit');
    });
  });

  it('carries only the errors from the sweep, not the warnings', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const sheet = daySheet(db, CANYON, DAY);
      expect(sheet.findings.every((finding) => finding.level === 'error')).toBe(true);
    });
  });
});
