/**
 * Assembling a banquet event order.
 *
 * The document is a read across the whole build: the function, the covers, the
 * split, the special meals, the roster, the charges. Nothing here computes
 * anything of its own, which is the point. If the sheet the kitchen is holding
 * says something different from what the system says, it is because the sheet
 * is an older revision, not because two things worked the number out twice.
 */

import { formatCalendarDate, type CalendarDate } from '../core/calendar.js';
import { formatTimeOfDayShort, formatZoned, type TimeOfDay } from '../core/clock.js';
import { formatMoney, type Money } from '../core/money.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { requireFunction } from '../booking/functions.js';
import { requireBooking } from '../booking/store.js';
import { findAccount } from '../booking/accounts.js';
import { requireProperty, requireSpace } from '../property/store.js';
import { requireItem } from '../catalog/items.js';
import { requireCovers } from '../covers/guarantee.js';
import { coverBreakdown, listSpecialMeals } from '../covers/special.js';
import { listSelections, splitProblems } from '../covers/selections.js';
import { listShifts, rosterSummary } from '../labour/shifts.js';
import { listCharges, lineTotal } from '../billing/charges.js';
import type { Database } from '../store/database.js';

export interface OrderHeader {
  readonly functionId: EntityId<'functionSlot'>;
  readonly bookingId: EntityId<'booking'>;
  readonly postAs: string;
  readonly accountName: string;
  readonly salesManager: string;
  readonly room: string;
  readonly serviceDate: CalendarDate;
  readonly start: string;
  readonly end: string;
  readonly setupStyle: string;
  readonly serviceStyle: string;
}

export interface OrderCovers {
  readonly guaranteed: number;
  readonly special: number;
  readonly standard: number;
  readonly setFor: number;
  readonly served: number | undefined;
  readonly guaranteeDue: string;
}

export interface OrderCourseLine {
  readonly course: string;
  readonly itemName: string;
  readonly itemCode: CatalogCode;
  readonly covers: number;
}

export interface OrderSpecialLine {
  readonly guest: string;
  readonly covers: number;
  readonly diet: string;
  readonly avoids: string;
  readonly dish: string;
}

export interface OrderShiftLine {
  readonly role: string;
  readonly heads: number;
  readonly from: string;
  readonly to: string;
}

export interface OrderChargeLine {
  readonly category: string;
  readonly description: string;
  readonly quantity: number;
  readonly total: string;
}

export interface BanquetEventOrder {
  readonly header: OrderHeader;
  readonly covers: OrderCovers;
  readonly menu: OrderCourseLine[];
  readonly specials: OrderSpecialLine[];
  readonly roster: OrderShiftLine[];
  readonly charges: OrderChargeLine[];
  readonly rosterCost: string;
  readonly chargesTotal: string;
  readonly warnings: string[];
}

function minuteLabel(minute: number): string {
  const wrapped = (minute % 1440) as TimeOfDay;
  const label = formatTimeOfDayShort(wrapped);
  return minute >= 1440 ? `${label} (next day)` : label;
}

export function assembleOrder(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): BanquetEventOrder {
  const slot = requireFunction(db, functionId);
  const booking = requireBooking(db, slot.bookingId);
  const property = requireProperty(db, slot.propertyCode);
  const space = requireSpace(db, slot.propertyCode, slot.spaceCode);
  const covers = requireCovers(db, functionId);
  const breakdown = coverBreakdown(db, functionId);
  const account =
    booking.accountCode === undefined
      ? undefined
      : findAccount(db, slot.propertyCode, booking.accountCode);

  const menu: OrderCourseLine[] = listSelections(db, functionId).map((selection) => ({
    course: selection.course,
    itemCode: selection.itemCode,
    itemName: requireItem(db, slot.propertyCode, selection.itemCode).name,
    covers: selection.covers,
  }));

  const specials: OrderSpecialLine[] = listSpecialMeals(db, functionId).map((meal) => ({
    guest: meal.guestName,
    covers: meal.covers,
    diet: meal.diet ?? '',
    avoids: meal.allergens.join(', '),
    dish:
      meal.substituteItemCode === undefined
        ? 'not yet decided'
        : requireItem(db, slot.propertyCode, meal.substituteItemCode).name,
  }));

  const roster: OrderShiftLine[] = listShifts(db, functionId).map((shift) => ({
    role: shift.role,
    heads: shift.heads,
    from: minuteLabel(shift.startMinute),
    to: minuteLabel(shift.endMinute),
  }));

  const charges = listCharges(db, functionId);
  const chargeLines: OrderChargeLine[] = charges.map((line) => ({
    category: line.category,
    description: line.description,
    quantity: line.quantity,
    total: formatMoney(lineTotal(line)),
  }));

  const chargesTotal: Money = charges.reduce<Money>(
    (total, line) => ({
      amount: total.amount + lineTotal(line).amount,
      currency: property.currency,
    }),
    { amount: 0, currency: property.currency },
  );

  return {
    header: {
      functionId,
      bookingId: booking.id,
      postAs: booking.postAs,
      accountName: account?.name ?? '',
      salesManager: booking.salesManager,
      room: `${space.name} (${space.code})`,
      serviceDate: slot.serviceDate,
      start: minuteLabel(slot.startMinute),
      end: minuteLabel(slot.endMinute),
      setupStyle: slot.setupStyle,
      serviceStyle: slot.serviceStyle,
    },
    covers: {
      guaranteed: breakdown.guaranteed,
      special: breakdown.special,
      standard: breakdown.standard,
      setFor: breakdown.setFor,
      served: covers.servedCovers,
      guaranteeDue: formatZoned(covers.guaranteeDue),
    },
    menu,
    specials,
    roster,
    charges: chargeLines,
    rosterCost: formatMoney(rosterSummary(db, functionId).cost),
    chargesTotal: formatMoney(chargesTotal),
    warnings: orderWarnings(db, functionId),
  };
}

