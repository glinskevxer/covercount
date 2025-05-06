/**
 * Requisitions.
 *
 * The explosion is a calculation and the requisition is a document. They are
 * different things on purpose: the calculation moves every time the guarantee
 * or the split moves, and the requisition is what was actually asked of the
 * store on a given morning. Once it is issued it stops tracking the
 * calculation, because the case of short rib has left the walk in.
 */

import { calendarDate } from '../core/calendar.js';
import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, parseEntityId, type CatalogCode, type EntityId } from '../core/ids.js';
import type { Quantity } from '../core/quantity.js';
import type { UnitCode } from '../core/units.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import { allocateEntityId } from '../store/sequence.js';
import { ingredientDemandForFunctions, type IngredientDemand } from './explode.js';
import {
  isRequisitionStatus,
  isStoreArea,
  type Requisition,
  type RequisitionLine,
  type RequisitionStatus,
  type StoreArea,
} from './types.js';

interface RequisitionRow {
  id: string;
  property_code: string;
  service_date: string;
  store: string;
  status: string;
  created_at: string;
  note: string;
}

interface LineRow {
  ingredient_code: string;
  needed_milli: number;
  needed_unit: string;
  packs: number;
  position: number;
}

function toRequisition(row: RequisitionRow): Requisition {
  return {
    id: parseEntityId('requisition', row.id),
    propertyCode: catalogCode(row.property_code),
    serviceDate: calendarDate(row.service_date),
    store: row.store as StoreArea,
    status: row.status as RequisitionStatus,
    note: row.note,
    createdAt: row.created_at,
  };
}

export interface RaiseRequisitionInput {
  readonly serviceDate: string;
  readonly store: string;
  readonly functionIds: readonly string[];
  readonly note?: string;
}

/**
 * Draw a requisition for one store out of the demand of a set of functions.
 * A store with nothing in it is refused rather than written empty, because an
 * empty requisition on the pass reads as a store that has already been picked.
 */
export function raiseRequisition(
  db: Database,
  propertyCode: CatalogCode,
  input: RaiseRequisitionInput,
  now: string,
): Requisition {
  requireProperty(db, propertyCode);
  const store = input.store.trim().toUpperCase();
  if (!isStoreArea(store)) {
    throw invalidInput('requisition.store', `${input.store} is not a store this kitchen keeps`);
  }
  const serviceDate = calendarDate(input.serviceDate);
  if (input.functionIds.length === 0) {
    throw invalidInput('requisition.functions', 'a requisition needs at least one function on it');
  }

  const functionIds = input.functionIds.map((id) => parseEntityId('functionSlot', id));
  const demand = ingredientDemandForFunctions(db, functionIds).filter((row) => row.store === store);
  if (demand.length === 0) {
    throw conflict('requisition.empty', `nothing on those functions comes out of ${store}`, store);
  }

  return inTransaction(db, (handle) => {
    const id = allocateEntityId(
      handle,
      propertyCode,
      'requisition',
      Number(serviceDate.slice(0, 4)),
    );
    handle
      .prepare(
        `insert into requisition (id, property_code, service_date, store, status, created_at, note)
         values (?, ?, ?, ?, 'DRAFT', ?, ?)`,
      )
      .run(id, propertyCode, serviceDate, store, now, (input.note ?? '').trim());

    writeLines(handle, id, demand);
    return requireRequisition(handle, id);
  });
}

function writeLines(
  db: Database,
  id: EntityId<'requisition'>,
  demand: readonly IngredientDemand[],
): void {
  db.prepare('delete from requisition_line where requisition_id = ?').run(id);
  const insert = db.prepare(
    `insert into requisition_line (requisition_id, ingredient_code, needed_milli, needed_unit,
      packs, position)
     values (?, ?, ?, ?, ?, ?)`,
  );
  demand.forEach((row, index) => {
    insert.run(id, row.ingredientCode, row.needed.milli, row.needed.unit, row.packs, index + 1);
  });
}

export function findRequisition(
  db: Database,
  id: EntityId<'requisition'>,
): Requisition | undefined {
  const row = db
    .prepare<[string], RequisitionRow>('select * from requisition where id = ?')
    .get(id);
  return row === undefined ? undefined : toRequisition(row);
}

