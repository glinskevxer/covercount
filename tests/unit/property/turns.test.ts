import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedFunction, seedPropertyAccountBooking } from '../../support/fixtures.js';
import { calendarDate } from '../../../src/core/calendar.js';
import {
  listTurnStandards,
  setTurnStandard,
  tightTurns,
  turnPlan,
  turnStandard,
} from '../../../src/property/turns.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import type { Database } from '../../../src/store/database.js';

const DAY = calendarDate('2025-04-18');

function house(db: Database) {
  return seedPropertyAccountBooking(db);
}

describe('the published standard', () => {
  it('reads back what the house set', () => {
    withStore((db) => {
      house(db);
      const standard = setTurnStandard(db, CANYON, 'theater', 'rounds-10', 150, 6);
      expect(standard.fromStyle).toBe('THEATER');
      expect(standard.toStyle).toBe('ROUNDS-10');
      expect(standard.minutes).toBe(150);
      expect(standard.heads).toBe(6);
      expect(listTurnStandards(db, CANYON)).toHaveLength(1);
    });
  });

  it('falls back to the room when the pair is not published', () => {
    withStore((db) => {
      house(db);
      const fallback = turnStandard(db, CANYON, code('GRAND-A'), 'THEATER', 'ROUNDS-10');
      expect(fallback.published).toBe(false);
      expect(fallback.minutes).toBeGreaterThan(0);
      expect(fallback.heads).toBe(0);

      setTurnStandard(db, CANYON, 'THEATER', 'ROUNDS-10', 150, 6);
      const published = turnStandard(db, CANYON, code('GRAND-A'), 'THEATER', 'ROUNDS-10');
      expect(published.published).toBe(true);
      expect(published.minutes).toBe(150);
    });
  });

  it('keeps the two directions apart', () => {
    withStore((db) => {
      house(db);
      setTurnStandard(db, CANYON, 'THEATER', 'ROUNDS-10', 150, 6);
      setTurnStandard(db, CANYON, 'ROUNDS-10', 'THEATER', 90, 4);
      expect(turnStandard(db, CANYON, code('GRAND-A'), 'THEATER', 'ROUNDS-10').minutes).toBe(150);
      expect(turnStandard(db, CANYON, code('GRAND-A'), 'ROUNDS-10', 'THEATER').minutes).toBe(90);
    });
  });

  it('refuses a style it does not know and an absurd turn', () => {
    withStore((db) => {
      house(db);
      expect(() => setTurnStandard(db, CANYON, 'CABARET', 'THEATER', 60, 2)).toThrow(
        /not a setup style/,
      );
      expect(() => setTurnStandard(db, CANYON, 'THEATER', 'ROUNDS-10', 2000, 2)).toThrow(
        /nil minutes and a whole day/,
      );
      expect(() => setTurnStandard(db, CANYON, 'THEATER', 'ROUNDS-10', 60, -1)).toThrow(
        /whole number of housemen/,
      );
    });
  });
});

describe('the turns on one day', () => {
  it('finds nothing when the room is used once', () => {
    withStore((db) => {
      const booking = house(db);
      seedFunction(db, booking.id);
      expect(turnPlan(db, CANYON, DAY).turns).toEqual([]);
    });
  });

  it('pairs two functions in the same room and measures the gap', () => {
    withStore((db) => {
      const booking = house(db);
      seedFunction(db, booking.id, {
        name: 'Morning Plenary',
        startMinute: 480,
        endMinute: 720,
        setupStyle: 'THEATER',
        expectedCovers: 180,
      });
      seedFunction(db, booking.id, { name: 'Awards Dinner', startMinute: 1080 });
      setTurnStandard(db, CANYON, 'THEATER', 'ROUNDS-10', 150, 6);

      const plan = turnPlan(db, CANYON, DAY);
      expect(plan.turns).toHaveLength(1);
      const turn = plan.turns[0];
      expect(turn?.fromName).toBe('Morning Plenary');
      expect(turn?.toName).toBe('Awards Dinner');
      expect(turn?.gapMinutes).toBe(360);
      expect(turn?.tight).toBe(false);
      expect(plan.tight).toBe(0);
    });
  });

  it('says how short a tight turn is and how many hands it takes', () => {
    withStore((db) => {
      const booking = house(db);
      seedFunction(db, booking.id, {
        name: 'Morning Plenary',
        startMinute: 480,
        endMinute: 900,
        setupStyle: 'THEATER',
      });
      seedFunction(db, booking.id, { name: 'Awards Dinner', startMinute: 1080 });
      setTurnStandard(db, CANYON, 'THEATER', 'ROUNDS-10', 240, 6);

      const plan = turnPlan(db, CANYON, DAY);
      const turn = plan.turns[0];
      expect(turn?.gapMinutes).toBe(180);
      expect(turn?.shortMinutes).toBe(60);
      expect(turn?.tight).toBe(true);
      expect(turn?.headsNeeded).toBe(6);
      expect(plan.tight).toBe(1);
      expect(plan.headsAtOnce).toBe(6);
      expect(tightTurns(db, CANYON, DAY)).toHaveLength(1);
    });
  });

  it('treats the combined room and its half as one room', () => {
    withStore((db) => {
      const booking = house(db);
      seedFunction(db, booking.id, {
        spaceCode: 'GRAND',
        name: 'Trade Show',
        startMinute: 420,
        endMinute: 900,
        setupStyle: 'RECEPTION',
        expectedCovers: 400,
      });
      seedFunction(db, booking.id, {
        spaceCode: 'GRAND-B',
        name: 'Awards Dinner',
        startMinute: 1080,
      });
      const plan = turnPlan(db, CANYON, DAY);
      expect(plan.turns).toHaveLength(1);
      expect(plan.turns[0]?.spaceCode).toBe('GRAND-B');
    });
  });

  it('is not a turn when the two functions are in different rooms', () => {
    withStore((db) => {
      const booking = house(db);
      seedFunction(db, booking.id, {
        spaceCode: 'ASPEN',
        name: 'Breakout',
        startMinute: 480,
        endMinute: 960,
        expectedCovers: 40,
      });
      seedFunction(db, booking.id, { name: 'Awards Dinner', startMinute: 1080 });
      expect(turnPlan(db, CANYON, DAY).turns).toEqual([]);
    });
  });

  it('pairs each function with the next one only', () => {
    withStore((db) => {
      const booking = house(db);
      seedFunction(db, booking.id, {
        name: 'Breakfast',
        startMinute: 360,
        endMinute: 540,
        setupStyle: 'ROUNDS-10',
      });
      seedFunction(db, booking.id, {
        name: 'Lunch',
        startMinute: 720,
        endMinute: 900,
        setupStyle: 'ROUNDS-10',
      });
      seedFunction(db, booking.id, { name: 'Awards Dinner', startMinute: 1080 });
      const plan = turnPlan(db, CANYON, DAY);
      expect(plan.turns.map((turn) => [turn.fromName, turn.toName])).toEqual([
        ['Breakfast', 'Lunch'],
        ['Lunch', 'Awards Dinner'],
      ]);
    });
  });
});
