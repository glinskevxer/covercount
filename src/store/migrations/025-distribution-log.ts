import type { Migration } from '../migrate.js';

export const migration025: Migration = {
  id: 25,
  name: 'who was sent which revision, and when',
  statements: [
    `create table beo_delivery (
      id integer primary key autoincrement,
      beo_id text not null references beo(id) on delete cascade,
      recipient text not null,
      role text not null,
      channel text not null,
      sent_at text not null,
      acknowledged_at text
    )`,

    `create index beo_delivery_by_revision on beo_delivery (beo_id, id)`,

    `create table distribution_list (
      property_code text not null references property(code) on delete cascade,
      recipient text not null,
      role text not null,
      channel text not null,
      active integer not null default 1,
      primary key (property_code, recipient)
    )`,
  ],
};
