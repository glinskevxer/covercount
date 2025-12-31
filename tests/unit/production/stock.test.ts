import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty } from '../../support/fixtures.js';
import { seedLarder } from '../../support/kitchen.js';
import {
  belowPar,
  countStock,
  countedItems,
  findStockLevel,
  listStockLevels,
  moveStock,
  onHand,
  orderLine,
  requireStockLevel,
  stockMovements,
} from '../../../src/production/stock.js';
import { quantity } from '../../../src/core/quantity.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import type { Database } from '../../../src/store/database.js';

const LATER = '2025-01-21T15:00:00.000Z';

function larder(db: Database): void {
  seedProperty(db);
  seedLarder(db);
}

describe('counting the shelf', () => {
  it('reads back what was counted', () => {
    withStore((db) => {
      larder(db);
      const level = countStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        { onHand: quantity(120, 'LB'), par: quantity(80, 'LB') },
        FIXED_NOW,
      );
      expect(level.onHand.milli).toBe(120_000);
      expect(level.par.milli).toBe(80_000);
      expect(requireStockLevel(db, CANYON, code('SHORT-RIB')).countedAt).toBe(FIXED_NOW);
      expect(countedItems(db, CANYON)).toBe(1);
    });
  });

  it('holds a count in the purchase unit whatever unit it was taken in', () => {
    withStore((db) => {
      larder(db);
      const level = countStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        { onHand: quantity(2, 'OZ') },
        FIXED_NOW,
      );
      expect(level.onHand.unit).toBe('LB');
      expect(level.onHand.milli).toBe(125);
    });
  });

  it('keeps the par when a later count does not mention one', () => {
    withStore((db) => {
      larder(db);
      countStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        { onHand: quantity(120, 'LB'), par: quantity(80, 'LB') },
        FIXED_NOW,
      );
      const second = countStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        { onHand: quantity(60, 'LB') },
        LATER,
      );
      expect(second.par.milli).toBe(80_000);
      expect(second.onHand.milli).toBe(60_000);
    });
  });

  it('refuses a negative shelf and a negative par', () => {
    withStore((db) => {
      larder(db);
      expect(() =>
        countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(-1, 'LB') }, FIXED_NOW),
      ).toThrow(/less than nothing/);
      expect(() =>
        countStock(
          db,
          CANYON,
          code('SHORT-RIB'),
          { onHand: quantity(1, 'LB'), par: quantity(-1, 'LB') },
          FIXED_NOW,
        ),
      ).toThrow(/nil or more/);
    });
  });

  it('says nothing rather than failing for an ingredient nobody counted', () => {
    withStore((db) => {
      larder(db);
      expect(findStockLevel(db, CANYON, code('BUTTER'))).toBeUndefined();
      expect(onHand(db, CANYON, code('BUTTER')).milli).toBe(0);
      expect(onHand(db, CANYON, code('BUTTER')).unit).toBe('LB');
      expect(() => requireStockLevel(db, CANYON, code('BUTTER'))).toThrow(/never been counted/);
    });
  });
});

