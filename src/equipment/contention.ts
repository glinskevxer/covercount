/**
 * Two functions, one set of screens.
 *
 * The pull already says what a setup needs and what the house is short of on
 * its own. That answer is right for one function and wrong for a day, because
 * a house owning eight screens is not short when one function wants six, and
 * is short by four when two overlapping functions each want six.
 *
 * Overlap is the whole question. Two functions in different rooms at the same
 * hour contend for the same screens; the same two functions four hours apart
 * do not, because the porters move the kit between them. So this reads the
 * occupied window rather than the service date, and it reads it per item,
 * because a house can be short of screens and have lanterns to spare on the
 * same afternoon.
 */

import type { CalendarDate } from '../core/calendar.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { addMoney, money, zeroMoney, type Money } from '../core/money.js';
import { requireProperty } from '../property/store.js';
import { functionsOnDate, occupiedWindow, windowsOverlap } from '../booking/diary.js';
import { holdsSpace } from '../booking/types.js';
import { listEquipment, requireEquipment } from './store.js';
import type { Database } from '../store/database.js';

export interface Booked {
  readonly functionId: EntityId<'functionSlot'>;
  readonly name: string;
  readonly quantity: number;
}

export interface Contention {
  readonly equipmentCode: CatalogCode;
  readonly name: string;
  readonly owned: number;
  /** The most that is wanted at any one moment on the day. */
  readonly peak: number;
  readonly shortfall: number;
  /** The functions that are all live at the moment of the peak. */
  readonly atPeak: Booked[];
  readonly rental: Money;
  /** Rental on the shortfall, which is what hiring it in would cost. */
  readonly hireCost: Money;
}

interface Held {
  readonly functionId: EntityId<'functionSlot'>;
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly quantity: number;
}

/** What each function on the day has against one item, saved pull included. */
function heldOn(
  db: Database,
  propertyCode: CatalogCode,
  serviceDate: CalendarDate,
  equipmentCode: CatalogCode,
): Held[] {
  const out: Held[] = [];
  for (const slot of functionsOnDate(db, propertyCode, serviceDate)) {
    if (!holdsSpace(slot.status)) {
      continue;
    }
    const row = db
      .prepare<
        [string, string],
        { quantity: number }
      >('select quantity from function_equipment where function_id = ? and equipment_code = ?')
      .get(slot.id, equipmentCode);
    if (row === undefined || row.quantity <= 0) {
      continue;
    }
    const window = occupiedWindow(db, slot);
    out.push({
      functionId: slot.id,
      name: slot.name,
      from: window.from,
      to: window.to,
      quantity: row.quantity,
    });
  }
  return out;
}

/**
 * The peak demand for one item across a day.
 *
 * Every function's start is a candidate for the peak: demand only rises when
 * something begins, so checking each start covers every moment worth checking
 * without sweeping the day a minute at a time.
 */
export function contentionFor(
  db: Database,
  propertyCode: CatalogCode,
  serviceDate: CalendarDate,
  equipmentCode: CatalogCode,
): Contention {
  const property = requireProperty(db, propertyCode);
  const item = requireEquipment(db, propertyCode, equipmentCode);
  const held = heldOn(db, propertyCode, serviceDate, equipmentCode);

  let peak = 0;
  let atPeak: Booked[] = [];
  for (const candidate of held) {
    const live = held.filter((each) =>
      windowsOverlap({ from: candidate.from, to: candidate.to }, { from: each.from, to: each.to }),
    );
    const total = live.reduce((sum, each) => sum + each.quantity, 0);
    if (total > peak) {
      peak = total;
      atPeak = live.map((each) => ({
        functionId: each.functionId,
        name: each.name,
        quantity: each.quantity,
      }));
    }
  }

  const shortfall = Math.max(peak - item.owned, 0);
  return {
    equipmentCode: item.code,
    name: item.name,
    owned: item.owned,
    peak,
    shortfall,
    atPeak,
    rental: item.rental,
    hireCost:
      shortfall === 0
        ? zeroMoney(property.currency)
        : money(item.rental.amount * shortfall, property.currency),
  };
}

export interface DayContention {
  readonly propertyCode: CatalogCode;
  readonly serviceDate: CalendarDate;
  readonly items: Contention[];
  readonly short: Contention[];
  readonly hireCost: Money;
}

/** Every item the house owns, with the ones it is short of picked out. */
export function contentionOn(
  db: Database,
  propertyCode: CatalogCode,
  serviceDate: CalendarDate,
): DayContention {
  const property = requireProperty(db, propertyCode);
  const items = listEquipment(db, propertyCode)
    .map((item) => contentionFor(db, propertyCode, serviceDate, item.code))
    .filter((row) => row.peak > 0)
    .sort(
      (left, right) =>
        right.shortfall - left.shortfall || left.equipmentCode.localeCompare(right.equipmentCode),
    );
  const short = items.filter((row) => row.shortfall > 0);
  return {
    propertyCode,
    serviceDate,
    items,
    short,
    hireCost: short.reduce(
      (total, row) => addMoney(total, row.hireCost),
      zeroMoney(property.currency),
    ),
  };
}

export function renderContention(day: DayContention): string {
  const lines: string[] = [];
  lines.push(`${day.propertyCode} equipment on ${day.serviceDate}`);
  if (day.items.length === 0) {
    lines.push('');
    lines.push('nothing is pulled that day');
    return lines.join('\n');
  }
  lines.push(`${day.short.length} item(s) short`);
  lines.push('');
  for (const row of day.items) {
    const mark = row.shortfall > 0 ? `short ${row.shortfall}` : 'covered';
    lines.push(
      `  ${row.equipmentCode.padEnd(14)} peak ${String(row.peak).padStart(4)} of ${String(row.owned).padStart(4)}  ${mark}`,
    );
    if (row.shortfall > 0) {
      for (const booked of row.atPeak) {
        lines.push(`      ${booked.name} wants ${booked.quantity}`);
      }
    }
  }
  return lines.join('\n');
}
