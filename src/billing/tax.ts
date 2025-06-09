/**
 * Tax profiles.
 *
 * A profile is a jurisdiction plus a house policy: the service charge and the
 * gratuity the property adds, whether the service charge is itself taxable,
 * and a sales tax rate per charge category. A property can carry more than
 * one because a hotel that runs an off site catering arm bills that under a
 * different set of rates from the ballroom.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { rate, ZERO_RATE, type Rate } from '../core/rate.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import { isChargeCategory, type ChargeCategory, type TaxProfile, type TaxRate } from './types.js';

interface ProfileRow {
  property_code: string;
  code: string;
  name: string;
  service_charge_ppm: number;
  gratuity_ppm: number;
  service_charge_taxable: number;
  created_at: string;
}

function toProfile(row: ProfileRow): TaxProfile {
  return {
    propertyCode: catalogCode(row.property_code),
    code: catalogCode(row.code),
    name: row.name,
    serviceCharge: rate(row.service_charge_ppm),
    gratuity: rate(row.gratuity_ppm),
    serviceChargeTaxable: row.service_charge_taxable === 1,
    createdAt: row.created_at,
  };
}

export interface CreateTaxProfileInput {
  readonly code: string;
  readonly name: string;
  readonly serviceChargePpm?: number;
  readonly gratuityPpm?: number;
  readonly serviceChargeTaxable?: boolean;
  readonly rates?: readonly { category: string; ppm: number }[];
}

export function createTaxProfile(
  db: Database,
  propertyCode: CatalogCode,
  input: CreateTaxProfileInput,
  now: string,
): TaxProfile {
  requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  const name = input.name.trim();
  if (name.length === 0) {
    throw invalidInput('tax.name', 'a tax profile needs a name');
  }
  const serviceChargePpm = input.serviceChargePpm ?? 0;
  const gratuityPpm = input.gratuityPpm ?? 0;
  for (const [label, value] of [
    ['service charge', serviceChargePpm],
    ['gratuity', gratuityPpm],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw invalidInput('tax.rate', `the ${label} is whole parts per million, zero or more`);
    }
  }

  return inTransaction(db, (handle) => {
    const clash = handle
      .prepare<
        [string, string],
        { code: string }
      >('select code from tax_profile where property_code = ? and code = ?')
      .get(propertyCode, code);
    if (clash !== undefined) {
      throw conflict('tax.exists', `${propertyCode} already has a tax profile ${code}`, code);
    }
    handle
      .prepare(
        `insert into tax_profile (property_code, code, name, service_charge_ppm, gratuity_ppm,
          service_charge_taxable, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        propertyCode,
        code,
        name,
        serviceChargePpm,
        gratuityPpm,
        input.serviceChargeTaxable === false ? 0 : 1,
        now,
      );
    for (const entry of input.rates ?? []) {
      setTaxRate(handle, propertyCode, code, entry.category, entry.ppm);
    }
    return requireTaxProfile(handle, propertyCode, code);
  });
}

export function setTaxRate(
  db: Database,
  propertyCode: CatalogCode,
  profileCode: CatalogCode,
  category: string,
  ppm: number,
): TaxRate {
  requireTaxProfile(db, propertyCode, profileCode);
  const normalised = category.trim().toUpperCase();
  if (!isChargeCategory(normalised)) {
    throw invalidInput('tax.category', `${category} is not a charge category`);
  }
  if (!Number.isSafeInteger(ppm) || ppm < 0) {
    throw invalidInput('tax.rate', 'a tax rate is whole parts per million, zero or more');
  }
  db.prepare(
    `insert into tax_rate (property_code, profile_code, category, rate_ppm)
     values (?, ?, ?, ?)
     on conflict (property_code, profile_code, category) do update set rate_ppm = excluded.rate_ppm`,
  ).run(propertyCode, profileCode, normalised, ppm);
  return { category: normalised, rate: rate(ppm) };
}

export function findTaxProfile(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): TaxProfile | undefined {
  const row = db
    .prepare<
      [string, string],
      ProfileRow
    >('select * from tax_profile where property_code = ? and code = ?')
    .get(propertyCode, code);
  return row === undefined ? undefined : toProfile(row);
}

export function requireTaxProfile(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): TaxProfile {
  const found = findTaxProfile(db, propertyCode, code);
  if (found === undefined) {
    throw notFound('tax.missing', code, `${propertyCode} has no tax profile ${code}`);
  }
  return found;
}

export function listTaxProfiles(db: Database, propertyCode: CatalogCode): TaxProfile[] {
  return db
    .prepare<
      [string],
      ProfileRow
    >('select * from tax_profile where property_code = ? order by code')
    .all(propertyCode)
    .map(toProfile);
}

export function taxRates(
  db: Database,
  propertyCode: CatalogCode,
  profileCode: CatalogCode,
): TaxRate[] {
  return db
    .prepare<[string, string], { category: string; rate_ppm: number }>(
      `select category, rate_ppm from tax_rate
       where property_code = ? and profile_code = ? order by category`,
    )
    .all(propertyCode, profileCode)
    .map((row) => ({ category: row.category as ChargeCategory, rate: rate(row.rate_ppm) }));
}

/** The rate for one category, which is zero when the profile is silent. */
export function taxRateFor(
  db: Database,
  propertyCode: CatalogCode,
  profileCode: CatalogCode,
  category: ChargeCategory,
): Rate {
  const row = db
    .prepare<[string, string, string], { rate_ppm: number }>(
      `select rate_ppm from tax_rate
       where property_code = ? and profile_code = ? and category = ?`,
    )
    .get(propertyCode, profileCode, category);
  return row === undefined ? ZERO_RATE : rate(row.rate_ppm);
}
