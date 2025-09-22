/**
 * Equipment and the setup rules that pull it.
 *
 * A requirement is three numbers: so many per cover, so many per table, and a
 * flat number whatever the size. A place setting is per cover, a cloth is per
 * table, and a lectern is one however many people are in the room. Between
 * them those three cover everything a banquet department pulls, and the pull
 * sheet then follows the guarantee without anybody retyping it.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { money, type Money } from '../core/money.js';
import { isSetupStyle, seatsPerTable, type SetupStyle } from '../property/types.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';

export const EQUIPMENT_KINDS = [
  'TABLE',
  'SEATING',
  'LINEN',
  'CHINA',
  'GLASS',
  'CUTLERY',
  'BUFFET',
  'AV',
  'STAGING',
] as const;

export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

export function isEquipmentKind(value: string): value is EquipmentKind {
  return (EQUIPMENT_KINDS as readonly string[]).includes(value);
}

export interface Equipment {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly kind: EquipmentKind;
  /** How many the property owns. Zero means it is always hired in. */
  readonly owned: number;
  readonly rental: Money;
  readonly createdAt: string;
}

export interface SetupRequirement {
  readonly setupStyle: SetupStyle;
  readonly equipmentCode: CatalogCode;
  readonly perCover: number;
  readonly perTable: number;
  readonly fixed: number;
}

interface EquipmentRow {
  property_code: string;
  code: string;
  name: string;
  kind: string;
  owned: number;
  rental_minor: number;
  created_at: string;
}

function toEquipment(row: EquipmentRow, currency: Money['currency']): Equipment {
  return {
    propertyCode: catalogCode(row.property_code),
    code: catalogCode(row.code),
    name: row.name,
    kind: row.kind as EquipmentKind,
    owned: row.owned,
    rental: money(row.rental_minor, currency),
    createdAt: row.created_at,
  };
}

export interface CreateEquipmentInput {
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly owned?: number;
  readonly rentalMinor?: number;
}

