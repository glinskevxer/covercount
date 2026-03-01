/**
 * Who got the order, and when.
 *
 * Distributing a banquet event order is not one act. The sheet goes to the
 * kitchen, the bars, the houseman, audio visual and the client, and those go
 * out at different times through different channels. When somebody sets the
 * room to the wrong plan the first question is always which revision they were
 * working from, and the honest answer needs a record per recipient rather than
 * a status on the revision.
 *
 * The house keeps a standing list, and a distribution copies that list rather
 * than pointing at it. A recipient removed from the list next month must not
 * change who was recorded as having received last month's sheet.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import type { CatalogCode, EntityId } from '../core/ids.js';
import { requireProperty } from '../property/store.js';
import { propertyOf, requireRevision } from './revisions.js';
import { inTransaction, type Database } from '../store/database.js';

const DELIVERY_CHANNELS = ['EMAIL', 'PRINT', 'BOARD', 'HAND'] as const;

export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export function isDeliveryChannel(value: string): value is DeliveryChannel {
  return (DELIVERY_CHANNELS as readonly string[]).includes(value);
}

export interface Recipient {
  readonly recipient: string;
  readonly role: string;
  readonly channel: DeliveryChannel;
  readonly active: boolean;
}

export interface AddRecipientInput {
  readonly recipient: string;
  readonly role: string;
  readonly channel: string;
}

export function addRecipient(
  db: Database,
  propertyCode: CatalogCode,
  input: AddRecipientInput,
): Recipient {
  requireProperty(db, propertyCode);
  const recipient = input.recipient.trim();
  const role = input.role.trim();
  const channel = input.channel.trim().toUpperCase();
  if (recipient.length === 0) {
    throw invalidInput('delivery.recipient', 'a recipient needs a name');
  }
  if (role.length === 0) {
    throw invalidInput(
      'delivery.role',
      `${recipient} needs a role, so the sheet says why they got it`,
    );
  }
  if (!isDeliveryChannel(channel)) {
    throw invalidInput(
      'delivery.channel',
      `${input.channel} is not a channel, use email, print, board or hand`,
    );
  }
  db.prepare(
    `insert into distribution_list (property_code, recipient, role, channel, active)
     values (?, ?, ?, ?, 1)
     on conflict (property_code, recipient) do update set
       role = excluded.role, channel = excluded.channel, active = 1`,
  ).run(propertyCode, recipient, role, channel);
  return { recipient, role, channel, active: true };
}

export function listRecipients(
  db: Database,
  propertyCode: CatalogCode,
  options: { activeOnly?: boolean } = {},
): Recipient[] {
  const clauses = ['property_code = ?'];
  if (options.activeOnly !== false) {
    clauses.push('active = 1');
  }
  return db
    .prepare<[string], { recipient: string; role: string; channel: string; active: number }>(
      `select * from distribution_list where ${clauses.join(' and ')} order by role, recipient`,
    )
    .all(propertyCode)
    .map((row) => ({
      recipient: row.recipient,
      role: row.role,
      channel: row.channel as DeliveryChannel,
      active: row.active === 1,
    }));
}

/** Take somebody off the list without losing what they were already sent. */
export function retireRecipient(
  db: Database,
  propertyCode: CatalogCode,
  recipient: string,
): boolean {
  return (
    db
      .prepare('update distribution_list set active = 0 where property_code = ? and recipient = ?')
      .run(propertyCode, recipient.trim()).changes > 0
  );
}

export interface Delivery {
  readonly id: number;
  readonly beoId: EntityId<'beo'>;
  readonly recipient: string;
  readonly role: string;
  readonly channel: DeliveryChannel;
  readonly sentAt: string;
  readonly acknowledgedAt: string | undefined;
}

interface DeliveryRow {
  readonly id: number;
  readonly beo_id: string;
  readonly recipient: string;
  readonly role: string;
  readonly channel: string;
  readonly sent_at: string;
  readonly acknowledged_at: string | null;
}

function toDelivery(row: DeliveryRow): Delivery {
  return {
    id: row.id,
    beoId: row.beo_id as EntityId<'beo'>,
    recipient: row.recipient,
    role: row.role,
    channel: row.channel as DeliveryChannel,
    sentAt: row.sent_at,
    acknowledgedAt: row.acknowledged_at ?? undefined,
  };
}

/**
 * Send one revision to the whole standing list.
 *
 * The recipients are copied in as they stand now. A revision sent twice to the
 * same person is two rows, because it happened twice and the second one is
 * usually the interesting one.
 */
export function sendRevision(db: Database, id: EntityId<'beo'>, now: string): Delivery[] {
  const revision = requireRevision(db, id);
  if (revision.status === 'DRAFT') {
    throw conflict(
      'delivery.draft',
      `${id} is still a draft, so distribute it before sending it out`,
      id,
    );
  }
  const propertyCode = propertyOf(db, id);
  const recipients = listRecipients(db, propertyCode);
  if (recipients.length === 0) {
    throw notFound(
      'delivery.list',
      propertyCode,
      `${propertyCode} has nobody on its distribution list`,
    );
  }

  return inTransaction(db, (handle) => {
    const insert = handle.prepare(
      `insert into beo_delivery (beo_id, recipient, role, channel, sent_at, acknowledged_at)
       values (?, ?, ?, ?, ?, null)`,
    );
    const written: Delivery[] = [];
    for (const person of recipients) {
      const result = insert.run(id, person.recipient, person.role, person.channel, now);
      written.push({
        id: Number(result.lastInsertRowid),
        beoId: id,
        recipient: person.recipient,
        role: person.role,
        channel: person.channel,
        sentAt: now,
        acknowledgedAt: undefined,
      });
    }
    return written;
  });
}

export function listDeliveries(db: Database, id: EntityId<'beo'>): Delivery[] {
  return db
    .prepare<[string], DeliveryRow>('select * from beo_delivery where beo_id = ? order by id')
    .all(id)
    .map(toDelivery);
}

export function acknowledge(db: Database, deliveryId: number, now: string): Delivery {
  const row = db
    .prepare<[number], DeliveryRow>('select * from beo_delivery where id = ?')
    .get(deliveryId);
  if (row === undefined) {
    throw notFound('delivery.missing', String(deliveryId), `delivery ${deliveryId} is not on file`);
  }
  if (row.acknowledged_at !== null) {
    throw conflict(
      'delivery.acknowledged',
      `delivery ${deliveryId} was already acknowledged at ${row.acknowledged_at}`,
      String(deliveryId),
    );
  }
  db.prepare('update beo_delivery set acknowledged_at = ? where id = ?').run(now, deliveryId);
  return { ...toDelivery(row), acknowledgedAt: now };
}

export interface DeliveryStanding {
  readonly beoId: EntityId<'beo'>;
  readonly sent: number;
  readonly acknowledged: number;
  readonly waiting: Delivery[];
  readonly complete: boolean;
}

/** Who has still not said they got it, which is the question before service. */
export function deliveryStanding(db: Database, id: EntityId<'beo'>): DeliveryStanding {
  const deliveries = listDeliveries(db, id);
  const waiting = deliveries.filter((row) => row.acknowledgedAt === undefined);
  return {
    beoId: id,
    sent: deliveries.length,
    acknowledged: deliveries.length - waiting.length,
    waiting,
    complete: deliveries.length > 0 && waiting.length === 0,
  };
}
