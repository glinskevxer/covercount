import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty } from '../../support/fixtures.js';
import { seedTaxProfiles } from '../../support/billing.js';
import {
  createTaxProfile,
  findTaxProfile,
  listTaxProfiles,
  requireTaxProfile,
  setTaxRate,
  taxRateFor,
  taxRates,
} from '../../../src/billing/tax.js';
import {
  CHARGE_CATEGORIES,
  attractsServiceCharge,
  isChargeCategory,
  isChargeSource,
  isCredit,
  isInvoiceStatus,
  isPaymentKind,
} from '../../../src/billing/types.js';
import { catalogCode } from '../../../src/core/ids.js';
import { formatRate, ratePercent } from '../../../src/core/rate.js';

const code = catalogCode;

describe('the billing vocabularies', () => {
  it('recognises a category, a source, a status and a payment kind', () => {
    for (const category of CHARGE_CATEGORIES) {
      expect(isChargeCategory(category)).toBe(true);
    }
    expect(isChargeCategory('MERCH')).toBe(false);
    expect(isChargeSource('PACKAGE')).toBe(true);
    expect(isChargeSource('GUESS')).toBe(false);
    expect(isInvoiceStatus('ISSUED')).toBe(true);
    expect(isInvoiceStatus('SENT')).toBe(false);
    expect(isPaymentKind('DEPOSIT')).toBe(true);
    expect(isPaymentKind('CHEQUE')).toBe(false);
  });

  it('knows which categories the service charge falls on by default', () => {
    expect(attractsServiceCharge('FOOD')).toBe(true);
    expect(attractsServiceCharge('BEVERAGE')).toBe(true);
    expect(attractsServiceCharge('RENTAL')).toBe(false);
    expect(attractsServiceCharge('AV')).toBe(false);
  });

  it('knows which payments move money towards the property', () => {
    expect(isCredit('DEPOSIT')).toBe(true);
    expect(isCredit('PAYMENT')).toBe(true);
    expect(isCredit('WRITE-OFF')).toBe(true);
    expect(isCredit('REFUND')).toBe(false);
  });
});

describe('creating a tax profile', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      seedProperty(db);
      seedTaxProfiles(db);
      const denver = requireTaxProfile(db, CANYON, code('DENVER'));
      expect(denver.name).toBe('Denver County');
      expect(ratePercent(denver.serviceCharge)).toBe(22);
      expect(formatRate(denver.gratuity)).toBe('0%');
      expect(denver.serviceChargeTaxable).toBe(true);
      expect(denver.createdAt).toBe(FIXED_NOW);
    });
  });

  it('carries the rates it was given, in category order', () => {
    withStore((db) => {
      seedProperty(db);
      seedTaxProfiles(db);
      const rates = taxRates(db, CANYON, code('DENVER'));
      expect(rates.map((row) => row.category)).toEqual([
        'AV',
        'BEVERAGE',
        'FOOD',
        'LABOR',
        'RENTAL',
        'SERVICE',
      ]);
      expect(ratePercent(rates.find((row) => row.category === 'FOOD')!.rate)).toBe(8.81);
    });
  });

  it('lets a second profile disagree about the service charge', () => {
    withStore((db) => {
      seedProperty(db);
      seedTaxProfiles(db);
      const offsite = requireTaxProfile(db, CANYON, code('OFFSITE'));
      expect(offsite.serviceChargeTaxable).toBe(false);
      expect(ratePercent(offsite.gratuity)).toBe(3);
    });
  });
});

describe('refusing a badly formed profile', () => {
  it('refuses a blank name, a negative rate and a duplicate code', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => createTaxProfile(db, CANYON, { code: 'X', name: ' ' }, FIXED_NOW)).toThrow(
        /needs a name/,
      );
      expect(() =>
        createTaxProfile(db, CANYON, { code: 'X', name: 'X', serviceChargePpm: -1 }, FIXED_NOW),
      ).toThrow(/the service charge is whole parts per million/);
      expect(() =>
        createTaxProfile(db, CANYON, { code: 'X', name: 'X', gratuityPpm: 1.5 }, FIXED_NOW),
      ).toThrow(/the gratuity is whole parts per million/);
      createTaxProfile(db, CANYON, { code: 'X', name: 'X' }, FIXED_NOW);
      expect(() => createTaxProfile(db, CANYON, { code: 'X', name: 'X' }, FIXED_NOW)).toThrow(
        /already has a tax profile X/,
      );
    });
  });

  it('leaves nothing behind when a rate on it is refused', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() =>
        createTaxProfile(
          db,
          CANYON,
          { code: 'X', name: 'X', rates: [{ category: 'MERCH', ppm: 1 }] },
          FIXED_NOW,
        ),
      ).toThrow(/not a charge category/);
      expect(findTaxProfile(db, CANYON, code('X'))).toBeUndefined();
    });
  });
});

describe('reading tax rates', () => {
  it('answers zero for a category the profile is silent about', () => {
    withStore((db) => {
      seedProperty(db);
      seedTaxProfiles(db);
      expect(ratePercent(taxRateFor(db, CANYON, code('DENVER'), 'FEE'))).toBe(0);
      expect(ratePercent(taxRateFor(db, CANYON, code('OFFSITE'), 'AV'))).toBe(0);
      expect(ratePercent(taxRateFor(db, CANYON, code('OFFSITE'), 'BEVERAGE'))).toBe(9);
    });
  });

  it('replaces a rate set twice', () => {
    withStore((db) => {
      seedProperty(db);
      seedTaxProfiles(db);
      setTaxRate(db, CANYON, code('DENVER'), 'food', 90_000);
      expect(ratePercent(taxRateFor(db, CANYON, code('DENVER'), 'FOOD'))).toBe(9);
      expect(taxRates(db, CANYON, code('DENVER'))).toHaveLength(6);
    });
  });

  it('refuses a rate on a profile that is not on file', () => {
    withStore((db) => {
      seedProperty(db);
      expect(() => setTaxRate(db, CANYON, code('NOWHERE'), 'FOOD', 1)).toThrow(
        /has no tax profile NOWHERE/,
      );
      expect(() => requireTaxProfile(db, CANYON, code('NOWHERE'))).toThrow(/has no tax profile/);
    });
  });

  it('refuses a rate that is not whole parts per million', () => {
    withStore((db) => {
      seedProperty(db);
      seedTaxProfiles(db);
      expect(() => setTaxRate(db, CANYON, code('DENVER'), 'FOOD', -1)).toThrow(
        /whole parts per million/,
      );
      expect(() => setTaxRate(db, CANYON, code('DENVER'), 'FOOD', 1.5)).toThrow(
        /whole parts per million/,
      );
    });
  });

  it('lists the profiles in code order', () => {
    withStore((db) => {
      seedProperty(db);
      seedTaxProfiles(db);
      expect(listTaxProfiles(db, CANYON).map((row) => row.code)).toEqual(['DENVER', 'OFFSITE']);
    });
  });
});
