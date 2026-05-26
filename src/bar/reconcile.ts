/**
 * Which way of selling the bar was right.
 *
 * A client picks a package bar or a consumption bar before anybody knows how
 * much the room will drink, and afterwards exactly one of them turns out to
 * have been the better deal. The bar manager is asked about that at the end of
 * every large event, and answering it needs both numbers computed off the same
 * night rather than one number and a guess.
 *
 * So the pours are read whatever kind of bar was sold. On a package bar they
 * are not billed and they still have to be taken, because the cost of the
 * liquor is real and a package that ran at three times its own tier is a tier
 * priced wrong. That is the number this exists to produce.
 */

import { conflict } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { addMoney, subtractMoney, zeroMoney, type Money } from '../core/money.js';
import { PPM, rate, type Rate } from '../core/rate.js';
import { divideRound } from '../core/rounding.js';
import { requireFunction } from '../booking/functions.js';
import { requireProperty } from '../property/store.js';
import { billedCovers, requireCovers } from '../covers/guarantee.js';
import {
  barCharge,
  listPours,
  pourCharge,
  pouredTenths,
  requireBar,
  requireBarTier,
} from './store.js';
import type { BarKind } from './store.js';
import { padRight, row, sheet } from '../core/layout.js';
import type { Database } from '../store/database.js';

export interface PourLine {
  readonly itemCode: CatalogCode;
  readonly tenths: number;
  readonly value: Money;
}

export interface BarReconciliation {
  readonly functionId: EntityId<'functionSlot'>;
  readonly kind: BarKind;
  readonly covers: number;
  readonly hours: number;
  /** What the client was actually charged. */
  readonly billed: Money;
  /** What the same night would have come to on consumption. */
  readonly onConsumption: Money;
  /** What the same night would have come to on the tier that was sold. */
  readonly onPackage: Money | undefined;
  readonly poured: PourLine[];
  readonly bottles: number;
  /** Consumption over the amount billed, which is the house's exposure. */
  readonly ratio: Rate;
  readonly betterForTheHouse: 'PACKAGE' | 'CONSUMPTION' | 'THE-SAME';
}

/** What the package would have come to, or nothing where no tier was sold. */
function packageValue(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  covers: number,
  hours: number,
): Money | undefined {
  const slot = requireFunction(db, functionId);
  const bar = requireBar(db, functionId);
  if (bar.tierCode === undefined) {
    return undefined;
  }
  const tier = requireBarTier(db, slot.propertyCode, bar.tierCode);
  const extraHours = Math.max(hours - 1, 0);
  return addMoney(
    { amount: tier.firstHour.amount * covers, currency: tier.firstHour.currency },
    { amount: tier.extraHour.amount * covers * extraHours, currency: tier.extraHour.currency },
  );
}

export function reconcileBar(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): BarReconciliation {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const bar = requireBar(db, functionId);
  const covers = billedCovers(requireCovers(db, functionId));

  const pours = listPours(db, functionId);
  const poured: PourLine[] = pours.map((pour) => ({
    itemCode: pour.itemCode,
    tenths: pouredTenths(pour),
    value: pourCharge(pour),
  }));
  const onConsumption = poured.reduce(
    (total, line) => addMoney(total, line.value),
    zeroMoney(property.currency),
  );
  const onPackage = packageValue(db, functionId, covers, bar.hours);
  const billed = barCharge(db, functionId).amount;

  const ratio =
    billed.amount === 0
      ? rate(0)
      : rate(divideRound(onConsumption.amount * PPM, billed.amount, 'half-up'));

  let better: BarReconciliation['betterForTheHouse'] = 'THE-SAME';
  if (onPackage !== undefined) {
    const gap = subtractMoney(onPackage, onConsumption);
    better = gap.amount > 0 ? 'PACKAGE' : gap.amount < 0 ? 'CONSUMPTION' : 'THE-SAME';
  }

  return {
    functionId,
    kind: bar.kind,
    covers,
    hours: bar.hours,
    billed,
    onConsumption,
    onPackage,
    poured,
    bottles: poured.reduce((total, line) => total + line.tenths, 0) / 10,
    ratio,
    betterForTheHouse: better,
  };
}

/**
 * The reconciliation, refusing where there is nothing to reconcile.
 *
 * A cash bar has no house exposure at all, and a package bar nobody counted
 * bottles against has half the answer. Both are worth saying out loud rather
 * than reporting a confident nil.
 */
export function requireReconciliation(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): BarReconciliation {
  const found = reconcileBar(db, functionId);
  if (found.kind === 'CASH') {
    throw conflict(
      'bar.cash',
      `${functionId} ran a cash bar, so there is nothing of the house's to reconcile`,
      functionId,
    );
  }
  if (found.poured.length === 0) {
    throw conflict(
      'bar.uncounted',
      `nobody counted the bottles on ${functionId}, so there is nothing to compare the bill against`,
      functionId,
    );
  }
  return found;
}

export function renderReconciliation(found: BarReconciliation): string {
  return sheet({
    heading: `${found.functionId}  ${found.kind} bar, ${found.covers} covers, ${found.hours} hour(s)`,
    summary: [
      `billed ${found.billed.amount} minor, poured ${found.bottles.toFixed(1)} bottles`,
      ...(found.onPackage === undefined
        ? []
        : [
            `package would be ${found.onPackage.amount}, consumption would be ${found.onConsumption.amount}`,
            `better for the house: ${found.betterForTheHouse}`,
          ]),
    ],
    sections: [
      {
        title: '',
        rows: found.poured.map((line) =>
          row(
            padRight(line.itemCode, 16),
            ` ${(line.tenths / 10).toFixed(1)} bottle(s)  ${line.value.amount}`,
          ),
        ),
      },
    ],
    whenBare: 'nobody counted the bottles',
  });
}
