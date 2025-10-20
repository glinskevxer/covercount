/**
 * The conference resume.
 *
 * A three day conference is one deal and eleven functions, and the sales
 * office wants it on one page: every function in date and time order, the
 * covers, what is sold, what is still open, and the money. It is the sheet a
 * convention services manager walks into a pre convention meeting with, and
 * the reason it is a report rather than a query is that the interesting part
 * is the totals and the exceptions rather than the rows.
 */

import { compareCalendarDates, formatCalendarDate, type CalendarDate } from '../core/calendar.js';
import { formatTimeOfDayShort, type TimeOfDay } from '../core/clock.js';
import { addMoney, formatMoney, zeroMoney, type Money } from '../core/money.js';
import type { EntityId } from '../core/ids.js';
import { listFunctions } from '../booking/functions.js';
import { requireBooking } from '../booking/store.js';
import { findAccount } from '../booking/accounts.js';
import { holdsSpace } from '../booking/types.js';
import { requireProperty, requireSpace } from '../property/store.js';
import { findCovers } from '../covers/guarantee.js';
import { splitProblems } from '../covers/selections.js';
import { listSpecialMeals } from '../covers/special.js';
import { listCharges, lineTotal } from '../billing/charges.js';
import { liveRevision, revisionIsStale } from '../orders/revisions.js';
import { listShifts, shiftCost } from '../labour/shifts.js';
import type { Database } from '../store/database.js';

export interface ResumeRow {
  readonly functionId: EntityId<'functionSlot'>;
  readonly serviceDate: CalendarDate;
  readonly start: string;
  readonly end: string;
  readonly room: string;
  readonly name: string;
  readonly serviceStyle: string;
  readonly status: string;
  readonly guaranteed: number | undefined;
  readonly setFor: number | undefined;
  readonly special: number;
  readonly charges: Money;
  readonly labour: Money;
  readonly sheet: string;
  readonly open: string[];
}

export interface Resume {
  readonly bookingId: EntityId<'booking'>;
  readonly postAs: string;
  readonly accountName: string;
  readonly salesManager: string;
  readonly status: string;
  readonly arrival: CalendarDate;
  readonly departure: CalendarDate;
  readonly rows: ResumeRow[];
  readonly peakCovers: number;
  readonly totalCharges: Money;
  readonly totalLabour: Money;
  readonly openItems: number;
}

function clock(minute: number): string {
  const wrapped = (((minute % 1440) + 1440) % 1440) as TimeOfDay;
  const label = formatTimeOfDayShort(wrapped);
  return minute >= 1440 ? `${label}+1` : label;
}

function openItemsFor(
  db: Database,
  slotId: EntityId<'functionSlot'>,
  charges: Money,
  labour: Money,
  status: string,
): string[] {
  const open: string[] = [];
  const covers = findCovers(db, slotId);
  if (covers === undefined) {
    open.push('no cover count open');
  } else if (covers.guaranteedCovers === undefined) {
    open.push('no guarantee');
  } else {
    if (splitProblems(db, slotId).length > 0) {
      open.push('split does not add up');
    }
    if (listSpecialMeals(db, slotId).some((meal) => meal.substituteItemCode === undefined)) {
      open.push('a special meal has no dish');
    }
  }
  if (charges.amount === 0) {
    open.push('nothing charged');
  }
  if (labour.amount === 0 && holdsSpace(status as Parameters<typeof holdsSpace>[0])) {
    open.push('nobody rostered');
  }
  return open;
}

function sheetStateFor(db: Database, slotId: EntityId<'functionSlot'>): string {
  const live = liveRevision(db, slotId);
  if (live === undefined) {
    return 'not drawn';
  }
  return revisionIsStale(db, slotId)
    ? `${live.id} stale`
    : `${live.id} ${live.status.toLowerCase()}`;
}

