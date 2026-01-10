/**
 * What actually happened in the kitchen.
 *
 * The plan says the buffet needs two hundred and seven portions of short rib.
 * The chef makes two hundred and twenty because the last pan would not divide,
 * and forty come back on the pass at the end of the night. Both numbers matter
 * and neither is the plan.
 *
 * Recording them is what turns the production factor from a guess into a
 * measurement. A style that comes back thirty percent every time is oversized,
 * and a style that runs out is undersized, and the house cannot tell which
 * without the returns.
 */

import { conflict, invalidInput } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { PPM, rate, type Rate } from '../core/rate.js';
import { divideRound } from '../core/rounding.js';
import { requireFunction } from '../booking/functions.js';
import { requireRecipe } from './recipes.js';
import { batchDemand } from './explode.js';
import { UNIT_FACTOR, productionFactor } from './factors.js';
import type { Database } from '../store/database.js';

export interface ProductionActual {
  readonly functionId: EntityId<'functionSlot'>;
  readonly recipeCode: CatalogCode;
  /** Portions the kitchen put out. */
  readonly produced: number;
  /** Portions that came back untouched. */
  readonly returned: number;
  readonly note: string;
  readonly recordedAt: string;
}

export interface RecordProducedInput {
  readonly produced: number;
  readonly returned?: number;
  readonly note?: string;
}

export function recordProduced(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  recipeCode: CatalogCode,
  input: RecordProducedInput,
  now: string,
): ProductionActual {
  const slot = requireFunction(db, functionId);
  requireRecipe(db, slot.propertyCode, recipeCode);
  if (!Number.isInteger(input.produced) || input.produced < 0) {
    throw invalidInput('actual.produced', 'a portion count is a whole number, nil or more');
  }
  const returned = input.returned ?? 0;
  if (!Number.isInteger(returned) || returned < 0) {
    throw invalidInput('actual.returned', 'a return count is a whole number, nil or more');
  }
  if (returned > input.produced) {
    throw conflict(
      'actual.impossible',
      `${returned} portions of ${recipeCode} cannot come back when only ${input.produced} went out`,
      recipeCode,
    );
  }

  db.prepare(
    `insert into production_actual
       (function_id, recipe_code, produced, returned, note, recorded_at)
     values (?, ?, ?, ?, ?, ?)
     on conflict (function_id, recipe_code) do update set
       produced = excluded.produced,
       returned = excluded.returned,
       note = excluded.note,
       recorded_at = excluded.recorded_at`,
  ).run(functionId, recipeCode, input.produced, returned, (input.note ?? '').trim(), now);

  return {
    functionId,
    recipeCode,
    produced: input.produced,
    returned,
    note: (input.note ?? '').trim(),
    recordedAt: now,
  };
}

export function listActuals(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): ProductionActual[] {
  return db
    .prepare<
      [string],
      {
        function_id: string;
        recipe_code: string;
        produced: number;
        returned: number;
        note: string;
        recorded_at: string;
      }
    >('select * from production_actual where function_id = ? order by recipe_code')
    .all(functionId)
    .map((row) => ({
      functionId: row.function_id as EntityId<'functionSlot'>,
      recipeCode: row.recipe_code as CatalogCode,
      produced: row.produced,
      returned: row.returned,
      note: row.note,
      recordedAt: row.recorded_at,
    }));
}

export interface VarianceRow {
  readonly recipeCode: CatalogCode;
  readonly plates: number;
  /** What the plan said to make, factor and batching included. */
  readonly planned: number;
  readonly produced: number;
  readonly returned: number;
  /** Produced less the plan. Negative means the kitchen made less. */
  readonly overProduction: number;
  /** Returns over what went out. */
  readonly wasteRate: Rate;
  readonly ranOut: boolean;
}

export interface Variance {
  readonly functionId: EntityId<'functionSlot'>;
  readonly rows: VarianceRow[];
  readonly produced: number;
  readonly returned: number;
  readonly wasteRate: Rate;
  /** How many recipes have no actual recorded against them. */
  readonly unrecorded: number;
}

/**
 * Plan against actual, per recipe.
 *
 * A recipe that ran out is the interesting case and it is not the same as one
 * that came back empty. Zero returns with production at or above the plate
 * count is a clean night; zero returns with production below the plate count
 * means somebody at table forty did not eat.
 */
export function productionVariance(db: Database, functionId: EntityId<'functionSlot'>): Variance {
  const planned = new Map(batchDemand(db, functionId).map((row) => [row.recipeCode, row]));
  const actuals = listActuals(db, functionId);
  const seen = new Set(actuals.map((row) => row.recipeCode));

  const rows: VarianceRow[] = actuals.map((actual) => {
    const plan = planned.get(actual.recipeCode);
    const plates = plan?.plates ?? 0;
    const target = plan?.produced ?? 0;
    return {
      recipeCode: actual.recipeCode,
      plates,
      planned: target,
      produced: actual.produced,
      returned: actual.returned,
      overProduction: actual.produced - target,
      wasteRate:
        actual.produced === 0
          ? rate(0)
          : rate(divideRound(actual.returned * PPM, actual.produced, 'half-up')),
      ranOut: actual.produced < plates,
    };
  });

  const produced = rows.reduce((total, row) => total + row.produced, 0);
  const returned = rows.reduce((total, row) => total + row.returned, 0);
  return {
    functionId,
    rows,
    produced,
    returned,
    wasteRate: produced === 0 ? rate(0) : rate(divideRound(returned * PPM, produced, 'half-up')),
    unrecorded: [...planned.keys()].filter((code) => !seen.has(code)).length,
  };
}

export interface FactorSuggestion {
  readonly serviceStyle: string;
  readonly current: Rate;
  readonly suggested: Rate;
  readonly functionsRead: number;
  readonly platesRead: number;
  readonly servedRead: number;
}

/**
 * What the factor should have been, read off the nights already recorded.
 *
 * Served is production less returns, which is the honest measure of what the
 * room ate. The suggestion is served over plates, floored at one to one:
 * a room that ate less than its plate count does not license the kitchen to
 * make less than it plates, because the shortfall was a guest who did not turn
 * up, not a portion the house did not need.
 */
export function suggestFactor(
  db: Database,
  functionIds: readonly EntityId<'functionSlot'>[],
): FactorSuggestion {
  if (functionIds.length === 0) {
    throw invalidInput('actual.functions', 'a suggestion needs at least one recorded function');
  }
  const first = requireFunction(db, functionIds[0] as EntityId<'functionSlot'>);
  let plates = 0;
  let served = 0;
  let read = 0;

  for (const id of functionIds) {
    const slot = requireFunction(db, id);
    if (slot.serviceStyle !== first.serviceStyle) {
      throw invalidInput(
        'actual.style',
        `${id} is ${slot.serviceStyle} service and ${first.id} is ${first.serviceStyle}, which are two different questions`,
      );
    }
    const variance = productionVariance(db, id);
    if (variance.rows.length === 0) {
      continue;
    }
    read += 1;
    for (const row of variance.rows) {
      plates += row.plates;
      served += row.produced - row.returned;
    }
  }

  if (read === 0) {
    throw conflict(
      'actual.nothing',
      'none of those functions has a production actual recorded against it',
    );
  }

  const raw = plates === 0 ? PPM : divideRound(served * PPM, plates, 'half-up');
  return {
    serviceStyle: first.serviceStyle,
    current: productionFactor(db, first.propertyCode, first.serviceStyle),
    suggested: rate(Math.max(raw, UNIT_FACTOR.ppm)),
    functionsRead: read,
    platesRead: plates,
    servedRead: served,
  };
}