export function requireRequisition(db: Database, id: EntityId<'requisition'>): Requisition {
  const found = findRequisition(db, id);
  if (found === undefined) {
    throw notFound('requisition.missing', id, `requisition ${id} is not on file`);
  }
  return found;
}

export function requisitionLines(db: Database, id: EntityId<'requisition'>): RequisitionLine[] {
  return db
    .prepare<[string], LineRow>(
      'select * from requisition_line where requisition_id = ? order by position',
    )
    .all(id)
    .map((row) => ({
      ingredientCode: catalogCode(row.ingredient_code),
      needed: { milli: row.needed_milli, unit: row.needed_unit as UnitCode } satisfies Quantity,
      packs: row.packs,
      position: row.position,
    }));
}

export interface RequisitionQuery {
  readonly serviceDate?: string;
  readonly store?: string;
  readonly status?: string;
}

export function listRequisitions(
  db: Database,
  propertyCode: CatalogCode,
  query: RequisitionQuery = {},
): Requisition[] {
  const clauses = ['property_code = ?'];
  const params: string[] = [propertyCode];
  if (query.serviceDate !== undefined) {
    clauses.push('service_date = ?');
    params.push(calendarDate(query.serviceDate));
  }
  if (query.store !== undefined) {
    const store = query.store.trim().toUpperCase();
    if (!isStoreArea(store)) {
      throw invalidInput('requisition.store', `${query.store} is not a store this kitchen keeps`);
    }
    clauses.push('store = ?');
    params.push(store);
  }
  if (query.status !== undefined) {
    const status = query.status.trim().toUpperCase();
    if (!isRequisitionStatus(status)) {
      throw invalidInput('requisition.status', `${query.status} is not a requisition status`);
    }
    clauses.push('status = ?');
    params.push(status);
  }
  return db
    .prepare<string[], RequisitionRow>(
      `select * from requisition where ${clauses.join(' and ')}
       order by service_date, store, id`,
    )
    .all(...params)
    .map(toRequisition);
}

const NEXT_STATUS: Readonly<Record<RequisitionStatus, readonly RequisitionStatus[]>> = {
  DRAFT: ['ISSUED', 'CANCELLED'],
  ISSUED: ['PICKED', 'CANCELLED'],
  PICKED: [],
  CANCELLED: [],
};

export function advanceRequisition(
  db: Database,
  id: EntityId<'requisition'>,
  to: string,
): Requisition {
  const requisition = requireRequisition(db, id);
  const target = to.trim().toUpperCase();
  if (!isRequisitionStatus(target)) {
    throw invalidInput('requisition.status', `${to} is not a requisition status`);
  }
  if (requisition.status === target) {
    return requisition;
  }
  if (!NEXT_STATUS[requisition.status].includes(target)) {
    throw conflict(
      'requisition.transition',
      `a ${requisition.status} requisition cannot become ${target}`,
      id,
    );
  }
  db.prepare('update requisition set status = ? where id = ?').run(target, id);
  return requireRequisition(db, id);
}

/**
 * Redraw a draft against the demand as it stands now. A requisition that has
 * left the office is not redrawn, because the store has already picked to it.
 */
export function refreshRequisition(
  db: Database,
  id: EntityId<'requisition'>,
  functionIds: readonly string[],
): RequisitionLine[] {
  const requisition = requireRequisition(db, id);
  if (requisition.status !== 'DRAFT') {
    throw conflict(
      'requisition.issued',
      `${id} is ${requisition.status} and cannot be redrawn`,
      id,
    );
  }
  const demand = ingredientDemandForFunctions(
    db,
    functionIds.map((each) => parseEntityId('functionSlot', each)),
  ).filter((row) => row.store === requisition.store);

  return inTransaction(db, (handle) => {
    writeLines(handle, id, demand);
    return requisitionLines(handle, id);
  });
}

export function totalPacks(db: Database, id: EntityId<'requisition'>): number {
  return requisitionLines(db, id).reduce((total, line) => total + line.packs, 0);
}
