import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedProperty } from '../../support/fixtures.js';
import { seedFullCatalog } from '../../support/menu.js';
import { seedLabour } from '../../support/labour.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { money } from '../../../src/core/money.js';
import { rate, rateFromPercent } from '../../../src/core/rate.js';
import { findPriceOn } from '../../../src/catalog/pricing.js';
import { findLabourRate } from '../../../src/labour/staffing.js';
import { renderRoll, rollSeason, uplifted } from '../../../src/store/season.js';
import type { Database } from '../../../src/store/database.js';

const THIS_SEASON = calendarDate('2025-01-01');
const NEXT_SEASON = calendarDate('2026-01-01');
const RACK = code('RACK-2025');
const TART = code('LOBSTER-UP');

function house(db: Database): void {
  seedProperty(db);
  seedFullCatalog(db);
  seedLabour(db);
}

describe('next season s number', () => {
  it('adds the uplift and rounds to the minor unit', () => {
    expect(uplifted(money(10_000, 'USD'), rateFromPercent(4)).amount).toBe(10_400);
    expect(uplifted(money(1_850, 'USD'), rateFromPercent(3.5)).amount).toBe(1_915);
    expect(uplifted(money(1_850, 'USD'), rate(0)).amount).toBe(1_850);
  });

  it('takes a cut as easily as a rise', () => {
    expect(uplifted(money(10_000, 'USD'), rateFromPercent(-10)).amount).toBe(9_000);
  });
});

describe('rolling the season', () => {
  it('moves every price and every rate onto the new date', () => {
    withStore((db) => {
      house(db);
      const before = findPriceOn(db, CANYON, RACK, 'ITEM', TART, THIS_SEASON);
      expect(before).toBeDefined();

      const roll = rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(4));
      expect(roll.prices).toBeGreaterThan(0);
      expect(roll.labour).toBeGreaterThan(0);
      expect(roll.lines).toHaveLength(roll.prices + roll.labour);

      expect(findPriceOn(db, CANYON, RACK, 'ITEM', TART, NEXT_SEASON)?.amount).toBe(
        uplifted(before ?? money(0, 'USD'), rateFromPercent(4)).amount,
      );
      expect(findPriceOn(db, CANYON, RACK, 'ITEM', TART, THIS_SEASON)?.amount).toBe(before?.amount);
    });
  });

  it('lifts the labour rates by the same figure', () => {
    withStore((db) => {
      house(db);
      const before = findLabourRate(db, CANYON, 'SERVER', THIS_SEASON);
      rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(4));
      expect(findLabourRate(db, CANYON, 'SERVER', NEXT_SEASON)?.amount).toBe(
        uplifted(before ?? money(0, 'USD'), rateFromPercent(4)).amount,
      );
    });
  });

  it('does not compound when it is run twice by accident', () => {
    withStore((db) => {
      house(db);
      rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(4));
      const once = findPriceOn(db, CANYON, RACK, 'ITEM', TART, NEXT_SEASON);
      rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(4));
      expect(findPriceOn(db, CANYON, RACK, 'ITEM', TART, NEXT_SEASON)?.amount).toBe(once?.amount);
    });
  });

  it('writes nothing on a dry run', () => {
    withStore((db) => {
      house(db);
      const roll = rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(4), {
        dryRun: true,
      });
      expect(roll.dryRun).toBe(true);
      expect(roll.lines.length).toBeGreaterThan(0);
      expect(findPriceOn(db, CANYON, RACK, 'ITEM', TART, NEXT_SEASON)?.amount).toBe(
        findPriceOn(db, CANYON, RACK, 'ITEM', TART, THIS_SEASON)?.amount,
      );
    });
  });

  it('leaves a book alone when it is told to', () => {
    withStore((db) => {
      house(db);
      const before = findPriceOn(db, CANYON, RACK, 'ITEM', TART, THIS_SEASON);
      const roll = rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(4), {
        skipBooks: ['rack-2025'],
      });
      expect(roll.prices).toBe(0);
      expect(findPriceOn(db, CANYON, RACK, 'ITEM', TART, NEXT_SEASON)?.amount).toBe(before?.amount);
    });
  });

  it('refuses a backwards roll and an absurd uplift', () => {
    withStore((db) => {
      house(db);
      expect(() => rollSeason(db, CANYON, NEXT_SEASON, THIS_SEASON, rateFromPercent(4))).toThrow(
        /nothing to roll into/,
      );
      expect(() => rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(200))).toThrow(
        /minus half and plus one hundred percent/,
      );
      expect(() => rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(-80))).toThrow(
        /minus half and plus one hundred percent/,
      );
    });
  });

  it('says there is nothing to roll when the date is before everything', () => {
    withStore((db) => {
      house(db);
      const roll = rollSeason(
        db,
        CANYON,
        calendarDate('2020-01-01'),
        calendarDate('2020-06-01'),
        rateFromPercent(4),
      );
      expect(roll.lines).toEqual([]);
      expect(renderRoll(roll)).toContain('nothing in force on that date');
    });
  });
});

describe('printing the roll', () => {
  it('names the dates, the uplift and every line', () => {
    withStore((db) => {
      house(db);
      const text = renderRoll(rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(4)));
      expect(text).toContain('CANYON 2025-01-01 to 2026-01-01, 4% uplift');
      expect(text).toContain('price:RACK-2025');
      expect(text).toContain('labour');
      expect(text).toContain('->');
    });
  });

  it('says nothing was written on a dry run', () => {
    withStore((db) => {
      house(db);
      const text = renderRoll(
        rollSeason(db, CANYON, THIS_SEASON, NEXT_SEASON, rateFromPercent(4), { dryRun: true }),
      );
      expect(text).toContain('nothing written');
    });
  });
});
