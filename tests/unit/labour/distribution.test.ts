import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedTaxProfiles } from '../../support/billing.js';
import { seedStaffingRules } from '../../support/labour.js';
import { addShift } from '../../../src/labour/shifts.js';
import {
  checkDistribution,
  distributeServiceCharge,
  findDistribution,
  listDistributionPoints,
  pointsFor,
  requireDistribution,
  setDistributionPoints,
} from '../../../src/labour/distribution.js';
import { drawPackageCharges, addCharge } from '../../../src/billing/charges.js';
import { invoiceTotals, raiseInvoice, advanceInvoice } from '../../../src/billing/invoice.js';
import type { Database } from '../../../src/store/database.js';

function invoiced(db: Database) {
  const slot = readyFunction(db, { guarantee: 180 });
  seedStaffingRules(db);
  seedTaxProfiles(db);
  drawPackageCharges(db, slot.id);
  const invoice = raiseInvoice(
    db,
    CANYON,
    { bookingId: slot.bookingId, taxProfileCode: 'DENVER' },
    KITCHEN_NOW,
  );
  return { slot, invoice };
}

function crew(db: Database, slot: { id: Parameters<typeof addShift>[1] }): void {
  addShift(
    db,
    slot.id,
    { role: 'SERVER', heads: 12, startMinute: 1020, endMinute: 1380, hourlyMinor: 2200 },
    KITCHEN_NOW,
  );
  addShift(
    db,
    slot.id,
    { role: 'CAPTAIN', heads: 2, startMinute: 960, endMinute: 1380, hourlyMinor: 3400 },
    KITCHEN_NOW,
  );
  addShift(
    db,
    slot.id,
    { role: 'HOUSEMAN', heads: 2, startMinute: 840, endMinute: 1080, hourlyMinor: 2100 },
    KITCHEN_NOW,
  );
}

describe('the points a role earns', () => {
  it('is one where the house has published nothing', () => {
    withStore((db) => {
      const { slot } = invoiced(db);
      expect(slot.id).toBeDefined();
      expect(pointsFor(db, CANYON, 'SERVER')).toBe(1);
      expect(listDistributionPoints(db, CANYON)).toEqual([]);
    });
  });

  it('reads back what the house publishes, and replaces it', () => {
    withStore((db) => {
      invoiced(db);
      setDistributionPoints(db, CANYON, 'server', 10);
      setDistributionPoints(db, CANYON, 'CAPTAIN', 16);
      setDistributionPoints(db, CANYON, 'SERVER', 12);
      expect(pointsFor(db, CANYON, 'SERVER')).toBe(12);
      expect(listDistributionPoints(db, CANYON)).toEqual([
        { role: 'CAPTAIN', points: 16 },
        { role: 'SERVER', points: 12 },
      ]);
    });
  });

  it('refuses a role it does not roster and a negative point', () => {
    withStore((db) => {
      invoiced(db);
      expect(() => setDistributionPoints(db, CANYON, 'SOMMELIER', 10)).toThrow(
        /not a role this house rosters/,
      );
      expect(() => setDistributionPoints(db, CANYON, 'SERVER', -1)).toThrow(/whole number/);
    });
  });
});

