/**
 * Change orders.
 *
 * Once a sheet is signed, a change is a document rather than an edit. The
 * change order records what moved, who asked, and whether it was asked for
 * after the guarantee closed, because a change after the cutoff is the one the
 * contract lets the property charge for. Applying it draws a fresh revision,
 * so the trail reads: signed at revision two, change order raised, revision
 * three drawn and signed.
 */

import { toInstant } from '../core/clock.js';
import { conflict, invalidInput, notFound, ruleViolation } from '../core/errors.js';
import { parseEntityId, type EntityId } from '../core/ids.js';
import { money, type Money } from '../core/money.js';
import { requireFunction } from '../booking/functions.js';
import { requireCovers } from '../covers/guarantee.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import { allocateEntityId } from '../store/sequence.js';
import { drawRevision, liveRevision, revisionDrift, type RevisionDrift } from './revisions.js';

export const CHANGE_STATUSES = ['RAISED', 'APPLIED', 'DECLINED'] as const;

export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export function isChangeStatus(value: string): value is ChangeStatus {
  return (CHANGE_STATUSES as readonly string[]).includes(value);
}

export interface ChangeOrder {
  readonly id: EntityId<'changeOrder'>;
  readonly functionId: EntityId<'functionSlot'>;
  readonly raisedAt: string;
  readonly raisedBy: string;
  readonly afterCutoff: boolean;
  readonly reason: string;
  readonly status: ChangeStatus;
  readonly fee: Money;
  readonly appliedAt: string | undefined;
}

interface ChangeRow {
  id: string;
  function_id: string;
  property_code: string;
  raised_at: string;
  raised_by: string;
  after_cutoff: number;
  reason: string;
  status: string;
  fee_minor: number;
  applied_at: string | null;
}

function toChange(row: ChangeRow, currency: Money['currency']): ChangeOrder {
  return {
    id: parseEntityId('changeOrder', row.id),
    functionId: parseEntityId('functionSlot', row.function_id),
    raisedAt: row.raised_at,
    raisedBy: row.raised_by,
    afterCutoff: row.after_cutoff === 1,
    reason: row.reason,
    status: row.status as ChangeStatus,
    fee: money(row.fee_minor, currency),
    appliedAt: row.applied_at ?? undefined,
  };
}

export interface RaiseChangeOrderInput {
  readonly reason: string;
  readonly raisedBy?: string;
  readonly feeMinor?: number;
}

/**
 * Raise a change order against whatever has drifted since the live sheet was
 * drawn. A function that has not drifted has nothing to change.
 */
export function raiseChangeOrder(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  input: RaiseChangeOrderInput,
  now: string,
): ChangeOrder {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  const covers = requireCovers(db, functionId);
  const reason = input.reason.trim();
  if (reason.length === 0) {
    throw invalidInput('change.reason', 'a change order needs a reason on it');
  }
  const live = liveRevision(db, functionId);
  if (live === undefined) {
    throw ruleViolation(
      'change.nosheet',
      `${functionId} has no banquet event order drawn, so there is nothing to change`,
      'draw a revision first',
    );
  }
  const drift = revisionDrift(db, functionId);
  if (drift.length === 0) {
    throw ruleViolation(
      'change.nodrift',
      `nothing has moved on ${functionId} since ${live.id} was drawn`,
    );
  }

  const afterCutoff = Date.parse(now) >= toInstant(covers.guaranteeDue);
  const fee = input.feeMinor ?? 0;
  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw invalidInput('change.fee', 'a change order fee is a whole number of minor units');
  }
  if (fee > 0 && !afterCutoff) {
    throw ruleViolation(
      'change.fee',
      'a change raised before the guarantee closed cannot carry a late fee',
    );
  }

  return inTransaction(db, (handle) => {
    const id = allocateEntityId(
      handle,
      slot.propertyCode,
      'changeOrder',
      Number(slot.serviceDate.slice(0, 4)),
    );
    handle
      .prepare(
        `insert into change_order (id, function_id, property_code, raised_at, raised_by,
          after_cutoff, reason, status, fee_minor)
         values (?, ?, ?, ?, ?, ?, ?, 'RAISED', ?)`,
      )
      .run(
        id,
        functionId,
        slot.propertyCode,
        now,
        (input.raisedBy ?? 'system').trim() || 'system',
        afterCutoff ? 1 : 0,
        reason,
        fee,
      );
    const insert = handle.prepare(
      'insert into change_order_line (change_order_id, position, field, was, becomes) values (?, ?, ?, ?, ?)',
    );
    drift.forEach((line, index) => {
      insert.run(id, index + 1, line.field, line.was, line.becomes);
    });
    return requireChangeOrder(handle, id, property.currency);
  });
}

