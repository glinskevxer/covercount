/**
 * The three sheets the front of house works from.
 *
 * The function board is the day at a glance, one line a room. The reader board
 * is what goes on the screen in the lobby, which carries the post as name and
 * deliberately not the client's account or the cover count. The staffing sheet
 * is the crew for the day with the call times, which is what gets pinned up in
 * the service corridor.
 */

import { formatCalendarDate, type CalendarDate } from '../core/calendar.js';
import { formatTimeOfDayShort, type TimeOfDay } from '../core/clock.js';
import { formatMoney, sumMoney, zeroMoney, type Money } from '../core/money.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { functionsOnDate } from '../booking/diary.js';
import { holdsSpace } from '../booking/types.js';
import { requireBooking } from '../booking/store.js';
import { requireProperty, requireSpace } from '../property/store.js';
import { findCovers } from '../covers/guarantee.js';
import { listShifts, shiftCost } from '../labour/shifts.js';
import type { Database } from '../store/database.js';

function clock(minute: number): string {
  const wrapped = (((minute % 1440) + 1440) % 1440) as TimeOfDay;
  const label = formatTimeOfDayShort(wrapped);
  return minute >= 1440 ? `${label}+1` : label;
}

export interface BoardRow {
  readonly functionId: EntityId<'functionSlot'>;
  readonly room: string;
  readonly roomName: string;
  readonly name: string;
  readonly postAs: string;
  readonly start: string;
  readonly end: string;
  readonly setupStyle: string;
  readonly serviceStyle: string;
  readonly status: string;
  readonly covers: number;
  readonly setFor: number | undefined;
}

export interface FunctionBoard {
  readonly serviceDate: CalendarDate;
  readonly rows: BoardRow[];
  readonly totalCovers: number;
}

export function functionBoard(
  db: Database,
  propertyCode: CatalogCode,
  date: CalendarDate,
): FunctionBoard {
  const rows: BoardRow[] = functionsOnDate(db, propertyCode, date).map((slot) => {
    const booking = requireBooking(db, slot.bookingId);
    const space = requireSpace(db, slot.propertyCode, slot.spaceCode);
    const covers = findCovers(db, slot.id);
    return {
      functionId: slot.id,
      room: slot.spaceCode,
      roomName: space.name,
      name: slot.name,
      postAs: booking.postAs,
      start: clock(slot.startMinute),
      end: clock(slot.endMinute),
      setupStyle: slot.setupStyle,
      serviceStyle: slot.serviceStyle,
      status: slot.status,
      covers: covers?.guaranteedCovers ?? slot.expectedCovers,
      setFor: covers?.setCovers,
    };
  });

  return {
    serviceDate: date,
    rows,
    totalCovers: rows
      .filter((row) => holdsSpace(row.status as Parameters<typeof holdsSpace>[0]))
      .reduce((total, row) => total + row.covers, 0),
  };
}

export function renderFunctionBoard(board: FunctionBoard): string {
  const lines: string[] = [];
  lines.push(`FUNCTION BOARD  ${formatCalendarDate(board.serviceDate)}`);
  if (board.rows.length === 0) {
    lines.push('nothing is in the diary');
    return lines.join('\n');
  }
  const roomWidth = board.rows.reduce((widest, row) => Math.max(widest, row.roomName.length), 0);
  const nameWidth = board.rows.reduce((widest, row) => Math.max(widest, row.name.length), 0);
  for (const row of board.rows) {
    lines.push(
      `  ${`${row.start} to ${row.end}`.padEnd(16)}${row.roomName.padEnd(roomWidth)}  ${row.name.padEnd(
        nameWidth,
      )}  ${String(row.covers).padStart(4)}  ${row.setupStyle.padEnd(12)}${row.status}`,
    );
  }
  lines.push('');
  lines.push(`  ${board.totalCovers} covers in the building`);
  return lines.join('\n');
}

export interface ReaderBoardRow {
  readonly time: string;
  readonly room: string;
  readonly postAs: string;
}

