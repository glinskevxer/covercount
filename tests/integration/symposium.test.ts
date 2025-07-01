/**
 * One booking, from the first phone call to the settled invoice.
 *
 * The point of this test is the joins. Every module has its own unit tests;
 * what nothing else checks is that raising the guarantee moves the plate
 * count, the requisition, the roster and the invoice together, and that a
 * special meal comes out of the guarantee at every one of those places rather
 * than being added on at one of them.
 */

import { describe, expect, it } from 'vitest';
import { withStore } from '../support/store.js';
import { CANYON, seedAccount, seedFullProperty } from '../support/fixtures.js';
import { seedFullCatalog } from '../support/menu.js';
import { seedKitchen } from '../support/kitchen.js';
import { seedLabour } from '../support/labour.js';
import { seedTaxProfiles } from '../support/billing.js';
import { createBooking } from '../../src/booking/store.js';
import { addFunction } from '../../src/booking/functions.js';
import { makeDefinite, makeTentative } from '../../src/booking/lifecycle.js';
import { openCovers, recordServed, setGuarantee } from '../../src/covers/guarantee.js';
import { addSpecialMeal } from '../../src/covers/special.js';
import { coverBreakdown } from '../../src/covers/special.js';
import { setCourseSplit, splitsAddUp } from '../../src/covers/selections.js';
import { ingredientDemand, plateDemand } from '../../src/production/explode.js';
import { raiseRequisition, requisitionLines } from '../../src/production/requisitions.js';
import { buildRoster, rosterSummary } from '../../src/labour/shifts.js';
import { drawPackageCharges } from '../../src/billing/charges.js';
import {
  advanceInvoice,
  invoiceTotals,
  raiseInvoice,
  recordPayment,
} from '../../src/billing/invoice.js';
import { formatMoney } from '../../src/core/money.js';
import type { Database } from '../../src/store/database.js';

const SOLD = '2025-01-20T15:00:00.000Z';
const BEFORE_CUTOFF = '2025-04-10T09:00:00.000Z';
const AFTER_CUTOFF = '2025-04-17T09:00:00.000Z';
const SERVICE_NIGHT = '2025-04-19T05:00:00.000Z';

function sellTheSymposium(db: Database) {
  seedFullProperty(db);
  seedAccount(db);
  seedFullCatalog(db);
  seedKitchen(db);
  seedLabour(db);
  seedTaxProfiles(db);

  const booking = createBooking(
    db,
    CANYON,
    {
      postAs: 'Fenwick Annual Symposium',
      arrivalDate: '2025-04-17',
      departureDate: '2025-04-19',
      accountCode: 'FENWICK',
      salesManager: 'r.okonkwo',
    },
    SOLD,
  );

  const dinner = addFunction(
    db,
    booking.id,
    {
      spaceCode: 'GRAND',
      name: 'Awards Dinner',
      serviceDate: '2025-04-18',
      startMinute: 1080,
      endMinute: 1380,
      setupStyle: 'ROUNDS-10',
      serviceStyle: 'PLATED',
      expectedCovers: 180,
    },
    SOLD,
    'r.okonkwo',
  );

  makeTentative(db, booking.id, SOLD, 'r.okonkwo');
  makeDefinite(db, booking.id, SOLD, 'r.okonkwo');
  openCovers(db, dinner.id, {
    packageCode: 'PLATED-THREE',
    priceBookCode: 'RACK-2025',
    contractDate: '2025-01-20',
  });

  return { booking, dinner };
}

function splitTo(db: Database, dinnerId: Parameters<typeof setCourseSplit>[1], standard: number) {
  const rib = Math.ceil(standard * 0.6);
  setCourseSplit(db, dinnerId, 'STARTER', [{ itemCode: 'BEET-TART', covers: standard }]);
  setCourseSplit(db, dinnerId, 'MAIN', [
    { itemCode: 'SHORT-RIB', covers: rib },
    { itemCode: 'HALIBUT', covers: standard - rib },
  ]);
  setCourseSplit(db, dinnerId, 'DESSERT', [{ itemCode: 'SORBET', covers: standard }]);
}

