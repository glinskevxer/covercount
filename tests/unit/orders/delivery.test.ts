import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedLabour } from '../../support/labour.js';
import { buildRoster } from '../../../src/labour/shifts.js';
import { drawPackageCharges } from '../../../src/billing/charges.js';
import { distributeRevision, drawRevision } from '../../../src/orders/revisions.js';
import {
  acknowledge,
  addRecipient,
  deliveryStanding,
  isDeliveryChannel,
  listDeliveries,
  listRecipients,
  retireRecipient,
  sendRevision,
} from '../../../src/orders/delivery.js';
import type { Database } from '../../../src/store/database.js';

const LATER = '2025-04-11T09:00:00.000Z';

function ready(db: Database) {
  const slot = readyFunction(db, { guarantee: 180 });
  seedLabour(db);
  buildRoster(db, slot.id, KITCHEN_NOW);
  drawPackageCharges(db, slot.id);
  return slot;
}

function standingList(db: Database): void {
  addRecipient(db, CANYON, { recipient: 'chef@canyon', role: 'Executive chef', channel: 'email' });
  addRecipient(db, CANYON, { recipient: 'Banquet board', role: 'Houseman', channel: 'BOARD' });
  addRecipient(db, CANYON, { recipient: 'client@fenwick', role: 'Client', channel: 'EMAIL' });
}

describe('the standing list', () => {
  it('reads back in role order', () => {
    withStore((db) => {
      ready(db);
      standingList(db);
      expect(listRecipients(db, CANYON).map((row) => row.role)).toEqual([
        'Client',
        'Executive chef',
        'Houseman',
      ]);
    });
  });

  it('replaces a recipient rather than doubling them', () => {
    withStore((db) => {
      ready(db);
      addRecipient(db, CANYON, { recipient: 'chef@canyon', role: 'Chef', channel: 'EMAIL' });
      addRecipient(db, CANYON, {
        recipient: 'chef@canyon',
        role: 'Executive chef',
        channel: 'PRINT',
      });
      const list = listRecipients(db, CANYON);
      expect(list).toHaveLength(1);
      expect(list[0]?.role).toBe('Executive chef');
      expect(list[0]?.channel).toBe('PRINT');
    });
  });

  it('refuses a nameless recipient, a roleless one and a channel it does not have', () => {
    withStore((db) => {
      ready(db);
      expect(() =>
        addRecipient(db, CANYON, { recipient: '  ', role: 'Chef', channel: 'EMAIL' }),
      ).toThrow(/a recipient cannot be blank/);
      expect(() =>
        addRecipient(db, CANYON, { recipient: 'chef@canyon', role: ' ', channel: 'EMAIL' }),
      ).toThrow(/a role cannot be blank/);
      expect(() =>
        addRecipient(db, CANYON, { recipient: 'chef@canyon', role: 'Chef', channel: 'PIGEON' }),
      ).toThrow(/not a channel/);
      expect(isDeliveryChannel('BOARD')).toBe(true);
      expect(isDeliveryChannel('PIGEON')).toBe(false);
    });
  });

  it('retires somebody without losing them', () => {
    withStore((db) => {
      ready(db);
      standingList(db);
      expect(retireRecipient(db, CANYON, 'client@fenwick')).toBe(true);
      expect(listRecipients(db, CANYON)).toHaveLength(2);
      expect(listRecipients(db, CANYON, { activeOnly: false })).toHaveLength(3);
    });
  });
});

describe('sending a revision out', () => {
  it('writes one row per recipient', () => {
    withStore((db) => {
      const slot = ready(db);
      standingList(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      distributeRevision(db, drawn.id);

      const sent = sendRevision(db, drawn.id, LATER);
      expect(sent).toHaveLength(3);
      expect(sent.map((row) => row.recipient).sort()).toEqual([
        'Banquet board',
        'chef@canyon',
        'client@fenwick',
      ]);
      expect(sent.every((row) => row.sentAt === LATER)).toBe(true);
      expect(listDeliveries(db, drawn.id)).toHaveLength(3);
    });
  });

  it('will not send a draft', () => {
    withStore((db) => {
      const slot = ready(db);
      standingList(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      expect(() => sendRevision(db, drawn.id, LATER)).toThrow(/still a draft/);
    });
  });

  it('says so when nobody is on the list', () => {
    withStore((db) => {
      const slot = ready(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      distributeRevision(db, drawn.id);
      expect(() => sendRevision(db, drawn.id, LATER)).toThrow(/nobody on its distribution list/);
    });
  });

  it('keeps what was sent when somebody is retired afterwards', () => {
    withStore((db) => {
      const slot = ready(db);
      standingList(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      distributeRevision(db, drawn.id);
      sendRevision(db, drawn.id, LATER);

      retireRecipient(db, CANYON, 'client@fenwick');
      expect(listRecipients(db, CANYON)).toHaveLength(2);
      expect(listDeliveries(db, drawn.id)).toHaveLength(3);
      expect(listDeliveries(db, drawn.id).some((row) => row.recipient === 'client@fenwick')).toBe(
        true,
      );
    });
  });

  it('records a second send as a second set of rows', () => {
    withStore((db) => {
      const slot = ready(db);
      standingList(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      distributeRevision(db, drawn.id);
      sendRevision(db, drawn.id, LATER);
      sendRevision(db, drawn.id, '2025-04-12T09:00:00.000Z');
      expect(listDeliveries(db, drawn.id)).toHaveLength(6);
    });
  });
});

describe('who has said they got it', () => {
  it('counts the acknowledgements and names who is still waiting', () => {
    withStore((db) => {
      const slot = ready(db);
      standingList(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      distributeRevision(db, drawn.id);
      const sent = sendRevision(db, drawn.id, LATER);

      expect(deliveryStanding(db, drawn.id).acknowledged).toBe(0);
      expect(deliveryStanding(db, drawn.id).complete).toBe(false);

      acknowledge(db, sent[0]?.id ?? 0, '2025-04-11T10:00:00.000Z');
      const partway = deliveryStanding(db, drawn.id);
      expect(partway.acknowledged).toBe(1);
      expect(partway.waiting).toHaveLength(2);
      expect(partway.complete).toBe(false);

      for (const delivery of partway.waiting) {
        acknowledge(db, delivery.id, '2025-04-11T11:00:00.000Z');
      }
      const done = deliveryStanding(db, drawn.id);
      expect(done.complete).toBe(true);
      expect(done.waiting).toEqual([]);
    });
  });

  it('will not acknowledge the same delivery twice', () => {
    withStore((db) => {
      const slot = ready(db);
      standingList(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      distributeRevision(db, drawn.id);
      const sent = sendRevision(db, drawn.id, LATER);
      const first = sent[0]?.id ?? 0;
      acknowledge(db, first, LATER);
      expect(() => acknowledge(db, first, LATER)).toThrow(/already acknowledged/);
      expect(() => acknowledge(db, 9_999, LATER)).toThrow(/is not on file/);
    });
  });

  it('is not complete when nothing has been sent at all', () => {
    withStore((db) => {
      const slot = ready(db);
      const drawn = drawRevision(db, slot.id, KITCHEN_NOW);
      const standing = deliveryStanding(db, drawn.id);
      expect(standing.sent).toBe(0);
      expect(standing.complete).toBe(false);
    });
  });
});