/**
 * What goes on the lobby screen. No cover counts, no account names, and
 * nothing that has not been confirmed, because a screen that shows a tentative
 * booking has told the client's competitor they are in the building.
 */
export function readerBoard(
  db: Database,
  propertyCode: CatalogCode,
  date: CalendarDate,
): ReaderBoardRow[] {
  return functionBoard(db, propertyCode, date)
    .rows.filter((row) => row.status === 'DEFINITE')
    .map((row) => ({ time: row.start, room: row.roomName, postAs: row.postAs }));
}

export function renderReaderBoard(rows: readonly ReaderBoardRow[]): string {
  if (rows.length === 0) {
    return 'no functions today';
  }
  const roomWidth = rows.reduce((widest, row) => Math.max(widest, row.room.length), 0);
  return rows
    .map((row) => `${row.time.padStart(8)}   ${row.room.padEnd(roomWidth)}   ${row.postAs}`)
    .join('\n');
}

export interface StaffingRow {
  readonly functionId: EntityId<'functionSlot'>;
  readonly functionName: string;
  readonly room: string;
  readonly role: string;
  readonly heads: number;
  readonly from: string;
  readonly to: string;
  readonly cost: string;
}

export interface StaffingSheet {
  readonly serviceDate: CalendarDate;
  readonly rows: StaffingRow[];
  readonly heads: number;
  readonly cost: string;
  readonly byRole: { role: string; heads: number }[];
}

export function staffingSheet(
  db: Database,
  propertyCode: CatalogCode,
  date: CalendarDate,
): StaffingSheet {
  const property = requireProperty(db, propertyCode);
  const rows: StaffingRow[] = [];
  const costs: Money[] = [];

  for (const slot of functionsOnDate(db, propertyCode, date)) {
    if (!holdsSpace(slot.status)) {
      continue;
    }
    const space = requireSpace(db, slot.propertyCode, slot.spaceCode);
    for (const shift of listShifts(db, slot.id)) {
      const cost = shiftCost(shift);
      costs.push(cost);
      rows.push({
        functionId: slot.id,
        functionName: slot.name,
        room: space.name,
        role: shift.role,
        heads: shift.heads,
        from: clock(shift.startMinute),
        to: clock(shift.endMinute),
        cost: formatMoney(cost),
      });
    }
  }

  rows.sort(
    (left, right) => left.role.localeCompare(right.role) || left.from.localeCompare(right.from),
  );

  const byRole = new Map<string, number>();
  for (const row of rows) {
    byRole.set(row.role, (byRole.get(row.role) ?? 0) + row.heads);
  }

  return {
    serviceDate: date,
    rows,
    heads: rows.reduce((total, row) => total + row.heads, 0),
    cost: formatMoney(
      costs.length === 0 ? zeroMoney(property.currency) : sumMoney(costs, property.currency),
    ),
    byRole: [...byRole.entries()].map(([role, heads]) => ({ role, heads })),
  };
}

export function renderStaffingSheet(sheet: StaffingSheet): string {
  const lines: string[] = [];
  lines.push(`STAFFING  ${formatCalendarDate(sheet.serviceDate)}`);
  if (sheet.rows.length === 0) {
    lines.push('nobody is called in');
    return lines.join('\n');
  }
  const nameWidth = sheet.rows.reduce(
    (widest, row) => Math.max(widest, row.functionName.length),
    0,
  );
  let role = '';
  for (const row of sheet.rows) {
    if (row.role !== role) {
      role = row.role;
      lines.push('');
      lines.push(`${role}  (${sheet.byRole.find((each) => each.role === role)?.heads ?? 0})`);
    }
    lines.push(
      `  ${String(row.heads).padStart(3)}  ${`${row.from} to ${row.to}`.padEnd(16)}${row.functionName.padEnd(
        nameWidth,
      )}  ${row.room}`,
    );
  }
  lines.push('');
  lines.push(`  ${sheet.heads} heads, ${sheet.cost}`);
  return lines.join('\n');
}