describe('splitting the service charge', () => {
  it('hands out the whole pool and not a cent more', () => {
    withStore((db) => {
      const { slot, invoice } = invoiced(db);
      crew(db, slot);
      setDistributionPoints(db, CANYON, 'SERVER', 10);
      setDistributionPoints(db, CANYON, 'CAPTAIN', 16);
      setDistributionPoints(db, CANYON, 'HOUSEMAN', 6);

      const pool = invoiceTotals(db, invoice.id).serviceCharge;
      expect(pool.amount).toBeGreaterThan(0);
      const result = distributeServiceCharge(db, invoice.id, KITCHEN_NOW);
      const total = result.lines.reduce((sum, line) => sum + line.share.amount, 0);
      expect(total).toBe(pool.amount);
      expect(result.lines.map((line) => line.role)).toEqual(['CAPTAIN', 'HOUSEMAN', 'SERVER']);
    });
  });

  it('weighs hours against points rather than either on its own', () => {
    withStore((db) => {
      const { slot, invoice } = invoiced(db);
      crew(db, slot);
      setDistributionPoints(db, CANYON, 'SERVER', 10);
      setDistributionPoints(db, CANYON, 'CAPTAIN', 16);
      setDistributionPoints(db, CANYON, 'HOUSEMAN', 6);
      const lines = distributeServiceCharge(db, invoice.id, KITCHEN_NOW).lines;
      const server = lines.find((line) => line.role === 'SERVER');
      const captain = lines.find((line) => line.role === 'CAPTAIN');
      const houseman = lines.find((line) => line.role === 'HOUSEMAN');

      // Twelve servers for six hours is far more head hours than two captains
      // for seven, and the captain points do not close that gap.
      expect(server?.headHoursThousandths).toBe(72_000);
      expect(captain?.headHoursThousandths).toBe(14_000);
      expect(server?.weight).toBe(720_000);
      expect(captain?.weight).toBe(224_000);
      expect(server?.share.amount).toBeGreaterThan(captain?.share.amount ?? 0);
      expect(captain?.share.amount).toBeGreaterThan(houseman?.share.amount ?? 0);
    });
  });

  it('gives a role with no published points one point rather than nothing', () => {
    withStore((db) => {
      const { slot, invoice } = invoiced(db);
      crew(db, slot);
      setDistributionPoints(db, CANYON, 'SERVER', 10);
      const lines = distributeServiceCharge(db, invoice.id, KITCHEN_NOW).lines;
      expect(lines.find((line) => line.role === 'CAPTAIN')?.points).toBe(1);
      expect(lines.find((line) => line.role === 'CAPTAIN')?.share.amount).toBeGreaterThan(0);
    });
  });

  it('refuses when nobody is rostered', () => {
    withStore((db) => {
      const { invoice } = invoiced(db);
      expect(() => distributeServiceCharge(db, invoice.id, KITCHEN_NOW)).toThrow(
        /nobody is rostered/,
      );
    });
  });

  it('refuses a void invoice', () => {
    withStore((db) => {
      const { slot, invoice } = invoiced(db);
      crew(db, slot);
      advanceInvoice(db, invoice.id, 'VOID', KITCHEN_NOW);
      expect(() => distributeServiceCharge(db, invoice.id, KITCHEN_NOW)).toThrow(
        /is void, there is nothing to hand out/,
      );
    });
  });
});

describe('a split that has already been recorded', () => {
  it('reads back exactly as it was written', () => {
    withStore((db) => {
      const { slot, invoice } = invoiced(db);
      crew(db, slot);
      setDistributionPoints(db, CANYON, 'SERVER', 10);
      const written = distributeServiceCharge(db, invoice.id, KITCHEN_NOW);
      const read = requireDistribution(db, invoice.id);
      expect(read.pool.amount).toBe(written.pool.amount);
      expect(read.lines).toEqual(written.lines);
      expect(read.runAt).toBe(KITCHEN_NOW);
    });
  });

  it('is replaced rather than added to when a shift turns up late', () => {
    withStore((db) => {
      const { slot, invoice } = invoiced(db);
      crew(db, slot);
      const first = distributeServiceCharge(db, invoice.id, KITCHEN_NOW);
      const firstServer = first.lines.find((line) => line.role === 'SERVER')?.share.amount ?? 0;

      addShift(
        db,
        slot.id,
        { role: 'CARVER', heads: 3, startMinute: 1080, endMinute: 1320, hourlyMinor: 2800 },
        KITCHEN_NOW,
      );
      const second = distributeServiceCharge(db, invoice.id, KITCHEN_NOW);
      expect(second.lines).toHaveLength(4);
      expect(second.lines.find((line) => line.role === 'SERVER')?.share.amount).toBeLessThan(
        firstServer,
      );
      expect(second.lines.reduce((sum, line) => sum + line.share.amount, 0)).toBe(
        second.pool.amount,
      );
      expect(requireDistribution(db, invoice.id).lines).toHaveLength(4);
    });
  });

  it('says it is stale once the bill moves under it', () => {
    withStore((db) => {
      const { slot, invoice } = invoiced(db);
      crew(db, slot);
      distributeServiceCharge(db, invoice.id, KITCHEN_NOW);
      expect(checkDistribution(db, invoice.id).addsUp).toBe(true);
      expect(checkDistribution(db, invoice.id).stale).toBe(false);

      addCharge(db, slot.id, {
        category: 'FOOD',
        description: 'late night bites',
        quantity: 180,
        unitMinor: 1_800,
      });
      const check = checkDistribution(db, invoice.id);
      expect(check.stale).toBe(true);
      expect(check.addsUp).toBe(true);
      expect(check.currentPool.amount).toBeGreaterThan(check.recordedPool.amount);
    });
  });

  it('has nothing to read before it is run', () => {
    withStore((db) => {
      const { invoice } = invoiced(db);
      expect(findDistribution(db, invoice.id)).toBeUndefined();
      expect(() => requireDistribution(db, invoice.id)).toThrow(/has not been handed out yet/);
    });
  });
});
