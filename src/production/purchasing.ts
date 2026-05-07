/**
 * The order that actually gets sent to a supplier.
 *
 * A requisition and a purchase order look similar and are not the same
 * document. A requisition draws from the house's own stores and is written per
 * function. A purchase order goes outside, covers a whole week, and has to be
 * netted against what is already in the building or the house pays twice for
 * the same case of beef.
 *
 * The netting is the only interesting part. Demand comes from the recipes,
 * the shelf comes from the last count and the movements since, and the par
 * comes from the chef. Those are three separate numbers from three separate
 * places, and an order that reads only the first one is the mistake this
 * module exists to stop.
 */

import { invalidInput } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { formatQuantity, type Quantity } from '../core/quantity.js';
import type { StoreArea } from './types.js';
import { requireProperty } from '../property/store.js';
import { requireFunction } from '../booking/functions.js';
import { ingredientDemandForFunctions } from './explode.js';
import { orderLine, type OrderLine } from './stock.js';
import { padLeft, padRight, row, sheet } from '../core/layout.js';
import type { Database } from '../store/database.js';

export interface PurchaseLine extends OrderLine {
  readonly name: string;
  readonly store: StoreArea;
  readonly packSize: Quantity;
}

export interface PurchaseSection {
  readonly store: StoreArea;
  readonly lines: PurchaseLine[];
  readonly packs: number;
}

export interface PurchaseOrder {
  readonly propertyCode: CatalogCode;
  readonly functionIds: EntityId<'functionSlot'>[];
  readonly sections: PurchaseSection[];
  readonly packs: number;
  readonly linesDropped: number;
}

/**
 * Draft an order across a set of functions.
 *
 * Lines that net to nothing are counted and dropped rather than printed at
 * zero. A purchasing sheet with forty zero rows on it does not get read, and
 * the count is kept so the chef can see the netting did something.
 */
export function draftPurchaseOrder(
  db: Database,
  functionIds: readonly EntityId<'functionSlot'>[],
): PurchaseOrder {
  if (functionIds.length === 0) {
    throw invalidInput('purchase.functions', 'an order covers at least one function');
  }
  const slots = functionIds.map((id) => requireFunction(db, id));
  const propertyCode = slots[0]?.propertyCode;
  if (propertyCode === undefined) {
    throw invalidInput('purchase.functions', 'an order covers at least one function');
  }
  for (const slot of slots) {
    if (slot.propertyCode !== propertyCode) {
      throw invalidInput(
        'purchase.property',
        'one order cannot cover functions at two properties, the stores are different buildings',
      );
    }
  }
  requireProperty(db, propertyCode);

  const byStore = new Map<StoreArea, PurchaseLine[]>();
  let dropped = 0;
  for (const demand of ingredientDemandForFunctions(db, functionIds)) {
    const netted = orderLine(db, propertyCode, demand.ingredientCode, demand.needed);
    if (netted.packs === 0) {
      dropped += 1;
      continue;
    }
    const line: PurchaseLine = {
      ...netted,
      name: demand.name,
      store: demand.store,
      packSize: demand.packSize,
    };
    const existing = byStore.get(demand.store);
    if (existing === undefined) {
      byStore.set(demand.store, [line]);
    } else {
      existing.push(line);
    }
  }

  const sections = [...byStore.entries()]
    .map(([store, lines]) => ({
      store,
      lines: [...lines].sort((left, right) =>
        left.ingredientCode.localeCompare(right.ingredientCode),
      ),
      packs: lines.reduce((total, line) => total + line.packs, 0),
    }))
    .sort((left, right) => left.store.localeCompare(right.store));

  return {
    propertyCode,
    functionIds: [...functionIds],
    sections,
    packs: sections.reduce((total, section) => total + section.packs, 0),
    linesDropped: dropped,
  };
}

/** The order as a purchasing clerk reads it, one block per store. */
export function renderPurchaseOrder(order: PurchaseOrder): string {
  return sheet({
    heading: `purchase order for ${order.propertyCode}`,
    summary: [
      `${order.functionIds.length} function(s), ${order.packs} pack(s)`,
      ...(order.linesDropped > 0 ? [`${order.linesDropped} line(s) covered by stock on hand`] : []),
    ],
    sections: order.sections.map((section) => ({
      title: `${section.store}  ${section.packs} pack(s)`,
      rows: section.lines.map((line) =>
        row(
          padRight(line.ingredientCode, 16),
          ` need ${padLeft(formatQuantity(line.needed), 12)}`,
          `  have ${padLeft(formatQuantity(line.onHand), 12)}`,
          `  order ${padLeft(line.packs, 3)} x ${formatQuantity(line.packSize)}`,
        ),
      ),
    })),
    whenBare: 'nothing to order',
  });
}
