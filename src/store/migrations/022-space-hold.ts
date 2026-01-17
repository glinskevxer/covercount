import type { Migration } from '../migrate.js';

export const migration022: Migration = {
  id: 22,
  name: 'tentative holds on space, ranked first and second',
  statements: [
    `create table space_hold (
      id integer primary key autoincrement,
      property_code text not null references property(code) on delete cascade,
      space_code text not null,
      booking_id text not null references booking(id) on delete cascade,
      service_date text not null,
      start_minute integer not null,
      end_minute integer not null,
      rank integer not null,
      holds_until text not null,
      released_at text,
      note text not null default '',
      created_at text not null
    )`,

    `create index space_hold_by_date
      on space_hold (property_code, service_date, released_at)`,
  ],
};
