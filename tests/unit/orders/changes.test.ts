import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedLabour } from '../../support/labour.js';
import {
  CHANGE_STATUSES,
  applyChangeOrder,
  changeOrderLines,
  declineChangeOrder,
  findChangeOrder,
  isChangeStatus,
  listChangeOrders,
  raiseChangeOrder,
  requireChangeOrder,
  unbilledLateChanges,
} from '../../../src/orders/changes.js';
import { drawRevision, listRevisions, liveRevision } from '../../../src/orders/revisions.js';
import { openCovers, setGuarantee } from '../../../src/covers/guarantee.js';
import { seedFunction } from '../../support/fixtures.js';
import { setCourseSplit } from '../../../src/covers/selections.js';
import { buildRoster } from '../../../src/labour/shifts.js';
import { drawPackageCharges, listCharges } from '../../../src/billing/charges.js';
import { parseEntityId } from '../../../src/core/ids.js';
import type { Database } from '../../../src/store/database.js';

const BEFORE_CUTOFF = '2025-04-11T09:00:00.000Z';
const AFTER_CUTOFF = '2025-04-17T09:00:00.000Z';

function drawnAndDrifted(db: Database, at = AFTER_CUTOFF) {
  const slot = readyFunction(db, { guarantee: 180, room: 'GRAND' });
  seedLabour(db);
  buildRoster(db, slot.id, KITCHEN_NOW);
  drawPackageCharges(db, slot.id);
  drawRevision(db, slot.id, KITCHEN_NOW, 'r.okonkwo');
  setGuarantee(db, slot.id, 192, at, 'r.okonkwo');
  setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 192 }]);
  setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 192 }]);
  setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'SORBET', covers: 192 }]);
  return slot;
}

describe('raising a change order', () => {
  it('records what drifted and who asked', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db);
      const change = raiseChangeOrder(
        db,
        slot.id,
        { reason: 'two coaches confirmed late', raisedBy: 'r.okonkwo' },
        AFTER_CUTOFF,
      );
      expect(change.id).toBe('CO-2025-0001');
      expect(change.status).toBe('RAISED');
      expect(change.reason).toBe('two coaches confirmed late');
      expect(change.raisedBy).toBe('r.okonkwo');
      expect(change.afterCutoff).toBe(true);

      const lines = changeOrderLines(db, change.id);
      expect(lines.find((row) => row.field === 'guaranteed')).toEqual({
        field: 'guaranteed',
        was: '180',
        becomes: '192',
      });
    });
  });

  it('knows a change raised before the cutoff is not a late one', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db, BEFORE_CUTOFF);
      const change = raiseChangeOrder(db, slot.id, { reason: 'early move' }, BEFORE_CUTOFF);
      expect(change.afterCutoff).toBe(false);
      expect(change.fee.amount).toBe(0);
    });
  });

  it('refuses a fee on a change raised before the cutoff', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db, BEFORE_CUTOFF);
      expect(() =>
        raiseChangeOrder(db, slot.id, { reason: 'early move', feeMinor: 5000 }, BEFORE_CUTOFF),
      ).toThrow(/cannot carry a late fee/);
    });
  });

  it('refuses a change with no reason and one on a function with no sheet', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db);
      expect(() => raiseChangeOrder(db, slot.id, { reason: '  ' }, AFTER_CUTOFF)).toThrow(
        /needs a reason on it/,
      );
      const bare = seedFunction(db, slot.bookingId, {
        spaceCode: 'ASPEN',
        setupStyle: 'ROUNDS-10',
        expectedCovers: 40,
        startMinute: 660,
        endMinute: 840,
      });
      openCovers(db, bare.id, { contractDate: '2025-01-20' });
      setGuarantee(db, bare.id, 40, AFTER_CUTOFF);
      expect(() => raiseChangeOrder(db, bare.id, { reason: 'x' }, AFTER_CUTOFF)).toThrow(
        /has no banquet event order drawn/,
      );
    });
  });

  it('refuses a change when nothing has drifted', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180, room: 'GRAND' });
      seedLabour(db);
      buildRoster(db, slot.id, KITCHEN_NOW);
      drawPackageCharges(db, slot.id);
      drawRevision(db, slot.id, KITCHEN_NOW);
      expect(() => raiseChangeOrder(db, slot.id, { reason: 'x' }, AFTER_CUTOFF)).toThrow(
        /nothing has moved on/,
      );
    });
  });

  it('refuses a fee that is not a whole amount', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db);
      expect(() =>
        raiseChangeOrder(db, slot.id, { reason: 'x', feeMinor: -1 }, AFTER_CUTOFF),
      ).toThrow(/whole number of minor units/);
    });
  });

  it('recognises its own statuses and answers for one that is missing', () => {
    withStore((db) => {
      drawnAndDrifted(db);
      for (const status of CHANGE_STATUSES) {
        expect(isChangeStatus(status)).toBe(true);
      }
      expect(isChangeStatus('PENDING')).toBe(false);
      const missing = parseEntityId('changeOrder', 'CO-2025-9999');
      expect(findChangeOrder(db, missing, 'USD')).toBeUndefined();
      expect(() => requireChangeOrder(db, missing, 'USD')).toThrow(/is not on file/);
    });
  });
});