describe('the Fenwick symposium, sold to settled', () => {
  it('walks the whole thing and every number agrees at the end', () => {
    withStore((db) => {
      const { booking, dinner } = sellTheSymposium(db);

      setGuarantee(db, dinner.id, 180, BEFORE_CUTOFF, 'r.okonkwo');
      addSpecialMeal(
        db,
        dinner.id,
        { guestName: 'A Okafor', covers: 12, diet: 'VEGAN', substituteItemCode: 'ROOT-PLATE' },
        BEFORE_CUTOFF,
      );
      splitTo(db, dinner.id, 168);
      expect(splitsAddUp(db, dinner.id)).toBe(true);

      const breakdown = coverBreakdown(db, dinner.id);
      expect(breakdown.guaranteed).toBe(180);
      expect(breakdown.special).toBe(12);
      expect(breakdown.standard).toBe(168);
      expect(breakdown.setFor).toBe(189);

      const plates = plateDemand(db, dinner.id);
      expect(plates.reduce((total, row) => total + row.plates, 0)).toBe(168 * 3 + 12);

      const roster = buildRoster(db, dinner.id, BEFORE_CUTOFF);
      expect(roster.find((row) => row.role === 'SERVER')?.heads).toBe(12);

      const butcher = raiseRequisition(
        db,
        CANYON,
        { serviceDate: '2025-04-18', store: 'BUTCHER', functionIds: [dinner.id] },
        BEFORE_CUTOFF,
      );
      expect(requisitionLines(db, butcher.id)[0]?.packs).toBe(4);

      setGuarantee(db, dinner.id, 192, AFTER_CUTOFF, 'r.okonkwo');
      splitTo(db, dinner.id, 180);
      expect(splitsAddUp(db, dinner.id)).toBe(true);
      expect(coverBreakdown(db, dinner.id).setFor).toBe(202);
      expect(buildRoster(db, dinner.id, AFTER_CUTOFF).find((r) => r.role === 'SERVER')?.heads).toBe(
        13,
      );

      recordServed(db, dinner.id, 188, SERVICE_NIGHT);
      drawPackageCharges(db, dinner.id);

      const invoice = raiseInvoice(
        db,
        CANYON,
        { bookingId: booking.id, taxProfileCode: 'DENVER' },
        SERVICE_NIGHT,
      );
      const totals = invoiceTotals(db, invoice.id);
      expect(formatMoney(totals.net)).toBe('$17,184.00');

      advanceInvoice(db, invoice.id, 'ISSUED', SERVICE_NIGHT);
      recordPayment(
        db,
        invoice.id,
        { kind: 'PAYMENT', amountMinor: totals.gross.amount, reference: 'wire 8812' },
        SERVICE_NIGHT,
      );
      expect(invoiceTotals(db, invoice.id).balance.amount).toBe(0);
      expect(advanceInvoice(db, invoice.id, 'PAID', SERVICE_NIGHT).status).toBe('PAID');
    });
  });
});

describe('what moves when the guarantee moves', () => {
  it('carries the raise through the plates, the stores, the roster and the bill', () => {
    withStore((db) => {
      const { booking, dinner } = sellTheSymposium(db);
      setGuarantee(db, dinner.id, 100, BEFORE_CUTOFF);
      splitTo(db, dinner.id, 100);

      const beforePlates = plateDemand(db, dinner.id);
      const beforeStores = ingredientDemand(db, dinner.id);
      const beforeRoster = rosterSummary(db, dinner.id);
      buildRoster(db, dinner.id, BEFORE_CUTOFF);
      const beforeCrew = rosterSummary(db, dinner.id);
      drawPackageCharges(db, dinner.id);
      const firstInvoice = raiseInvoice(
        db,
        CANYON,
        { bookingId: booking.id, taxProfileCode: 'DENVER' },
        BEFORE_CUTOFF,
      );
      const beforeGross = invoiceTotals(db, firstInvoice.id).gross.amount;

      expect(beforeRoster.heads).toBe(0);
      expect(beforeCrew.heads).toBeGreaterThan(0);

      setGuarantee(db, dinner.id, 200, BEFORE_CUTOFF);
      splitTo(db, dinner.id, 200);
      buildRoster(db, dinner.id, BEFORE_CUTOFF);
      drawPackageCharges(db, dinner.id);

      const afterPlates = plateDemand(db, dinner.id);
      const afterStores = ingredientDemand(db, dinner.id);
      const afterCrew = rosterSummary(db, dinner.id);
      const afterGross = invoiceTotals(db, firstInvoice.id).gross.amount;

      const sumPlates = (rows: typeof beforePlates) =>
        rows.reduce((total, row) => total + row.plates, 0);
      expect(sumPlates(afterPlates)).toBe(sumPlates(beforePlates) * 2);
      expect(afterCrew.heads).toBeGreaterThan(beforeCrew.heads);
      expect(afterGross).toBeGreaterThan(beforeGross);

      const ribBefore = beforeStores.find((row) => row.ingredientCode === 'SHORT-RIB');
      const ribAfter = afterStores.find((row) => row.ingredientCode === 'SHORT-RIB');
      expect(ribAfter!.needed.milli).toBeGreaterThan(ribBefore!.needed.milli);
    });
  });

  it('does not let a special meal add a plate to the count', () => {
    withStore((db) => {
      const { dinner } = sellTheSymposium(db);
      setGuarantee(db, dinner.id, 100, BEFORE_CUTOFF);
      splitTo(db, dinner.id, 100);
      const without = plateDemand(db, dinner.id).reduce((total, row) => total + row.plates, 0);

      addSpecialMeal(
        db,
        dinner.id,
        { covers: 10, diet: 'VEGAN', substituteItemCode: 'ROOT-PLATE' },
        BEFORE_CUTOFF,
      );
      splitTo(db, dinner.id, 90);
      const withSpecials = plateDemand(db, dinner.id).reduce((total, row) => total + row.plates, 0);

      expect(without).toBe(300);
      expect(withSpecials).toBe(280);
      expect(coverBreakdown(db, dinner.id).guaranteed).toBe(100);
    });
  });
});
