import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, seedProperty } from '../../support/fixtures.js';
import { readyFunction } from '../../support/production.js';
import {
  UNIT_FACTOR,
  listProductionFactors,
  productionFactor,
  requireProductionFactor,
  scaleForProduction,
  setProductionFactor,
} from '../../../src/production/factors.js';
import { batchDemand } from '../../../src/production/explode.js';
import { PPM, ratePercent } from '../../../src/core/rate.js';

describe('the production factor', () => {
  it('is one to one where the property is silent', () => {
    withStore((db) => {
      seedProperty(db);
      expect(productionFactor(db, CANYON, 'PLATED')).toEqual(UNIT_FACTOR);
      expect(ratePercent(productionFactor(db, CANYON, 'BUFFET'))).toBe(100);
      expect(listProductionFactors(db, CANYON)).toEqual([]);
    });
  });

  it('reads a published factor back', () => {
    withStore((db) => {
      seedProperty(db);
      const factor = setProductionFactor(db, CANYON, 'buffet', 1_150_000, 'display has to hold up');
      expect(factor.serviceStyle).toBe('BUFFET');
      expect(ratePercent(factor.factor)).toBe(115);
      expect(factor.note).toBe('display has to hold up');
      expect(ratePercent(productionFactor(db, CANYON, 'BUFFET'))).toBe(115);
    });
  });

  it('replaces one set twice and lists them in style order', () => {
    withStore((db) => {
      seedProperty(db);
      setProductionFactor(db, CANYON, 'BUFFET', 1_150_000);
      setProductionFactor(db, CANYON, 'BUFFET', 1_200_000);
      setProductionFactor(db, CANYON, 'STATIONS', 1_250_000);
      expect(listProductionFactors(db, CANYON).map((row) => row.serviceStyle)).toEqual([
        'BUFFET',
        'STATIONS',
      ]);
      expect(ratePercent(productionFactor(db, CANYON, 'BUFFET'))).toBe(120);
    });
  });

  it('refuses a factor under one to one or an absurd one', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => setProductionFactor(db, CANYON, 'BUFFET', PPM - 1)).toThrow(
        /a kitchen cannot make less than it plates/,
      );
      expect(() => setProductionFactor(db, CANYON, 'BUFFET', 4 * PPM)).toThrow(/it is a mistake/);
      expect(() => setProductionFactor(db, CANYON, 'TAPAS', PPM)).toThrow(/not a service style/);
      expect(() => requireProductionFactor(db, CANYON, 'BUFFET')).toThrow(
        /has published no BUFFET production factor/,
      );
    });
  });

  it('rounds a scaled plate count up', () => {
    expect(scaleForProduction(180, UNIT_FACTOR)).toBe(180);
    expect(scaleForProduction(180, { ppm: 1_150_000 })).toBe(207);
    expect(scaleForProduction(181, { ppm: 1_150_000 })).toBe(209);
    expect(scaleForProduction(1, { ppm: 1_150_000 })).toBe(2);
    expect(scaleForProduction(0, { ppm: 1_150_000 })).toBe(0);
    expect(() => scaleForProduction(1.5, UNIT_FACTOR)).toThrow(/whole number/);
  });
});

describe('the factor reaching the batch count', () => {
  it('leaves a plated function alone', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      const rib = batchDemand(db, slot.id).find((row) => row.recipeCode === 'BRAISED-SHORT-RIB');
      expect(rib?.plates).toBe(108);
      expect(rib?.produced).toBe(108);
      expect(rib?.batches).toBe(6);
    });
  });

  it('makes more than the plate count once a factor is published', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setProductionFactor(db, CANYON, 'PLATED', 1_150_000);
      const rib = batchDemand(db, slot.id).find((row) => row.recipeCode === 'BRAISED-SHORT-RIB');
      expect(rib?.plates).toBe(108);
      expect(rib?.produced).toBe(125);
      expect(rib?.batches).toBe(7);
    });
  });

  it('applies the factor before the batching, not after it', () => {
    withStore((db) => {
      const slot = readyFunction(db, { guarantee: 180 });
      setProductionFactor(db, CANYON, 'PLATED', 1_010_000);
      const rib = batchDemand(db, slot.id).find((row) => row.recipeCode === 'BRAISED-SHORT-RIB');
      // 108 plates is six whole batches; a one percent factor is 110, which is
      // a seventh batch. Applying it after the batching would still say six.
      expect(rib?.produced).toBe(110);
      expect(rib?.batches).toBe(6);
      setProductionFactor(db, CANYON, 'PLATED', 1_120_000);
      const raised = batchDemand(db, slot.id).find((row) => row.recipeCode === 'BRAISED-SHORT-RIB');
      expect(raised?.produced).toBe(121);
      expect(raised?.batches).toBe(7);
    });
  });
});
