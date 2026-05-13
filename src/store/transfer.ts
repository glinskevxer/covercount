/**
 * Moving a property between stores.
 *
 * This is how a property is set up on a second machine, how a template
 * property is copied to a new site, and how somebody hands the whole thing to
 * an auditor. It is deliberately not a backup: a backup is bytes and this is
 * data, so it survives a schema change and a backup does not.
 *
 * The export is ordered so an import can replay it straight through without
 * ever hitting a foreign key that is not there yet. That ordering is the whole
 * design; everything else is a loop.
 */

import { conflict, invalidInput } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { inTransaction, type Database } from './database.js';
import { TARGET_SCHEMA_VERSION } from './schema.js';

/**
 * Tables carrying property data, parents before children. Bookings and
 * everything hanging off them are deliberately not here: a template is the
 * setup, not the business.
 */
export const SETUP_TABLES = [
  'property',
  'function_space',
  'space_component',
  'space_capacity',
  'house_calendar',
  'account',
  'menu_item',
  'menu_item_allergen',
  'menu_item_diet',
  'menu_package',
  'package_course',
  'package_course_item',
  'price_book',
  'price_line',
  'ingredient',
  'recipe',
  'recipe_line',
  'staffing_rule',
  'labour_rate',
  'tax_profile',
  'tax_rate',
  'timeline_template',
  'equipment',
  'setup_requirement',
  'bar_tier',
  'production_factor',
  'cancellation_band',
  'turn_standard',
  'distribution_point',
  'distribution_list',
  'commission_agreement',
  'credit_terms',
  'ingredient_cost',
] as const;

/**
 * Tables that carry a property code and are deliberately not setup.
 *
 * Everything here is either trade (a booking and everything hanging off one),
 * a running figure that belongs to the building it was counted in (the shelf),
 * or a counter that has to start fresh (the id sequence). A new property gets
 * the rules and none of the history, which is the whole point of a setup.
 */
export const NOT_SETUP = [
  'booking',
  'function_slot',
  'invoice',
  'beo',
  'change_order',
  'requisition',
  'space_hold',
  'stock_level',
  'stock_movement',
  'id_sequence',
] as const;

export type SetupTable = (typeof SETUP_TABLES)[number];

export interface SetupExport {
  readonly format: 'covercount-setup';
  readonly version: number;
  readonly propertyCode: CatalogCode;
  readonly exportedAt: string;
  readonly tables: Record<string, Record<string, unknown>[]>;
}

function assertTableName(name: string): string {
  if (!(SETUP_TABLES as readonly string[]).includes(name)) {
    throw invalidInput('transfer.table', `${name} is not a table this build transfers`);
  }
  return name;
}

export function exportSetup(
  db: Database,
  propertyCode: CatalogCode,
  exportedAt: string,
): SetupExport {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of SETUP_TABLES) {
    const column = table === 'property' ? 'code' : 'property_code';
    tables[table] = db
      .prepare<
        [string],
        Record<string, unknown>
      >(`select * from ${assertTableName(table)} where ${column} = ?`)
      .all(propertyCode);
  }
  return {
    format: 'covercount-setup',
    version: TARGET_SCHEMA_VERSION,
    propertyCode,
    exportedAt,
    tables,
  };
}

export interface ImportResult {
  readonly propertyCode: CatalogCode;
  readonly rows: number;
  readonly tables: number;
}

export interface ImportOptions {
  /** Bring the setup in under a different property code. */
  readonly asPropertyCode?: string;
}

export function importSetup(
  db: Database,
  payload: SetupExport,
  options: ImportOptions = {},
): ImportResult {
  if (payload.format !== 'covercount-setup') {
    throw invalidInput('transfer.format', 'that file is not a covercount setup export');
  }
  if (payload.version > TARGET_SCHEMA_VERSION) {
    throw conflict(
      'transfer.version',
      `that export is from schema ${payload.version} and this build carries ${TARGET_SCHEMA_VERSION}`,
    );
  }

  const target =
    options.asPropertyCode === undefined
      ? catalogCode(payload.propertyCode)
      : catalogCode(options.asPropertyCode);

  const already = db
    .prepare<[string], { code: string }>('select code from property where code = ?')
    .get(target);
  if (already !== undefined) {
    throw conflict('transfer.exists', `property ${target} is already on file`, target);
  }

  return inTransaction(db, (handle) => {
    let rows = 0;
    let tables = 0;
    for (const table of SETUP_TABLES) {
      const source = payload.tables[table] ?? [];
      if (source.length === 0) {
        continue;
      }
      tables += 1;
      for (const row of source) {
        const rewritten = rewriteProperty(table, row, target);
        const columns = Object.keys(rewritten);
        const placeholders = columns.map(() => '?').join(', ');
        handle
          .prepare(
            `insert into ${assertTableName(table)} (${columns.join(', ')}) values (${placeholders})`,
          )
          .run(...columns.map((column) => rewritten[column] as string | number | null));
        rows += 1;
      }
    }
    return { propertyCode: target, rows, tables };
  });
}

function rewriteProperty(
  table: string,
  row: Record<string, unknown>,
  target: CatalogCode,
): Record<string, unknown> {
  if (table === 'property') {
    return { ...row, code: target };
  }
  return { ...row, property_code: target };
}

/** Rows in an export, for a caller that wants to say what it is about to do. */
export function countRows(payload: SetupExport): number {
  return Object.values(payload.tables).reduce((total, rows) => total + rows.length, 0);
}
