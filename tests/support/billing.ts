/**
 * Two tax profiles that disagree about the one thing that matters: whether
 * the service charge is itself taxable.
 */

import { createTaxProfile } from '../../src/billing/tax.js';
import type { Database } from '../../src/store/database.js';
import { CANYON, FIXED_NOW } from './fixtures.js';

export function seedTaxProfiles(db: Database): void {
  createTaxProfile(
    db,
    CANYON,
    {
      code: 'DENVER',
      name: 'Denver County',
      serviceChargePpm: 220_000,
      gratuityPpm: 0,
      serviceChargeTaxable: true,
      rates: [
        { category: 'FOOD', ppm: 88_100 },
        { category: 'BEVERAGE', ppm: 88_100 },
        { category: 'AV', ppm: 88_100 },
        { category: 'SERVICE', ppm: 88_100 },
        { category: 'RENTAL', ppm: 0 },
        { category: 'LABOR', ppm: 0 },
      ],
    },
    FIXED_NOW,
  );
  createTaxProfile(
    db,
    CANYON,
    {
      code: 'OFFSITE',
      name: 'Off site catering',
      serviceChargePpm: 200_000,
      gratuityPpm: 30_000,
      serviceChargeTaxable: false,
      rates: [
        { category: 'FOOD', ppm: 40_000 },
        { category: 'BEVERAGE', ppm: 90_000 },
        { category: 'RENTAL', ppm: 40_000 },
      ],
    },
    FIXED_NOW,
  );
}