export function createEquipment(
  db: Database,
  propertyCode: CatalogCode,
  input: CreateEquipmentInput,
  now: string,
): Equipment {
  requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  if (input.name.trim().length === 0) {
    throw invalidInput('equipment.name', 'a piece of equipment needs a name');
  }
  const kind = input.kind.trim().toUpperCase();
  if (!isEquipmentKind(kind)) {
    throw invalidInput('equipment.kind', `${input.kind} is not a kind of equipment`);
  }
  const owned = input.owned ?? 0;
  if (!Number.isInteger(owned) || owned < 0) {
    throw invalidInput('equipment.owned', 'the owned count is a whole number');
  }
  const rental = input.rentalMinor ?? 0;
  if (!Number.isSafeInteger(rental) || rental < 0) {
    throw invalidInput('equipment.rental', 'a rental rate is a whole number of minor units');
  }

  const clash = db
    .prepare<
      [string, string],
      { code: string }
    >('select code from equipment where property_code = ? and code = ?')
    .get(propertyCode, code);
  if (clash !== undefined) {
    throw conflict('equipment.exists', `${propertyCode} already has ${code} on file`, code);
  }

  db.prepare(
    `insert into equipment (property_code, code, name, kind, owned, rental_minor, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(propertyCode, code, input.name.trim(), kind, owned, rental, now);

  return requireEquipment(db, propertyCode, code);
}

export function findEquipment(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): Equipment | undefined {
  const property = requireProperty(db, propertyCode);
  const row = db
    .prepare<
      [string, string],
      EquipmentRow
    >('select * from equipment where property_code = ? and code = ?')
    .get(propertyCode, code);
  return row === undefined ? undefined : toEquipment(row, property.currency);
}

export function requireEquipment(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): Equipment {
  const found = findEquipment(db, propertyCode, code);
  if (found === undefined) {
    throw notFound('equipment.missing', code, `${propertyCode} has no ${code} on file`);
  }
  return found;
}

export function listEquipment(db: Database, propertyCode: CatalogCode): Equipment[] {
  const property = requireProperty(db, propertyCode);
  return db
    .prepare<[string], EquipmentRow>(
      'select * from equipment where property_code = ? order by code',
    )
    .all(propertyCode)
    .map((row) => toEquipment(row, property.currency));
}

export interface SetRequirementInput {
  readonly setupStyle: string;
  readonly equipmentCode: string;
  readonly perCover?: number;
  readonly perTable?: number;
  readonly fixed?: number;
}

export function setRequirement(
  db: Database,
  propertyCode: CatalogCode,
  input: SetRequirementInput,
): SetupRequirement {
  const setupStyle = input.setupStyle.trim().toUpperCase();
  if (!isSetupStyle(setupStyle)) {
    throw invalidInput('equipment.style', `${input.setupStyle} is not a setup style`);
  }
  const equipmentCode = catalogCode(input.equipmentCode);
  requireEquipment(db, propertyCode, equipmentCode);

  const perCover = input.perCover ?? 0;
  const perTable = input.perTable ?? 0;
  const fixed = input.fixed ?? 0;
  for (const [label, value] of [
    ['per cover', perCover],
    ['per table', perTable],
    ['fixed', fixed],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw invalidInput('equipment.rule', `the ${label} count is a whole number, got ${value}`);
    }
  }
  if (perCover === 0 && perTable === 0 && fixed === 0) {
    throw invalidInput(
      'equipment.rule',
      `${equipmentCode} would never be pulled for a ${setupStyle} setup, so the rule does nothing`,
    );
  }
  if (perTable > 0 && seatsPerTable(setupStyle) === undefined) {
    throw invalidInput(
      'equipment.rule',
      `${setupStyle} has no tables, so a per table count on ${equipmentCode} cannot be worked out`,
    );
  }

  db.prepare(
    `insert into setup_requirement (property_code, setup_style, equipment_code, per_cover,
      per_table, fixed)
     values (?, ?, ?, ?, ?, ?)
     on conflict (property_code, setup_style, equipment_code) do update set
       per_cover = excluded.per_cover,
       per_table = excluded.per_table,
       fixed = excluded.fixed`,
  ).run(propertyCode, setupStyle, equipmentCode, perCover, perTable, fixed);

  return { setupStyle, equipmentCode, perCover, perTable, fixed };
}

export function listRequirements(
  db: Database,
  propertyCode: CatalogCode,
  setupStyle: SetupStyle,
): SetupRequirement[] {
  return db
    .prepare<
      [string, string],
      {
        setup_style: string;
        equipment_code: string;
        per_cover: number;
        per_table: number;
        fixed: number;
      }
    >(
      `select setup_style, equipment_code, per_cover, per_table, fixed
       from setup_requirement where property_code = ? and setup_style = ?
       order by equipment_code`,
    )
    .all(propertyCode, setupStyle)
    .map((row) => ({
      setupStyle: row.setup_style as SetupStyle,
      equipmentCode: catalogCode(row.equipment_code),
      perCover: row.per_cover,
      perTable: row.per_table,
      fixed: row.fixed,
    }));
}

export interface EquipmentPull {
  readonly equipmentCode: CatalogCode;
  readonly name: string;
  readonly kind: EquipmentKind;
  readonly quantity: number;
  readonly owned: number;
  readonly shortfall: number;
  readonly rental: Money;
}

/** How many tables a setup needs for a cover count, or none if it has none. */
export function tablesFor(setupStyle: SetupStyle, covers: number): number {
  const seats = seatsPerTable(setupStyle);
  if (seats === undefined || covers <= 0) {
    return 0;
  }
  return Math.ceil(covers / seats);
}

/**
 * What a setup pulls for a cover count, and what the property is short of.
 * The shortfall is the number that has to be hired in, which is the number the
 * banquet manager actually wants.
 */
export function pullFor(
  db: Database,
  propertyCode: CatalogCode,
  setupStyle: SetupStyle,
  covers: number,
): EquipmentPull[] {
  if (!Number.isInteger(covers) || covers < 0) {
    throw invalidInput('equipment.covers', 'a cover count is a whole number');
  }
  const tables = tablesFor(setupStyle, covers);
  return listRequirements(db, propertyCode, setupStyle).map((rule) => {
    const item = requireEquipment(db, propertyCode, rule.equipmentCode);
    const quantity = rule.fixed + rule.perCover * covers + rule.perTable * tables;
    return {
      equipmentCode: item.code,
      name: item.name,
      kind: item.kind,
      quantity,
      owned: item.owned,
      shortfall: Math.max(0, quantity - item.owned),
      rental: item.rental,
    };
  });
}

/** Save the pull against a function so it can be argued with and adjusted. */
export function savePull(db: Database, functionId: string, pull: readonly EquipmentPull[]): number {
  return inTransaction(db, (handle) => {
    handle
      .prepare("delete from function_equipment where function_id = ? and source = 'RULE'")
      .run(functionId);
    const insert = handle.prepare(
      `insert into function_equipment (function_id, equipment_code, quantity, source)
       values (?, ?, ?, 'RULE')
       on conflict (function_id, equipment_code) do update set quantity = excluded.quantity`,
    );
    for (const row of pull) {
      insert.run(functionId, row.equipmentCode, row.quantity);
    }
    return pull.length;
  });
}