describe('applying a change order', () => {
  it('draws a fresh revision and marks the change applied', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db);
      const change = raiseChangeOrder(db, slot.id, { reason: 'late coaches' }, AFTER_CUTOFF);
      const applied = applyChangeOrder(db, change.id, AFTER_CUTOFF, 'r.okonkwo');
      expect(applied.status).toBe('APPLIED');
      expect(applied.appliedAt).toBe(AFTER_CUTOFF);
      expect(listRevisions(db, slot.id)).toHaveLength(2);
      expect(liveRevision(db, slot.id)?.note).toBe(`applied ${change.id}`);
    });
  });

  it('bills the late fee as a charge line', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db);
      const change = raiseChangeOrder(
        db,
        slot.id,
        { reason: 'late coaches', feeMinor: 25_000 },
        AFTER_CUTOFF,
      );
      applyChangeOrder(db, change.id, AFTER_CUTOFF);
      const fee = listCharges(db, slot.id).find((row) => row.source === 'CHANGE-ORDER');
      expect(fee?.category).toBe('FEE');
      expect(fee?.unit.amount).toBe(25_000);
      expect(fee?.serviceable).toBe(false);
      expect(fee?.description).toContain(change.id);
    });
  });

  it('bills nothing when there is no fee', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db);
      const change = raiseChangeOrder(db, slot.id, { reason: 'late coaches' }, AFTER_CUTOFF);
      applyChangeOrder(db, change.id, AFTER_CUTOFF);
      expect(listCharges(db, slot.id).filter((row) => row.source === 'CHANGE-ORDER')).toEqual([]);
    });
  });

  it('refuses to apply the same change twice', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db);
      const change = raiseChangeOrder(db, slot.id, { reason: 'late coaches' }, AFTER_CUTOFF);
      applyChangeOrder(db, change.id, AFTER_CUTOFF);
      expect(() => applyChangeOrder(db, change.id, AFTER_CUTOFF)).toThrow(
        /is applied and cannot be applied again/,
      );
    });
  });

  it('declines one instead, and then refuses to apply it', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db);
      const change = raiseChangeOrder(db, slot.id, { reason: 'late coaches' }, AFTER_CUTOFF);
      expect(declineChangeOrder(db, change.id, 'USD').status).toBe('DECLINED');
      expect(() => declineChangeOrder(db, change.id, 'USD')).toThrow(
        /is declined and cannot be declined/,
      );
      expect(() => applyChangeOrder(db, change.id, AFTER_CUTOFF)).toThrow(
        /is declined and cannot be applied/,
      );
    });
  });
});

describe('reading change orders', () => {
  it('lists them in order and names the unbilled late ones', () => {
    withStore((db) => {
      const slot = drawnAndDrifted(db);
      const first = raiseChangeOrder(
        db,
        slot.id,
        { reason: 'late coaches', feeMinor: 25_000 },
        AFTER_CUTOFF,
      );
      expect(listChangeOrders(db, slot.id).map((row) => row.id)).toEqual([first.id]);
      expect(unbilledLateChanges(db, slot.id).map((row) => row.id)).toEqual([first.id]);
      applyChangeOrder(db, first.id, AFTER_CUTOFF);
      expect(unbilledLateChanges(db, slot.id)).toEqual([]);
    });
  });

  it('is empty on a function nobody has changed', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180, room: 'GRAND' });
      expect(listChangeOrders(db, slot.id)).toEqual([]);
      expect(unbilledLateChanges(db, slot.id)).toEqual([]);
    });
  });
});