/** Everything a coordinator should look at before this sheet goes out. */
export function orderWarnings(db: Database, functionId: EntityId<'functionSlot'>): string[] {
  const warnings: string[] = [];

  for (const problem of splitProblems(db, functionId)) {
    warnings.push(
      `the ${problem.course} split adds to ${problem.chosen} against ${problem.expected} standard covers`,
    );
  }
  for (const meal of listSpecialMeals(db, functionId)) {
    if (meal.substituteItemCode === undefined) {
      warnings.push(
        `${meal.guestName.length > 0 ? meal.guestName : 'a guest'} has no dish decided`,
      );
    }
  }
  const roster = rosterSummary(db, functionId);
  if (roster.heads === 0) {
    warnings.push('nobody is rostered');
  }
  for (const role of roster.unpriced) {
    warnings.push(`${role} has no rate in force on the service date`);
  }
  if (listCharges(db, functionId).length === 0) {
    warnings.push('nothing has been charged');
  }

  return warnings;
}

/** The document as a plain text sheet, which is what gets pinned to the pass. */
export function renderOrder(order: BanquetEventOrder): string {
  const lines: string[] = [];
  lines.push(`BANQUET EVENT ORDER  ${order.header.functionId}`);
  lines.push(order.header.postAs);
  if (order.header.accountName.length > 0) {
    lines.push(`for ${order.header.accountName}`);
  }
  lines.push('');
  lines.push(formatCalendarDate(order.header.serviceDate));
  lines.push(`${order.header.start} to ${order.header.end} in ${order.header.room}`);
  lines.push(`${order.header.setupStyle} setup, ${order.header.serviceStyle} service`);
  lines.push(`sales manager ${order.header.salesManager}`);
  lines.push('');
  lines.push('COVERS');
  lines.push(`  guaranteed ${order.covers.guaranteed}, ${order.covers.special} special`);
  lines.push(`  ${order.covers.standard} standard plates, room set for ${order.covers.setFor}`);
  lines.push(`  guarantee closed ${order.covers.guaranteeDue}`);
  if (order.covers.served !== undefined) {
    lines.push(`  served ${order.covers.served}`);
  }

  if (order.menu.length > 0) {
    lines.push('');
    lines.push('MENU');
    for (const row of order.menu) {
      lines.push(`  ${row.course.padEnd(10)} ${String(row.covers).padStart(4)}  ${row.itemName}`);
    }
  }
  if (order.specials.length > 0) {
    lines.push('');
    lines.push('SPECIAL MEALS');
    for (const row of order.specials) {
      const reason = [row.diet, row.avoids].filter((part) => part.length > 0).join(' / ');
      lines.push(`  ${String(row.covers).padStart(3)}  ${reason}  ${row.dish}`);
    }
  }
  if (order.roster.length > 0) {
    lines.push('');
    lines.push('CREW');
    for (const row of order.roster) {
      lines.push(
        `  ${String(row.heads).padStart(3)}  ${row.role.padEnd(10)} ${row.from} to ${row.to}`,
      );
    }
    lines.push(`  labour ${order.rosterCost}`);
  }
  if (order.charges.length > 0) {
    lines.push('');
    lines.push('CHARGES');
    for (const row of order.charges) {
      lines.push(`  ${row.category.padEnd(9)} ${row.description.padEnd(32)} ${row.total}`);
    }
    lines.push(`  total ${order.chargesTotal}`);
  }
  if (order.warnings.length > 0) {
    lines.push('');
    lines.push('CHECK BEFORE THIS GOES OUT');
    for (const warning of order.warnings) {
      lines.push(`  ${warning}`);
    }
  }
  return lines.join('\n');
}
