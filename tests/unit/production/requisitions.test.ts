import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import {
  advanceRequisition,
  findRequisition,
  listRequisitions,
  raiseRequisition,
  refreshRequisition,
  requireRequisition,
  requisitionLines,
  totalPacks,
} from '../../../src/production/requisitions.js';
import { setGuarantee } from '../../../src/covers/guarantee.js';
import { setCourseSplit } from '../../../src/covers/selections.js';
import { parseEntityId } from '../../../src/core/ids.js';
import { formatQuantity } from '../../../src/core/quantity.js';
import type { Database } from '../../../src/store/database.js';

function raise(db: Database, slotId: string, store = 'BUTCHER', date = '2025-04-18') {
  return raiseRequisition(
    db,
    CANYON,
    { serviceDate: date, store, functionIds: [slotId] },
    KITCHEN_NOW,
  );
}

describe('raising a requisition', () => {
  it('draws one store out of a function and numbers it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const raised = raise(db, slot.id);
      expect(raised.id).toBe('RQ-2025-0001');
      expect(raised.store).toBe('BUTCHER');
      expect(raised.status).toBe('DRAFT');
      expect(raised.serviceDate).toBe('2025-04-18');
      expect(raised.createdAt).toBe(KITCHEN_NOW);
    });
  });

  it('carries the lines the explosion produced', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const raised = raise(db, slot.id);
      const lines = requisitionLines(db, raised.id);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.ingredientCode).toBe('SHORT-RIB');
      expect(formatQuantity(lines[0]!.needed)).toBe('147.696 LB');
      expect(lines[0]?.packs).toBe(4);
      expect(totalPacks(db, raised.id)).toBe(4);
    });
  });

  it('refuses a store with nothing in it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(() => raise(db, slot.id, 'NONFOOD')).toThrow(
        /nothing on those functions comes out of NONFOOD/,
      );
    });
  });

  it('refuses an unknown store, a bad date and no functions', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      expect(() => raise(db, slot.id, 'WINE')).toThrow(/not a store this kitchen keeps/);
      expect(() => raise(db, slot.id, 'DRY', 'Friday')).toThrow(/YYYY-MM-DD/);
      expect(() =>
        raiseRequisition(
          db,
          CANYON,
          { serviceDate: '2025-04-18', store: 'DRY', functionIds: [] },
          KITCHEN_NOW,
        ),
      ).toThrow(/at least one function on it/);
    });
  });

  it('answers for one that is not on file', () => {
    withStore((db) => {
      readyFunction(db, { guarantee: 180 });
      const missing = parseEntityId('requisition', 'RQ-2025-9999');
      expect(findRequisition(db, missing)).toBeUndefined();
      expect(() => requireRequisition(db, missing)).toThrow(/is not on file/);
      expect(requisitionLines(db, missing)).toEqual([]);
    });
  });
});

describe('listing requisitions', () => {
  it('filters by date, store and status', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const butcher = raise(db, slot.id, 'BUTCHER');
      raise(db, slot.id, 'DRY');
      expect(listRequisitions(db, CANYON)).toHaveLength(2);
      expect(listRequisitions(db, CANYON, { store: 'DRY' })).toHaveLength(1);
      expect(listRequisitions(db, CANYON, { serviceDate: '2025-04-19' })).toHaveLength(0);
      advanceRequisition(db, butcher.id, 'ISSUED');
      expect(listRequisitions(db, CANYON, { status: 'ISSUED' })).toHaveLength(1);
      expect(() => listRequisitions(db, CANYON, { status: 'SENT' })).toThrow(
        /not a requisition status/,
      );
    });
  });
});

describe('moving a requisition along', () => {
  it('goes draft to issued to picked', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const raised = raise(db, slot.id);
      expect(advanceRequisition(db, raised.id, 'issued').status).toBe('ISSUED');
      expect(advanceRequisition(db, raised.id, 'PICKED').status).toBe('PICKED');
    });
  });

  it('refuses to skip a stage or to move a picked one', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const raised = raise(db, slot.id);
      expect(() => advanceRequisition(db, raised.id, 'PICKED')).toThrow(
        /a DRAFT requisition cannot become PICKED/,
      );
      advanceRequisition(db, raised.id, 'ISSUED');
      advanceRequisition(db, raised.id, 'PICKED');
      expect(() => advanceRequisition(db, raised.id, 'CANCELLED')).toThrow(
        /a PICKED requisition cannot become CANCELLED/,
      );
    });
  });

  it('is a no operation when it is already there', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const raised = raise(db, slot.id);
      expect(advanceRequisition(db, raised.id, 'DRAFT').status).toBe('DRAFT');
      expect(() => advanceRequisition(db, raised.id, 'SENT')).toThrow(/not a requisition status/);
    });
  });
});

describe('redrawing a draft', () => {
  it('follows the guarantee when it moves', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const raised = raise(db, slot.id);
      expect(requisitionLines(db, raised.id)[0]?.packs).toBe(4);

      setGuarantee(db, slot.id, 60, KITCHEN_NOW);
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 60 }]);
      setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 60 }]);
      setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'SORBET', covers: 60 }]);

      const redrawn = refreshRequisition(db, raised.id, [slot.id]);
      expect(redrawn[0]?.packs).toBe(2);
    });
  });

  it('refuses to redraw one that has left the office', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const raised = raise(db, slot.id);
      advanceRequisition(db, raised.id, 'ISSUED');
      expect(() => refreshRequisition(db, raised.id, [slot.id])).toThrow(
        /is ISSUED and cannot be redrawn/,
      );
    });
  });
});
