/**
 * A function that is ready for the kitchen: guaranteed, split and with every
 * special meal decided.
 */

import { seedFunction, seedPropertyAccountBooking } from './fixtures.js';
import { seedFullCatalog } from './menu.js';
import { seedKitchen } from './kitchen.js';
import { openCovers, setGuarantee } from '../../src/covers/guarantee.js';
import { setCourseSplit } from '../../src/covers/selections.js';
import { addSpecialMeal } from '../../src/covers/special.js';
import type { Database } from '../../src/store/database.js';
import type { FunctionSlot } from '../../src/booking/types.js';

export const KITCHEN_NOW = '2025-04-10T09:00:00.000Z';

export interface ReadyFunctionOptions {
  readonly guarantee?: number;
  readonly specialCovers?: number;
  readonly split?: boolean;
  /** The combined ballroom, for a guarantee that will be raised past 200. */
  readonly room?: string;
}

export function readyFunction(db: Database, options: ReadyFunctionOptions = {}): FunctionSlot {
  const guarantee = options.guarantee ?? 180;
  const specialCovers = options.specialCovers ?? 0;

  const booking = seedPropertyAccountBooking(db);
  seedFullCatalog(db);
  seedKitchen(db);
  const slot = seedFunction(db, booking.id, {
    ...(options.room === undefined ? {} : { spaceCode: options.room }),
  });
  openCovers(db, slot.id, {
    packageCode: 'PLATED-THREE',
    priceBookCode: 'RACK-2025',
    contractDate: '2025-01-20',
  });
  setGuarantee(db, slot.id, guarantee, KITCHEN_NOW);

  if (specialCovers > 0) {
    addSpecialMeal(
      db,
      slot.id,
      { diet: 'VEGAN', covers: specialCovers, substituteItemCode: 'ROOT-PLATE' },
      KITCHEN_NOW,
    );
  }

  if (options.split !== false) {
    const standard = guarantee - specialCovers;
    const rib = Math.ceil(standard * 0.6);
    const halibut = standard - rib;
    setCourseSplit(db, slot.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: standard }]);
    setCourseSplit(db, slot.id, 'MAIN', [
      { itemCode: 'SHORT-RIB', covers: rib },
      { itemCode: 'HALIBUT', covers: halibut },
    ]);
    setCourseSplit(db, slot.id, 'DESSERT', [{ itemCode: 'SORBET', covers: standard }]);
  }

  return slot;
}
