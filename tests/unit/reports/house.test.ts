import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedFunction } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedLabour } from '../../support/labour.js';
import {
  functionBoard,
  readerBoard,
  renderFunctionBoard,
  renderReaderBoard,
  renderStaffingSheet,
  staffingSheet,
} from '../../../src/reports/house.js';
import { setFunctionStatus } from '../../../src/booking/functions.js';
import { buildRoster } from '../../../src/labour/shifts.js';
import { calendarDate } from '../../../src/core/calendar.js';

const d = calendarDate;

describe('the function board', () => {
  it('lists the day in start time order with the covers on it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const board = functionBoard(db, CANYON, d('2025-04-18'));
      expect(board.rows).toHaveLength(1);
      expect(board.rows[0]?.functionId).toBe(slot.id);
      expect(board.rows[0]?.roomName).toBe('Grand Ballroom A');
      expect(board.rows[0]?.postAs).toBe('Fenwick Annual Symposium');
      expect(board.rows[0]?.covers).toBe(180);
      expect(board.rows[0]?.setFor).toBe(189);
      expect(board.rows[0]?.start).toBe('6pm');
      expect(board.totalCovers).toBe(180);
    });
  });

  it('falls back to the expected covers before a guarantee is taken', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const second = seedFunction(db, slot.bookingId, {
        spaceCode: 'ASPEN',
        name: 'Breakfast',
        setupStyle: 'ROUNDS-10',
        expectedCovers: 40,
        startMinute: 420,
        endMinute: 540,
      });
      const board = functionBoard(db, CANYON, d('2025-04-18'));
      expect(board.rows[0]?.functionId).toBe(second.id);
      expect(board.rows[0]?.covers).toBe(40);
      expect(board.rows[0]?.setFor).toBeUndefined();
      expect(board.totalCovers).toBe(220);
    });
  });

  it('leaves a released function out of the total but still shows it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setFunctionStatus(db, slot.id, 'RELEASED', KITCHEN_NOW);
      const board = functionBoard(db, CANYON, d('2025-04-18'));
      expect(board.rows).toHaveLength(1);
      expect(board.totalCovers).toBe(0);
    });
  });

  it('prints the board and says when the day is empty', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const text = renderFunctionBoard(functionBoard(db, CANYON, d('2025-04-18')));
      expect(text).toContain('FUNCTION BOARD  Fri 18 Apr 2025');
      expect(text).toContain('Grand Ballroom A');
      expect(text).toContain('180 covers in the building');
      expect(renderFunctionBoard(functionBoard(db, CANYON, d('2025-04-20')))).toContain(
        'nothing is in the diary',
      );
    });
  });
});

describe('the reader board', () => {
  it('shows only what is definite, and never the covers', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(readerBoard(db, CANYON, d('2025-04-18'))).toEqual([]);
      setFunctionStatus(db, slot.id, 'DEFINITE', KITCHEN_NOW);
      const rows = readerBoard(db, CANYON, d('2025-04-18'));
      expect(rows).toEqual([
        { time: '6pm', room: 'Grand Ballroom A', postAs: 'Fenwick Annual Symposium' },
      ]);
      const text = renderReaderBoard(rows);
      expect(text).toContain('Fenwick Annual Symposium');
      expect(text).not.toContain('180');
    });
  });

  it('says so on a quiet day', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      expect(renderReaderBoard(readerBoard(db, CANYON, d('2025-04-20')))).toBe(
        'no functions today',
      );
    });
  });
});

describe('the staffing sheet', () => {
  it('groups the crew by role with the call times', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedLabour(db);
      buildRoster(db, slot.id, KITCHEN_NOW);
      const sheet = staffingSheet(db, CANYON, d('2025-04-18'));
      expect(sheet.rows.map((row) => row.role)).toEqual(['CAPTAIN', 'HOUSEMAN', 'SERVER']);
      expect(sheet.byRole.find((row) => row.role === 'SERVER')?.heads).toBe(12);
      expect(sheet.heads).toBe(17);
      expect(sheet.cost).toMatch(/^\$[\d,]+\.\d\d$/);
      expect(sheet.rows[0]?.from).toBe('5pm');
    });
  });

  it('leaves a released function out entirely', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedLabour(db);
      buildRoster(db, slot.id, KITCHEN_NOW);
      setFunctionStatus(db, slot.id, 'RELEASED', KITCHEN_NOW);
      expect(staffingSheet(db, CANYON, d('2025-04-18')).rows).toEqual([]);
    });
  });

  it('prints the sheet and says when nobody is called', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      seedLabour(db);
      buildRoster(db, slot.id, KITCHEN_NOW);
      const text = renderStaffingSheet(staffingSheet(db, CANYON, d('2025-04-18')));
      expect(text).toContain('STAFFING  Fri 18 Apr 2025');
      expect(text).toContain('SERVER  (12)');
      expect(text).toContain('Awards Dinner');
      expect(text).toContain('17 heads');
      expect(renderStaffingSheet(staffingSheet(db, CANYON, d('2025-04-20')))).toContain(
        'nobody is called in',
      );
    });
  });
});
