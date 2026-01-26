/**
 * Turning a room between two functions.
 *
 * The diary already refuses to double book a room, because the occupied window
 * carries the setup and teardown the space is configured for. That is one
 * number per room and it is not enough. Going from theater to rounds of ten
 * means every chair in the building moves and every table comes out of the
 * store; going from rounds of ten to rounds of twelve means adding two covers
 * a table. Those are not the same afternoon's work.
 *
 * So a turn is a standard between two setup styles, and the house publishes
 * the ones it cares about. Anything it has not published falls back to the
 * room's own teardown plus setup, which is what the diary was already using,
 * so an unpublished pair behaves exactly as it did before.
 */

import type { CalendarDate } from '../core/calendar.js';
import { invalidInput } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { isSetupStyle, type SetupStyle } from './types.js';
import { requireProperty, requireSpace } from './store.js';
import { physicalFootprint } from './combinations.js';
import { functionsOnDate } from '../booking/diary.js';
import { holdsSpace } from '../booking/types.js';
import type { Database } from '../store/database.js';

export interface TurnStandard {
  readonly fromStyle: SetupStyle;
  readonly toStyle: SetupStyle;
  readonly minutes: number;
  readonly heads: number;
  /** Whether the house published this pair or the room's own numbers stood in. */
  readonly published: boolean;
}

function style(value: string, label: string): SetupStyle {
  const upper = value.trim().toUpperCase();
  if (!isSetupStyle(upper)) {
    throw invalidInput('turn.style', `${value} is not a setup style, so it cannot be a ${label}`);
  }
  return upper;
}

export function setTurnStandard(
  db: Database,
  propertyCode: CatalogCode,
  fromStyle: string,
  toStyle: string,
  minutes: number,
  heads: number,
): TurnStandard {
  requireProperty(db, propertyCode);
  const from = style(fromStyle, 'starting setup');
  const to = style(toStyle, 'finishing setup');
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 1440) {
    throw invalidInput('turn.minutes', 'a turn takes between nil minutes and a whole day');
  }
  if (!Number.isSafeInteger(heads) || heads < 0) {
    throw invalidInput('turn.heads', 'a turn takes a whole number of housemen');
  }
  db.prepare(
    `insert into turn_standard (property_code, from_style, to_style, minutes, heads)
     values (?, ?, ?, ?, ?)
     on conflict (property_code, from_style, to_style) do update set
       minutes = excluded.minutes, heads = excluded.heads`,
  ).run(propertyCode, from, to, minutes, heads);
  return { fromStyle: from, toStyle: to, minutes, heads, published: true };
}

export function listTurnStandards(db: Database, propertyCode: CatalogCode): TurnStandard[] {
  return db
    .prepare<[string], { from_style: string; to_style: string; minutes: number; heads: number }>(
      'select * from turn_standard where property_code = ? order by from_style, to_style',
    )
    .all(propertyCode)
    .map((row) => ({
      fromStyle: row.from_style as SetupStyle,
      toStyle: row.to_style as SetupStyle,
      minutes: row.minutes,
      heads: row.heads,
      published: true,
    }));
}

/**
 * The standard in force. An unpublished pair falls back to what the room says,
 * which keeps this consistent with the clash rule the diary already applies.
 */
export function turnStandard(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
  fromStyle: SetupStyle,
  toStyle: SetupStyle,
): TurnStandard {
  const row = db
    .prepare<
      [string, string, string],
      { minutes: number; heads: number }
    >('select minutes, heads from turn_standard where property_code = ? and from_style = ? and to_style = ?')
    .get(propertyCode, fromStyle, toStyle);
  if (row !== undefined) {
    return { fromStyle, toStyle, minutes: row.minutes, heads: row.heads, published: true };
  }
  const space = requireSpace(db, propertyCode, spaceCode);
  return {
    fromStyle,
    toStyle,
    minutes: space.teardownMinutes + space.setupMinutes,
    heads: 0,
    published: false,
  };
}

export interface Turn {
  readonly spaceCode: CatalogCode;
  readonly fromId: EntityId<'functionSlot'>;
  readonly fromName: string;
  readonly toId: EntityId<'functionSlot'>;
  readonly toName: string;
  /** Minutes between the first one finishing and the second one starting. */
  readonly gapMinutes: number;
  readonly standard: TurnStandard;
  readonly shortMinutes: number;
  readonly tight: boolean;
  readonly headsNeeded: number;
}

export interface TurnPlan {
  readonly propertyCode: CatalogCode;
  readonly serviceDate: CalendarDate;
  readonly turns: Turn[];
  readonly tight: number;
  readonly headsAtOnce: number;
}

/**
 * Every back to back pair on one day, and whether the gap covers the turn.
 *
 * Two functions in the same physical room are a turn even when the diary calls
 * the rooms different names: the ballroom emptying into its own half is still
 * every chair moving. So the pairing runs on the footprint, and a function
 * that shares no part of the footprint with the one before it is not a turn at
 * all, it is two rooms.
 */
export function turnPlan(
  db: Database,
  propertyCode: CatalogCode,
  serviceDate: CalendarDate,
): TurnPlan {
  requireProperty(db, propertyCode);
  const slots = functionsOnDate(db, propertyCode, serviceDate)
    .filter((slot) => holdsSpace(slot.status))
    .sort((left, right) => left.startMinute - right.startMinute || left.id.localeCompare(right.id));

  const turns: Turn[] = [];
  for (let index = 0; index < slots.length; index += 1) {
    const earlier = slots[index];
    if (earlier === undefined) continue;
    const footprint = new Set(physicalFootprint(db, propertyCode, earlier.spaceCode));

    for (let next = index + 1; next < slots.length; next += 1) {
      const later = slots[next];
      if (later === undefined) continue;
      const shares = physicalFootprint(db, propertyCode, later.spaceCode).some((part) =>
        footprint.has(part),
      );
      if (!shares) {
        continue;
      }
      const standard = turnStandard(
        db,
        propertyCode,
        later.spaceCode,
        earlier.setupStyle,
        later.setupStyle,
      );
      const gapMinutes = later.startMinute - earlier.endMinute;
      const shortMinutes = Math.max(standard.minutes - gapMinutes, 0);
      turns.push({
        spaceCode: later.spaceCode,
        fromId: earlier.id,
        fromName: earlier.name,
        toId: later.id,
        toName: later.name,
        gapMinutes,
        standard,
        shortMinutes,
        tight: shortMinutes > 0,
        headsNeeded: shortMinutes > 0 ? standard.heads : 0,
      });
      // Only the next function in that footprint is a turn. Anything after it
      // is somebody else's turn, from the room as this one leaves it.
      break;
    }
  }

  return {
    propertyCode,
    serviceDate,
    turns,
    tight: turns.filter((turn) => turn.tight).length,
    headsAtOnce: turns.reduce((most, turn) => Math.max(most, turn.headsNeeded), 0),
  };
}

/** Just the ones that do not fit, which is what a director of operations reads. */
export function tightTurns(
  db: Database,
  propertyCode: CatalogCode,
  serviceDate: CalendarDate,
): Turn[] {
  return turnPlan(db, propertyCode, serviceDate).turns.filter((turn) => turn.tight);
}
