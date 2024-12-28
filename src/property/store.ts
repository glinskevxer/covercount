/**
 * Reading and writing the property and its rooms.
 *
 * Every writer validates before it touches the file, because a room with a
 * setup capacity above its fire capacity is not a row anyone should have to
 * find later on a production sheet.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { isCurrencyCode, type CurrencyCode } from '../core/money.js';
import { rate } from '../core/rate.js';
import { timeOfDay, timeZone } from '../core/clock.js';
import { calendarDate } from '../core/calendar.js';
import { inTransaction, type Database } from '../store/database.js';
import {
  isCalendarKind,
  isSetupStyle,
  type FunctionSpace,
  type HouseCalendarEntry,
  type Property,
  type SpaceCapacity,
} from './types.js';

interface PropertyRow {
  code: string;
  name: string;
  time_zone: string;
  currency: string;
  guarantee_lead_days: number;
  guarantee_due_minute: number;
  overset_ppm: number;
  overset_cap: number;
  created_at: string;
}

interface SpaceRow {
  property_code: string;
  code: string;
  name: string;
  floor: string;
  area_sq_ft: number;
  fire_capacity: number;
  setup_minutes: number;
  teardown_minutes: number;
  is_combination: number;
  active: number;
}

export interface CreatePropertyInput {
  readonly code: string;
  readonly name: string;
  readonly timeZone: string;
  readonly currency: string;
  readonly guaranteeLeadDays: number;
  readonly guaranteeDueMinute: number;
  readonly oversetPpm: number;
  readonly oversetCap: number;
}

function toProperty(row: PropertyRow): Property {
  return {
    code: catalogCode(row.code),
    name: row.name,
    timeZone: timeZone(row.time_zone),
    currency: row.currency as CurrencyCode,
    guaranteeLeadDays: row.guarantee_lead_days,
    guaranteeDueTime: timeOfDay(row.guarantee_due_minute),
    oversetRate: rate(row.overset_ppm),
    oversetCap: row.overset_cap,
    createdAt: row.created_at,
  };
}

function toSpace(row: SpaceRow): FunctionSpace {
  return {
    propertyCode: catalogCode(row.property_code),
    code: catalogCode(row.code),
    name: row.name,
    floor: row.floor,
    areaSqFt: row.area_sq_ft,
    fireCapacity: row.fire_capacity,
    setupMinutes: row.setup_minutes,
    teardownMinutes: row.teardown_minutes,
    isCombination: row.is_combination === 1,
    active: row.active === 1,
  };
}

export function createProperty(db: Database, input: CreatePropertyInput, now: string): Property {
  const code = catalogCode(input.code);
  if (input.name.trim().length === 0) {
    throw invalidInput('property.name', 'a property needs a name');
  }
  if (!isCurrencyCode(input.currency)) {
    throw invalidInput('property.currency', `${input.currency} is not a currency this build holds`);
  }
  if (!Number.isInteger(input.guaranteeLeadDays) || input.guaranteeLeadDays < 0) {
    throw invalidInput('property.lead', 'the guarantee lead is a whole number of business days');
  }
  if (input.guaranteeLeadDays > 30) {
    throw invalidInput('property.lead', 'a guarantee lead over thirty business days is a mistake');
  }
  if (input.oversetPpm < 0) {
    throw invalidInput('property.overset', 'the overset cannot be negative');
  }
  if (!Number.isInteger(input.oversetCap) || input.oversetCap < 0) {
    throw invalidInput('property.overset', 'the overset cap is a whole number of covers');
  }
  const zone = timeZone(input.timeZone);
  const due = timeOfDay(input.guaranteeDueMinute);

  const existing = db
    .prepare<[string], { code: string }>('select code from property where code = ?')
    .get(code);
  if (existing !== undefined) {
    throw conflict('property.exists', `property ${code} is already on file`, code);
  }

  db.prepare(
    `insert into property (code, name, time_zone, currency, guarantee_lead_days,
      guarantee_due_minute, overset_ppm, overset_cap, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    code,
    input.name.trim(),
    zone,
    input.currency,
    input.guaranteeLeadDays,
    due,
    input.oversetPpm,
    input.oversetCap,
    now,
  );

  return requireProperty(db, code);
}

export function findProperty(db: Database, code: CatalogCode): Property | undefined {
  const row = db.prepare<[string], PropertyRow>('select * from property where code = ?').get(code);
  return row === undefined ? undefined : toProperty(row);
}

export function requireProperty(db: Database, code: CatalogCode): Property {
  const found = findProperty(db, code);
  if (found === undefined) {
    throw notFound('property.missing', code, `property ${code} is not on file`);
  }
  return found;
}

export function listProperties(db: Database): Property[] {
  return db.prepare<[], PropertyRow>('select * from property order by code').all().map(toProperty);
}

export interface AddSpaceInput {
  readonly code: string;
  readonly name: string;
  readonly floor?: string;
  readonly areaSqFt: number;
  readonly fireCapacity: number;
  readonly setupMinutes: number;
  readonly teardownMinutes: number;
  readonly capacities?: readonly { setupStyle: string; capacity: number }[];
}

export function addSpace(
  db: Database,
  propertyCode: CatalogCode,
  input: AddSpaceInput,
): FunctionSpace {
  requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  if (input.name.trim().length === 0) {
    throw invalidInput('space.name', 'a room needs a name');
  }
  for (const [label, value] of [
    ['area', input.areaSqFt],
    ['fire capacity', input.fireCapacity],
    ['setup minutes', input.setupMinutes],
    ['teardown minutes', input.teardownMinutes],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw invalidInput('space.number', `the ${label} of a room is a whole number, got ${value}`);
    }
  }
  if (input.fireCapacity === 0) {
    throw invalidInput('space.fire', 'a room with a fire capacity of zero cannot hold a function');
  }

  return inTransaction(db, (handle) => {
    const clash = handle
      .prepare<
        [string, string],
        { code: string }
      >('select code from function_space where property_code = ? and code = ?')
      .get(propertyCode, code);
    if (clash !== undefined) {
      throw conflict('space.exists', `${propertyCode} already has a room called ${code}`, code);
    }

    handle
      .prepare(
        `insert into function_space (property_code, code, name, floor, area_sq_ft, fire_capacity,
          setup_minutes, teardown_minutes)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        propertyCode,
        code,
        input.name.trim(),
        input.floor ?? '',
        input.areaSqFt,
        input.fireCapacity,
        input.setupMinutes,
        input.teardownMinutes,
      );

    for (const entry of input.capacities ?? []) {
      setSpaceCapacity(handle, propertyCode, code, entry.setupStyle, entry.capacity);
    }

    return requireSpace(handle, propertyCode, code);
  });
}

export function setSpaceCapacity(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
  setupStyle: string,
  capacity: number,
): void {
  const space = requireSpace(db, propertyCode, spaceCode);
  const style = setupStyle.trim().toUpperCase();
  if (!isSetupStyle(style)) {
    throw invalidInput('space.style', `${setupStyle} is not a setup style this build knows`);
  }
  if (!Number.isInteger(capacity) || capacity < 0) {
    throw invalidInput('space.capacity', 'a capacity is a whole number of covers');
  }
  if (capacity > space.fireCapacity) {
    throw invalidInput(
      'space.capacity',
      `${style} at ${capacity} is over the fire capacity of ${space.fireCapacity} for ${spaceCode}`,
    );
  }
  db.prepare(
    `insert into space_capacity (property_code, space_code, setup_style, capacity)
     values (?, ?, ?, ?)
     on conflict (property_code, space_code, setup_style)
     do update set capacity = excluded.capacity`,
  ).run(propertyCode, spaceCode, style, capacity);
}

export function findSpace(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
): FunctionSpace | undefined {
  const row = db
    .prepare<
      [string, string],
      SpaceRow
    >('select * from function_space where property_code = ? and code = ?')
    .get(propertyCode, spaceCode);
  return row === undefined ? undefined : toSpace(row);
}

export function requireSpace(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
): FunctionSpace {
  const found = findSpace(db, propertyCode, spaceCode);
  if (found === undefined) {
    throw notFound('space.missing', spaceCode, `${propertyCode} has no room called ${spaceCode}`);
  }
  return found;
}

export function listSpaces(db: Database, propertyCode: CatalogCode): FunctionSpace[] {
  return db
    .prepare<
      [string],
      SpaceRow
    >('select * from function_space where property_code = ? order by code')
    .all(propertyCode)
    .map(toSpace);
}

export function spaceCapacities(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
): SpaceCapacity[] {
  return db
    .prepare<[string, string], { space_code: string; setup_style: string; capacity: number }>(
      `select space_code, setup_style, capacity from space_capacity
       where property_code = ? and space_code = ? order by setup_style`,
    )
    .all(propertyCode, spaceCode)
    .map((row) => ({
      spaceCode: catalogCode(row.space_code),
      setupStyle: row.setup_style as SpaceCapacity['setupStyle'],
      capacity: row.capacity,
    }));
}

export function setSpaceActive(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
  active: boolean,
): FunctionSpace {
  requireSpace(db, propertyCode, spaceCode);
  db.prepare('update function_space set active = ? where property_code = ? and code = ?').run(
    active ? 1 : 0,
    propertyCode,
    spaceCode,
  );
  return requireSpace(db, propertyCode, spaceCode);
}

export function addCalendarEntry(
  db: Database,
  propertyCode: CatalogCode,
  entry: { calendar: string; date: string; kind: string; note?: string },
): HouseCalendarEntry {
  requireProperty(db, propertyCode);
  const calendar = entry.calendar.trim().toLowerCase();
  if (!isCalendarKind(calendar)) {
    throw invalidInput('calendar.kind', `${entry.calendar} is not a calendar this build keeps`);
  }
  if (entry.kind !== 'closed' && entry.kind !== 'open') {
    throw invalidInput('calendar.entry', `a calendar entry is closed or open, got ${entry.kind}`);
  }
  const date = calendarDate(entry.date);
  db.prepare(
    `insert into house_calendar (property_code, calendar, service_date, kind, note)
     values (?, ?, ?, ?, ?)
     on conflict (property_code, calendar, service_date)
     do update set kind = excluded.kind, note = excluded.note`,
  ).run(propertyCode, calendar, date, entry.kind, entry.note ?? '');
  return { calendar, date, kind: entry.kind, note: entry.note ?? '' };
}

interface CalendarRow {
  calendar: string;
  service_date: string;
  kind: string;
  note: string;
}

export function listCalendarEntries(
  db: Database,
  propertyCode: CatalogCode,
  calendar: string,
): HouseCalendarEntry[] {
  return db
    .prepare<[string, string], CalendarRow>(
      `select calendar, service_date, kind, note from house_calendar
       where property_code = ? and calendar = ? order by service_date`,
    )
    .all(propertyCode, calendar)
    .map((row) => ({
      calendar: row.calendar as HouseCalendarEntry['calendar'],
      date: calendarDate(row.service_date),
      kind: row.kind as HouseCalendarEntry['kind'],
      note: row.note,
    }));
}
