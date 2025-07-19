/**
 * Banquet event order revisions.
 *
 * Drawing a revision freezes the document as JSON. Nothing reads it back
 * through the live tables, so a sheet drawn in February still says what it
 * said in February even after the guarantee, the split and the crew have all
 * moved. That is the whole reason revisions exist: the argument is always
 * about what the sheet said, never about what the system says now.
 *
 * A signed revision is immutable. Changing anything after a signature means
 * drawing a new one, which is what a change order is for.
 */

import { conflict, invalidInput, notFound, notPermitted } from '../core/errors.js';
import { catalogCode, parseEntityId, type EntityId } from '../core/ids.js';
import { requireFunction } from '../booking/functions.js';
import { inTransaction, type Database } from '../store/database.js';
import { allocateEntityId } from '../store/sequence.js';
import { assembleOrder, renderOrder, type BanquetEventOrder } from './document.js';

export const ORDER_STATUSES = ['DRAFT', 'DISTRIBUTED', 'SIGNED', 'SUPERSEDED'] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export interface OrderRevision {
  readonly id: EntityId<'beo'>;
  readonly functionId: EntityId<'functionSlot'>;
  readonly revision: number;
  readonly status: OrderStatus;
  readonly drawnAt: string;
  readonly drawnBy: string;
  readonly signedAt: string | undefined;
  readonly signedBy: string | undefined;
  readonly note: string;
}

interface RevisionRow {
  id: string;
  function_id: string;
  property_code: string;
  revision: number;
  status: string;
  body: string;
  drawn_at: string;
  drawn_by: string;
  signed_at: string | null;
  signed_by: string | null;
  note: string;
}

function toRevision(row: RevisionRow): OrderRevision {
  return {
    id: parseEntityId('beo', row.id),
    functionId: parseEntityId('functionSlot', row.function_id),
    revision: row.revision,
    status: row.status as OrderStatus,
    drawnAt: row.drawn_at,
    drawnBy: row.drawn_by,
    signedAt: row.signed_at ?? undefined,
    signedBy: row.signed_by ?? undefined,
    note: row.note,
  };
}

/** Draw a new revision, superseding whatever was live. */
export function drawRevision(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  now: string,
  drawnBy = 'system',
  note = '',
): OrderRevision {
  const slot = requireFunction(db, functionId);
  const order = assembleOrder(db, functionId);

  return inTransaction(db, (handle) => {
    const highest = handle
      .prepare<
        [string],
        { revision: number | null }
      >('select max(revision) as revision from beo where function_id = ?')
      .get(functionId);
    const revision = (highest?.revision ?? -1) + 1;

    handle
      .prepare(
        `update beo set status = 'SUPERSEDED'
         where function_id = ? and status in ('DRAFT', 'DISTRIBUTED')`,
      )
      .run(functionId);

    const id = allocateEntityId(
      handle,
      slot.propertyCode,
      'beo',
      Number(slot.serviceDate.slice(0, 4)),
    );
    handle
      .prepare(
        `insert into beo (id, function_id, property_code, revision, status, body,
          drawn_at, drawn_by, note)
         values (?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`,
      )
      .run(
        id,
        functionId,
        slot.propertyCode,
        revision,
        JSON.stringify(order),
        now,
        drawnBy.trim() || 'system',
        note.trim(),
      );
    return requireRevision(handle, id);
  });
}

export function findRevision(db: Database, id: EntityId<'beo'>): OrderRevision | undefined {
  const row = db.prepare<[string], RevisionRow>('select * from beo where id = ?').get(id);
  return row === undefined ? undefined : toRevision(row);
}

export function requireRevision(db: Database, id: EntityId<'beo'>): OrderRevision {
  const found = findRevision(db, id);
  if (found === undefined) {
    throw notFound('beo.missing', id, `banquet event order ${id} is not on file`);
  }
  return found;
}

export function listRevisions(db: Database, functionId: EntityId<'functionSlot'>): OrderRevision[] {
  return db
    .prepare<[string], RevisionRow>('select * from beo where function_id = ? order by revision')
    .all(functionId)
    .map(toRevision);
}

/** The revision the kitchen should be working from, if there is one. */
export function liveRevision(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): OrderRevision | undefined {
  return [...listRevisions(db, functionId)].reverse().find((row) => row.status !== 'SUPERSEDED');
}

/** The frozen document, exactly as it was when the revision was drawn. */
export function revisionBody(db: Database, id: EntityId<'beo'>): BanquetEventOrder {
  const row = db.prepare<[string], { body: string }>('select body from beo where id = ?').get(id);
  if (row === undefined) {
    throw notFound('beo.missing', id, `banquet event order ${id} is not on file`);
  }
  return JSON.parse(row.body) as BanquetEventOrder;
}

