/**
 * The one page somebody reads at seven in the morning.
 *
 * Everything on it is already computed somewhere else. That is the point: a
 * day sheet that worked any of it out again would be a second answer to a
 * question the board, the production sheet and the roster have each already
 * answered, and the day it disagreed with one of them nobody would know which
 * to believe.
 *
 * So this only assembles. The rule it does add is what to leave out: a section
 * with nothing in it does not get printed, because a page of headings with no
 * rows under them stops being read by the second week.
 */

import type { CalendarDate } from '../core/calendar.js';
import type { CatalogCode } from '../core/ids.js';
import { addMoney, zeroMoney, type Money } from '../core/money.js';
import { requireProperty } from '../property/store.js';
import { functionsOnDate } from '../booking/diary.js';
import { holdsSpace } from '../booking/types.js';
import { billedCovers, findCovers } from '../covers/guarantee.js';
import { lineTotal, listCharges } from '../billing/charges.js';
import { listShifts, shiftCost } from '../labour/shifts.js';
import { tightTurns, type Turn } from '../property/turns.js';
import { contentionOn, type Contention } from '../equipment/contention.js';
import { sweepAll, type Finding } from '../audit/sweep.js';
import { padLeft, padRight, row, sheet } from '../core/layout.js';
import type { Database } from '../store/database.js';

export interface DaySheetFunction {
  readonly functionId: string;
  readonly name: string;
  readonly room: CatalogCode;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly setupStyle: string;
  readonly serviceStyle: string;
  readonly status: string;
  readonly covers: number;
  readonly guaranteed: boolean;
  readonly revenue: Money;
  readonly heads: number;
  readonly labour: Money;
}

export interface DaySheet {
  readonly propertyCode: CatalogCode;
  readonly serviceDate: CalendarDate;
  readonly functions: DaySheetFunction[];
  readonly covers: number;
  readonly revenue: Money;
  readonly labour: Money;
  /** Functions still without a guarantee on the day itself. */
  readonly ungaranteed: number;
  readonly tightTurns: Turn[];
  readonly shortOfKit: Contention[];
  readonly findings: Finding[];
}

export function daySheet(
  db: Database,
  propertyCode: CatalogCode,
  serviceDate: CalendarDate,
): DaySheet {
  const property = requireProperty(db, propertyCode);
  const functions: DaySheetFunction[] = [];
  let covers = 0;
  let revenue = zeroMoney(property.currency);
  let labour = zeroMoney(property.currency);
  let ungaranteed = 0;

  for (const slot of functionsOnDate(db, propertyCode, serviceDate)) {
    if (!holdsSpace(slot.status)) {
      continue;
    }
    const record = findCovers(db, slot.id);
    const guaranteed = record?.guaranteedCovers !== undefined;
    const heads = record === undefined ? slot.expectedCovers : billedCovers(record);
    if (!guaranteed) {
      ungaranteed += 1;
    }

    let functionRevenue = zeroMoney(property.currency);
    for (const line of listCharges(db, slot.id)) {
      functionRevenue = addMoney(functionRevenue, lineTotal(line));
    }
    let functionLabour = zeroMoney(property.currency);
    let crew = 0;
    for (const shift of listShifts(db, slot.id)) {
      functionLabour = addMoney(functionLabour, shiftCost(shift));
      crew += shift.heads;
    }

    functions.push({
      functionId: slot.id,
      name: slot.name,
      room: slot.spaceCode,
      startMinute: slot.startMinute,
      endMinute: slot.endMinute,
      setupStyle: slot.setupStyle,
      serviceStyle: slot.serviceStyle,
      status: slot.status,
      covers: heads,
      guaranteed,
      revenue: functionRevenue,
      heads: crew,
      labour: functionLabour,
    });
    covers += heads;
    revenue = addMoney(revenue, functionRevenue);
    labour = addMoney(labour, functionLabour);
  }

  functions.sort(
    (left, right) => left.startMinute - right.startMinute || left.room.localeCompare(right.room),
  );

  return {
    propertyCode,
    serviceDate,
    functions,
    covers,
    revenue,
    labour,
    ungaranteed,
    tightTurns: tightTurns(db, propertyCode, serviceDate),
    shortOfKit: contentionOn(db, propertyCode, serviceDate).short,
    findings: sweepAll(db, propertyCode, { today: serviceDate, from: serviceDate }).filter(
      (finding) => finding.level === 'error',
    ),
  };
}

function clock(minute: number): string {
  const hours = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function renderDaySheet(day: DaySheet): string {
  return sheet({
    heading: `${day.propertyCode}  ${day.serviceDate}`,
    summary: [
      `${day.functions.length} function(s), ${day.covers} cover(s)` +
        (day.ungaranteed > 0 ? `, ${day.ungaranteed} without a guarantee` : ''),
    ],
    sections: [
      {
        title: '',
        rows: day.functions.map((each) =>
          row(
            `${clock(each.startMinute)}-${clock(each.endMinute)}  `,
            padRight(each.room, 10),
            padLeft(each.covers, 5),
            '  ',
            padRight(each.serviceStyle, 10),
            each.name,
            each.guaranteed ? '' : '  (expected)',
          ),
        ),
      },
      {
        title: 'turns that do not fit',
        rows: day.tightTurns.map((turn) =>
          row(
            padRight(turn.spaceCode, 10),
            ` ${turn.fromName} into ${turn.toName}, short ${turn.shortMinutes} minutes`,
          ),
        ),
      },
      {
        title: 'short of kit',
        rows: day.shortOfKit.map((item) =>
          row(padRight(item.equipmentCode, 14), ` short ${item.shortfall} of ${item.peak}`),
        ),
      },
      {
        title: 'to sort out',
        rows: day.findings.map((finding) =>
          row(padRight(finding.subject, 14), ` ${finding.message}`),
        ),
      },
    ],
    whenBare: 'nothing on the books',
  });
}
