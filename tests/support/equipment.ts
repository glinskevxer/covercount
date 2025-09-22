/**
 * A banquet store cupboard, with the rules that pull out of it.
 */

import { createEquipment, setRequirement } from '../../src/equipment/store.js';
import type { Database } from '../../src/store/database.js';
import { CANYON, FIXED_NOW } from './fixtures.js';

export function seedEquipment(db: Database): void {
  const items = [
    { code: 'ROUND-72', name: '72 inch round', kind: 'TABLE', owned: 40 },
    { code: 'BANQUET-CHAIR', name: 'Banquet chair', kind: 'SEATING', owned: 400 },
    { code: 'FLOOR-CLOTH', name: 'Floor length cloth', kind: 'LINEN', owned: 60 },
    { code: 'NAPKIN', name: 'Napkin', kind: 'LINEN', owned: 500 },
    { code: 'PLACE-SETTING', name: 'Place setting', kind: 'CHINA', owned: 320, rentalMinor: 275 },
    { code: 'WINE-GLASS', name: 'Wine glass', kind: 'GLASS', owned: 600 },
    { code: 'LECTERN', name: 'Lectern', kind: 'STAGING', owned: 2 },
    { code: 'CHAFER', name: 'Chafing dish', kind: 'BUFFET', owned: 12, rentalMinor: 1800 },
  ];
  for (const item of items) {
    createEquipment(db, CANYON, item, FIXED_NOW);
  }

  const rules = [
    { setupStyle: 'ROUNDS-10', equipmentCode: 'ROUND-72', perTable: 1 },
    { setupStyle: 'ROUNDS-10', equipmentCode: 'BANQUET-CHAIR', perCover: 1 },
    { setupStyle: 'ROUNDS-10', equipmentCode: 'FLOOR-CLOTH', perTable: 1 },
    { setupStyle: 'ROUNDS-10', equipmentCode: 'NAPKIN', perCover: 1 },
    { setupStyle: 'ROUNDS-10', equipmentCode: 'PLACE-SETTING', perCover: 1 },
    { setupStyle: 'ROUNDS-10', equipmentCode: 'WINE-GLASS', perCover: 2 },
    { setupStyle: 'ROUNDS-10', equipmentCode: 'LECTERN', fixed: 1 },
    { setupStyle: 'RECEPTION', equipmentCode: 'CHAFER', fixed: 4 },
    { setupStyle: 'RECEPTION', equipmentCode: 'WINE-GLASS', perCover: 2 },
  ];
  for (const rule of rules) {
    setRequirement(db, CANYON, rule);
  }
}
