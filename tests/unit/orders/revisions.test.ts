import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedLabour } from '../../support/labour.js';
import {
  ORDER_STATUSES,
  distributeRevision,
  drawRevision,
  findRevision,
  isOrderStatus,
  listRevisions,
  liveRevision,
  renderRevision,
  requireRevision,
  revisionBody,
  revisionDrift,
  revisionIsStale,
  signRevision,
} from '../../../src/orders/revisions.js';
import { setGuarantee } from '../../../src/covers/guarantee.js';
import { setCourseSplit } from '../../../src/covers/selections.js';
import { buildRoster } from '../../../src/labour/shifts.js';
import { drawPackageCharges } from '../../../src/billing/charges.js';
import { parseEntityId } from '../../../src/core/ids.js';
import type { Database } from '../../../src/store/database.js';

const LATER = '2025-04-11T09:00:00.000Z';

function ready(db: Database) {
  const slot = readyFunction(db, { guarantee: 180 });
  seedLabour(db);
  buildRoster(db, slot.id, KITCHEN_NOW);
  drawPackageCharges(db, slot.id);
  return slot;
}

describe('drawing a revision', () => {
  it('starts at revision zero as a draft', () => {
    withStore((db) => {
      const slot = ready(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW, 'r.okonkwo', 'first pass');
      expect(drawn.revision).toBe(0);
      expect(drawn.status).toBe('DRAFT');
      expect(drawn.drawnBy).toBe('r.okonkwo');
      expect(drawn.note).toBe('first pass');
      expect(drawn.signedAt).toBeUndefined();
    });
  });

  it('numbers each new revision and supersedes the last', () => {
    withStore((db) => {
      const slot = ready(db);
      const first = drawRevision(db, slot.id, KITCHEN_NOW);
      const second = drawRevision(db, slot.id, LATER);
      expect(second.revision).toBe(1);
      expect(requireRevision(db, first.id).status).toBe('SUPERSEDED');
      expect(liveRevision(db, slot.id)?.id).toBe(second.id);
      expect(listRevisions(db, slot.id)).toHaveLength(2);
    });
  });

  it('freezes the document as it stood', () => {
    withStore((db) => {
      const slot = ready(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      expect(revisionBody(db, drawn.id).covers.guaranteed).toBe(180);

      setGuarantee(db, slot.id, 190, LATER);
      setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 190 }]);
      expect(revisionBody(db, drawn.id).covers.guaranteed).toBe(180);
    });
  });

  it('answers for one that is not on file', () => {
    withStore((db) => {
      ready(db);
      const missing = parseEntityId('beo', 'BEO-2025-9999');
      expect(findRevision(db, missing)).toBeUndefined();
      expect(() => requireRevision(db, missing)).toThrow(/is not on file/);
      expect(() => revisionBody(db, missing)).toThrow(/is not on file/);
    });
  });

  it('recognises its own statuses', () => {
    for (const status of ORDER_STATUSES) {
      expect(isOrderStatus(status)).toBe(true);
    }
    expect(isOrderStatus('SENT')).toBe(false);
  });
});

describe('moving a revision along', () => {
  it('goes draft to distributed to signed', () => {
    withStore((db) => {
      const slot = ready(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      expect(distributeRevision(db, drawn.id).status).toBe('DISTRIBUTED');
      const signed = signRevision(db, drawn.id, 'A Fenwick', LATER);
      expect(signed.status).toBe('SIGNED');
      expect(signed.signedBy).toBe('A Fenwick');
      expect(signed.signedAt).toBe(LATER);
    });
  });

  it('refuses to distribute a sheet that still carries warnings', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      expect(() => distributeRevision(db, drawn.id)).toThrow(/still carries/);
    });
  });

  it('refuses to sign a draft that was never distributed', () => {
    withStore((db) => {
      const slot = ready(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      expect(() => signRevision(db, drawn.id, 'A Fenwick', LATER)).toThrow(
        /a DRAFT banquet event order cannot become SIGNED/,
      );
    });
  });

  it('refuses a signature with no name and refuses to move a signed sheet', () => {
    withStore((db) => {
      const slot = ready(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      distributeRevision(db, drawn.id);
      expect(() => signRevision(db, drawn.id, '  ', LATER)).toThrow(/needs a name on it/);
      signRevision(db, drawn.id, 'A Fenwick', LATER);
      expect(() => distributeRevision(db, drawn.id)).toThrow(
        /a SIGNED banquet event order cannot become DISTRIBUTED/,
      );
    });
  });

  it('does not supersede a signed revision when a new one is drawn', () => {
    withStore((db) => {
      const slot = ready(db);
      const first = drawRevision(db, slot.id, KITCHEN_NOW);
      distributeRevision(db, first.id);
      signRevision(db, first.id, 'A Fenwick', LATER);
      drawRevision(db, slot.id, LATER);
      expect(requireRevision(db, first.id).status).toBe('SIGNED');
    });
  });
});

describe('drift against the live sheet', () => {
  it('reports nothing has moved straight after it is drawn', () => {
    withStore((db) => {
      const slot = ready(db);
      drawRevision(db, slot.id, KITCHEN_NOW);
      expect(revisionIsStale(db, slot.id)).toBe(false);
      expect(revisionDrift(db, slot.id)).toEqual([]);
    });
  });

  it('reports stale when there is no sheet at all', () => {
    withStore((db) => {
      const slot = ready(db);
      expect(revisionIsStale(db, slot.id)).toBe(true);
      expect(revisionDrift(db, slot.id)).toEqual([]);
    });
  });

  it('names the cover count when the guarantee moves', () => {
    withStore((db) => {
      const slot = ready(db);
      drawRevision(db, slot.id, KITCHEN_NOW);
      setGuarantee(db, slot.id, 190, LATER);
      expect(revisionIsStale(db, slot.id)).toBe(true);
      const drift = revisionDrift(db, slot.id);
      expect(drift.find((row) => row.field === 'guaranteed')).toEqual({
        field: 'guaranteed',
        was: '180',
        becomes: '190',
      });
      expect(drift.find((row) => row.field === 'setFor')?.becomes).toBe('200');
    });
  });

  it('names the menu when the split moves', () => {
    withStore((db) => {
      const slot = ready(db);
      drawRevision(db, slot.id, KITCHEN_NOW);
      setCourseSplit(db, slot.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 180 }]);
      expect(revisionDrift(db, slot.id).map((row) => row.field)).toContain('menu');
    });
  });
});

describe('rendering a revision', () => {
  it('prints the header and the frozen sheet', () => {
    withStore((db) => {
      const slot = ready(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      const text = renderRevision(db, drawn.id);
      expect(text).toContain(`${drawn.id} revision 0, draft`);
      expect(text).toContain('BANQUET EVENT ORDER');
      expect(text).toContain('====');
    });
  });
});