describe('moving stock without recounting it', () => {
  it('issues and receives against the running figure', () => {
    withStore((db) => {
      larder(db);
      countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(120, 'LB') }, FIXED_NOW);
      moveStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        quantity(-40, 'LB'),
        'issue',
        LATER,
        'REQ-2025-0001',
      );
      expect(onHand(db, CANYON, code('SHORT-RIB')).milli).toBe(80_000);
      moveStock(db, CANYON, code('SHORT-RIB'), quantity(200, 'LB'), 'receive', LATER, 'PO-4471');
      expect(onHand(db, CANYON, code('SHORT-RIB')).milli).toBe(280_000);
    });
  });

  it('will not issue what is not there', () => {
    withStore((db) => {
      larder(db);
      countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(30, 'LB') }, FIXED_NOW);
      expect(() =>
        moveStock(db, CANYON, code('SHORT-RIB'), quantity(-31, 'LB'), 'ISSUE', LATER),
      ).toThrow(/not that much SHORT-RIB on the shelf/);
      expect(onHand(db, CANYON, code('SHORT-RIB')).milli).toBe(30_000);
    });
  });

  it('refuses a movement with no reason on it', () => {
    withStore((db) => {
      larder(db);
      countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(30, 'LB') }, FIXED_NOW);
      expect(() =>
        moveStock(db, CANYON, code('SHORT-RIB'), quantity(1, 'LB'), '   ', LATER),
      ).toThrow(/needs a reason/);
    });
  });

  it('leaves a trail the next count can be read against', () => {
    withStore((db) => {
      larder(db);
      countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(120, 'LB') }, FIXED_NOW);
      moveStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        quantity(-40, 'LB'),
        'ISSUE',
        LATER,
        'REQ-2025-0001',
      );
      countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(72, 'LB') }, LATER);
      const trail = stockMovements(db, CANYON, code('SHORT-RIB'));
      expect(trail.map((move) => move.reason)).toEqual(['COUNT', 'ISSUE', 'COUNT']);
      expect(trail[0]?.moved.milli).toBe(120_000);
      expect(trail[1]?.reference).toBe('REQ-2025-0001');
      // The recount says eight pounds walked off between the two counts.
      expect(trail[2]?.moved.milli).toBe(-8_000);
    });
  });
});

describe('turning a requirement into an order', () => {
  it('adds the par to the need and takes off the shelf', () => {
    withStore((db) => {
      larder(db);
      countStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        { onHand: quantity(30, 'LB'), par: quantity(50, 'LB') },
        FIXED_NOW,
      );
      const line = orderLine(db, CANYON, code('SHORT-RIB'), quantity(100, 'LB'));
      expect(line.gap.milli).toBe(120_000);
      expect(line.packs).toBe(3);
    });
  });

  it('rounds up to whole packs because a supplier sells cases', () => {
    withStore((db) => {
      larder(db);
      countStock(db, CANYON, code('SHORT-RIB'), { onHand: quantity(0, 'LB') }, FIXED_NOW);
      expect(orderLine(db, CANYON, code('SHORT-RIB'), quantity(41, 'LB')).packs).toBe(2);
      expect(orderLine(db, CANYON, code('SHORT-RIB'), quantity(40, 'LB')).packs).toBe(1);
      expect(orderLine(db, CANYON, code('SHORT-RIB'), quantity(1, 'OZ')).packs).toBe(1);
    });
  });

  it('orders nothing when the shelf already covers need and par', () => {
    withStore((db) => {
      larder(db);
      countStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        { onHand: quantity(400, 'LB'), par: quantity(50, 'LB') },
        FIXED_NOW,
      );
      const line = orderLine(db, CANYON, code('SHORT-RIB'), quantity(100, 'LB'));
      expect(line.gap.milli).toBe(0);
      expect(line.packs).toBe(0);
    });
  });

  it('treats an uncounted ingredient as an empty shelf', () => {
    withStore((db) => {
      larder(db);
      const line = orderLine(db, CANYON, code('BUTTER'), quantity(50, 'LB'));
      expect(line.onHand.milli).toBe(0);
      expect(line.gap.milli).toBe(50_000);
      expect(line.packs).toBe(2);
    });
  });
});

describe('the reorder report', () => {
  it('lists only what sits under its par', () => {
    withStore((db) => {
      larder(db);
      countStock(
        db,
        CANYON,
        code('SHORT-RIB'),
        { onHand: quantity(30, 'LB'), par: quantity(50, 'LB') },
        FIXED_NOW,
      );
      countStock(
        db,
        CANYON,
        code('BUTTER'),
        { onHand: quantity(80, 'LB'), par: quantity(36, 'LB') },
        FIXED_NOW,
      );
      countStock(
        db,
        CANYON,
        code('SUGAR'),
        { onHand: quantity(25, 'LB'), par: quantity(25, 'LB') },
        FIXED_NOW,
      );
      expect(belowPar(db, CANYON).map((level) => level.ingredientCode)).toEqual(['SHORT-RIB']);
      expect(listStockLevels(db, CANYON)).toHaveLength(3);
    });
  });
});
