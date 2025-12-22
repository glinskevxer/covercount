/**
 * The production factor.
 *
 * Everything the kitchen makes is scaled by this before the recipe is
 * exploded. A plated dinner is one to one; a buffet is not, because the
 * display has to still look like a buffet when the last table goes up.
 *
 * The factor sits between the plate count and the batch count, which is the
 * only place it can go: applying it after the batching would round a hundred
 * and fifteen percent of six batches back down to six.
 */

import { invalidInput, notFound } from '../core/errors.js';
import type { CatalogCode } from '../core/ids.js';
import { PPM, rate, ratePercent, type Rate } from '../core/rate.js';
import { divideRound } from '../core/rounding.js';
import { isServiceStyle, type ServiceStyle } from '../property/types.js';
import { requireProperty } from '../property/store.js';
import type { Database } from '../store/database.js';

/** One to one, which is what a plated dinner is and what everything defaults to. */
export const UNIT_FACTOR: Rate = rate(PPM);

export interface ProductionFactor {
  readonly serviceStyle: ServiceStyle;
  readonly factor: Rate;
  readonly note: string;
}

export function setProductionFactor(
  db: Database,
  propertyCode: CatalogCode,
  serviceStyleName: string,
  factorPpm: number,
  note = '',
): ProductionFactor {
  requireProperty(db, propertyCode);
  const serviceStyle = serviceStyleName.trim().toUpperCase();
  if (!isServiceStyle(serviceStyle)) {
    throw invalidInput('factor.style', `${serviceStyleName} is not a service style`);
  }
  if (!Number.isSafeInteger(factorPpm) || factorPpm < PPM) {
    throw invalidInput(
      'factor.value',
      'a production factor is at least one to one, a kitchen cannot make less than it plates',
    );
  }
  if (factorPpm > 3 * PPM) {
    throw invalidInput(
      'factor.value',
      `${ratePercent(rate(factorPpm))} percent is not a production factor, it is a mistake`,
    );
  }

  db.prepare(
    `insert into production_factor (property_code, service_style, factor_ppm, note)
     values (?, ?, ?, ?)
     on conflict (property_code, service_style) do update set
       factor_ppm = excluded.factor_ppm, note = excluded.note`,
  ).run(propertyCode, serviceStyle, factorPpm, note.trim());

  return { serviceStyle, factor: rate(factorPpm), note: note.trim() };
}

/** The factor in force, which is one to one where the property is silent. */
export function productionFactor(
  db: Database,
  propertyCode: CatalogCode,
  serviceStyle: ServiceStyle,
): Rate {
  const row = db
    .prepare<
      [string, string],
      { factor_ppm: number }
    >('select factor_ppm from production_factor where property_code = ? and service_style = ?')
    .get(propertyCode, serviceStyle);
  return row === undefined ? UNIT_FACTOR : rate(row.factor_ppm);
}

export function listProductionFactors(db: Database, propertyCode: CatalogCode): ProductionFactor[] {
  return db
    .prepare<[string], { service_style: string; factor_ppm: number; note: string }>(
      'select * from production_factor where property_code = ? order by service_style',
    )
    .all(propertyCode)
    .map((row) => ({
      serviceStyle: row.service_style as ServiceStyle,
      factor: rate(row.factor_ppm),
      note: row.note,
    }));
}

export function requireProductionFactor(
  db: Database,
  propertyCode: CatalogCode,
  serviceStyle: ServiceStyle,
): ProductionFactor {
  const found = listProductionFactors(db, propertyCode).find(
    (row) => row.serviceStyle === serviceStyle,
  );
  if (found === undefined) {
    throw notFound(
      'factor.missing',
      serviceStyle,
      `${propertyCode} has published no ${serviceStyle} production factor`,
    );
  }
  return found;
}

/**
 * Scale a plate count by the factor, rounding up. A buffet for a hundred and
 * eighty at fifteen percent is two hundred and seven portions, and the seven
 * is not something anybody wants rounded away.
 */
export function scaleForProduction(plates: number, factor: Rate): number {
  if (!Number.isInteger(plates) || plates < 0) {
    throw invalidInput('factor.plates', 'a plate count is a whole number');
  }
  return divideRound(plates * factor.ppm, PPM, 'up');
}