export function conferenceResume(db: Database, bookingId: EntityId<'booking'>): Resume {
  const booking = requireBooking(db, bookingId);
  const property = requireProperty(db, booking.propertyCode);
  const currency = property.currency;
  const account =
    booking.accountCode === undefined
      ? undefined
      : findAccount(db, booking.propertyCode, booking.accountCode);

  const rows: ResumeRow[] = listFunctions(db, bookingId).map((slot) => {
    const space = requireSpace(db, slot.propertyCode, slot.spaceCode);
    const covers = findCovers(db, slot.id);
    const charges = listCharges(db, slot.id).reduce<Money>(
      (total, line) => addMoney(total, lineTotal(line)),
      zeroMoney(currency),
    );
    const labour = listShifts(db, slot.id).reduce<Money>(
      (total, shift) => addMoney(total, shiftCost(shift)),
      zeroMoney(currency),
    );

    return {
      functionId: slot.id,
      serviceDate: slot.serviceDate,
      start: clock(slot.startMinute),
      end: clock(slot.endMinute),
      room: space.name,
      name: slot.name,
      serviceStyle: slot.serviceStyle,
      status: slot.status,
      guaranteed: covers?.guaranteedCovers,
      setFor: covers?.setCovers,
      special: listSpecialMeals(db, slot.id).reduce((total, meal) => total + meal.covers, 0),
      charges,
      labour,
      sheet: sheetStateFor(db, slot.id),
      open: openItemsFor(db, slot.id, charges, labour, slot.status),
    };
  });

  rows.sort(
    (left, right) =>
      compareCalendarDates(left.serviceDate, right.serviceDate) ||
      left.start.localeCompare(right.start),
  );

  const live = rows.filter((row) => holdsSpace(row.status as Parameters<typeof holdsSpace>[0]));
  return {
    bookingId,
    postAs: booking.postAs,
    accountName: account?.name ?? '',
    salesManager: booking.salesManager,
    status: booking.status,
    arrival: booking.arrivalDate,
    departure: booking.departureDate,
    rows,
    peakCovers: live.reduce((peak, row) => Math.max(peak, row.guaranteed ?? 0), 0),
    totalCharges: live.reduce<Money>(
      (total, row) => addMoney(total, row.charges),
      zeroMoney(currency),
    ),
    totalLabour: live.reduce<Money>(
      (total, row) => addMoney(total, row.labour),
      zeroMoney(currency),
    ),
    openItems: live.reduce((total, row) => total + row.open.length, 0),
  };
}

export function renderResume(resume: Resume): string {
  const lines: string[] = [];
  lines.push(`RESUME  ${resume.bookingId}  ${resume.postAs}`);
  if (resume.accountName.length > 0) {
    lines.push(`for ${resume.accountName}`);
  }
  lines.push(
    `${formatCalendarDate(resume.arrival)} to ${formatCalendarDate(resume.departure)}, ${resume.status.toLowerCase()}`,
  );
  lines.push(`sales manager ${resume.salesManager}`);

  if (resume.rows.length === 0) {
    lines.push('');
    lines.push('no functions');
    return lines.join('\n');
  }

  let date = '';
  const nameWidth = resume.rows.reduce((widest, row) => Math.max(widest, row.name.length), 0);
  for (const row of resume.rows) {
    if (row.serviceDate !== date) {
      date = row.serviceDate;
      lines.push('');
      lines.push(formatCalendarDate(row.serviceDate));
    }
    const covers = row.guaranteed === undefined ? '   -' : String(row.guaranteed).padStart(4);
    lines.push(
      `  ${`${row.start} to ${row.end}`.padEnd(15)}${row.name.padEnd(nameWidth)}  ${covers}  ${row.room}`,
    );
    lines.push(`      ${row.status.toLowerCase()}, ${row.sheet}, ${formatMoney(row.charges)}`);
    for (const item of row.open) {
      lines.push(`      open: ${item}`);
    }
  }

  lines.push('');
  lines.push(`  peak ${resume.peakCovers} covers`);
  lines.push(`  charges ${formatMoney(resume.totalCharges)}`);
  lines.push(`  labour ${formatMoney(resume.totalLabour)}`);
  lines.push(`  ${resume.openItems} open items`);
  return lines.join('\n');
}