export function renderRevision(db: Database, id: EntityId<'beo'>): string {
  const revision = requireRevision(db, id);
  const body = revisionBody(db, id);
  const header = `${revision.id} revision ${revision.revision}, ${revision.status.toLowerCase()}`;
  return `${header}\n${'='.repeat(header.length)}\n${renderOrder(body)}`;
}

const NEXT_ORDER_STATUS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  DRAFT: ['DISTRIBUTED', 'SUPERSEDED'],
  DISTRIBUTED: ['SIGNED', 'SUPERSEDED'],
  SIGNED: [],
  SUPERSEDED: [],
};

export function distributeRevision(db: Database, id: EntityId<'beo'>): OrderRevision {
  const revision = requireRevision(db, id);
  assertCanMove(revision, 'DISTRIBUTED');
  const body = revisionBody(db, id);
  if (body.warnings.length > 0) {
    throw conflict(
      'beo.warnings',
      `${id} still carries ${body.warnings.length} warnings and should not go out`,
      id,
    );
  }
  db.prepare("update beo set status = 'DISTRIBUTED' where id = ?").run(id);
  return requireRevision(db, id);
}

export function signRevision(
  db: Database,
  id: EntityId<'beo'>,
  signedBy: string,
  now: string,
): OrderRevision {
  const revision = requireRevision(db, id);
  assertCanMove(revision, 'SIGNED');
  const who = signedBy.trim();
  if (who.length === 0) {
    throw invalidInput('beo.signature', 'a signature needs a name on it');
  }
  db.prepare("update beo set status = 'SIGNED', signed_at = ?, signed_by = ? where id = ?").run(
    now,
    who,
    id,
  );
  return requireRevision(db, id);
}

function assertCanMove(revision: OrderRevision, to: OrderStatus): void {
  if (revision.status === to) {
    return;
  }
  if (!NEXT_ORDER_STATUS[revision.status].includes(to)) {
    throw notPermitted(
      'beo.transition',
      `a ${revision.status} banquet event order cannot become ${to}`,
    );
  }
}

/**
 * Whether the live sheet still matches what the system says. A signed sheet
 * that has drifted is the thing a coordinator most needs to be told about,
 * because the kitchen is cooking to the old one.
 */
export function revisionIsStale(db: Database, functionId: EntityId<'functionSlot'>): boolean {
  const live = liveRevision(db, functionId);
  if (live === undefined) {
    return true;
  }
  return (
    JSON.stringify(revisionBody(db, live.id)) !== JSON.stringify(assembleOrder(db, functionId))
  );
}

export interface RevisionDrift {
  readonly field: string;
  readonly was: string;
  readonly becomes: string;
}

/** What has moved since the live sheet was drawn, in the words of a change order. */
export function revisionDrift(db: Database, functionId: EntityId<'functionSlot'>): RevisionDrift[] {
  const live = liveRevision(db, functionId);
  if (live === undefined) {
    return [];
  }
  const was = revisionBody(db, live.id);
  const now = assembleOrder(db, functionId);
  const drift: RevisionDrift[] = [];

  const compare = (field: string, left: unknown, right: unknown): void => {
    const before = typeof left === 'string' ? left : JSON.stringify(left);
    const after = typeof right === 'string' ? right : JSON.stringify(right);
    if (before !== after) {
      drift.push({ field, was: before, becomes: after });
    }
  };

  compare('room', was.header.room, now.header.room);
  compare('serviceDate', was.header.serviceDate, now.header.serviceDate);
  compare('start', was.header.start, now.header.start);
  compare('end', was.header.end, now.header.end);
  compare('setupStyle', was.header.setupStyle, now.header.setupStyle);
  compare('guaranteed', String(was.covers.guaranteed), String(now.covers.guaranteed));
  compare('special', String(was.covers.special), String(now.covers.special));
  compare('setFor', String(was.covers.setFor), String(now.covers.setFor));
  compare('menu', was.menu, now.menu);
  compare('specials', was.specials, now.specials);
  compare('charges', was.charges, now.charges);

  return drift;
}

export function propertyOf(db: Database, id: EntityId<'beo'>) {
  const row = db
    .prepare<[string], { property_code: string }>('select property_code from beo where id = ?')
    .get(id);
  if (row === undefined) {
    throw notFound('beo.missing', id, `banquet event order ${id} is not on file`);
  }
  return catalogCode(row.property_code);
}