export function findChangeOrder(
  db: Database,
  id: EntityId<'changeOrder'>,
  currency: Money['currency'],
): ChangeOrder | undefined {
  const row = db.prepare<[string], ChangeRow>('select * from change_order where id = ?').get(id);
  return row === undefined ? undefined : toChange(row, currency);
}

export function requireChangeOrder(
  db: Database,
  id: EntityId<'changeOrder'>,
  currency: Money['currency'],
): ChangeOrder {
  const found = findChangeOrder(db, id, currency);
  if (found === undefined) {
    throw notFound('change.missing', id, `change order ${id} is not on file`);
  }
  return found;
}

export function listChangeOrders(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): ChangeOrder[] {
  const slot = requireFunction(db, functionId);
  const property = requireProperty(db, slot.propertyCode);
  return db
    .prepare<[string], ChangeRow>('select * from change_order where function_id = ? order by id')
    .all(functionId)
    .map((row) => toChange(row, property.currency));
}

export function changeOrderLines(db: Database, id: EntityId<'changeOrder'>): RevisionDrift[] {
  return db
    .prepare<[string], { field: string; was: string; becomes: string }>(
      'select field, was, becomes from change_order_line where change_order_id = ? order by position',
    )
    .all(id)
    .map((row) => ({ field: row.field, was: row.was, becomes: row.becomes }));
}

/** Apply the change: draw a fresh revision and bill the fee if there is one. */
export function applyChangeOrder(
  db: Database,
  id: EntityId<'changeOrder'>,
  now: string,
  appliedBy = 'system',
): ChangeOrder {
  const slot = (() => {
    const row = db
      .prepare<
        [string],
        { function_id: string; property_code: string }
      >('select function_id, property_code from change_order where id = ?')
      .get(id);
    if (row === undefined) {
      throw notFound('change.missing', id, `change order ${id} is not on file`);
    }
    return requireFunction(db, parseEntityId('functionSlot', row.function_id));
  })();
  const property = requireProperty(db, slot.propertyCode);
  const change = requireChangeOrder(db, id, property.currency);

  if (change.status !== 'RAISED') {
    throw conflict(
      'change.applied',
      `change order ${id} is ${change.status.toLowerCase()} and cannot be applied again`,
      id,
    );
  }

  return inTransaction(db, (handle) => {
    drawRevision(handle, change.functionId, now, appliedBy, `applied ${id}`);
    if (change.fee.amount > 0) {
      handle
        .prepare(
          `insert into charge_line (function_id, category, description, quantity, unit_minor,
            taxable, serviceable, source, position)
           values (?, 'FEE', ?, 1, ?, 1, 0, 'CHANGE-ORDER',
             (select coalesce(max(position), 0) + 1 from charge_line where function_id = ?))`,
        )
        .run(
          change.functionId,
          `Change order ${id} raised after the guarantee closed`,
          change.fee.amount,
          change.functionId,
        );
    }
    handle
      .prepare("update change_order set status = 'APPLIED', applied_at = ? where id = ?")
      .run(now, id);
    return requireChangeOrder(handle, id, property.currency);
  });
}

export function declineChangeOrder(
  db: Database,
  id: EntityId<'changeOrder'>,
  currency: Money['currency'],
): ChangeOrder {
  const change = requireChangeOrder(db, id, currency);
  if (change.status !== 'RAISED') {
    throw conflict(
      'change.applied',
      `change order ${id} is ${change.status.toLowerCase()} and cannot be declined`,
      id,
    );
  }
  db.prepare("update change_order set status = 'DECLINED' where id = ?").run(id);
  return requireChangeOrder(db, id, currency);
}

/** Change orders raised after the cutoff that nobody has billed for. */
export function unbilledLateChanges(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): ChangeOrder[] {
  return listChangeOrders(db, functionId).filter(
    (change) => change.afterCutoff && change.status === 'RAISED' && change.fee.amount > 0,
  );
}
