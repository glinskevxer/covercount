import type { Migration } from '../migrate.js';

export const migration026: Migration = {
  id: 26,
  name: 'tastings, site visits and the pre convention meeting',
  statements: [
    `create table appointment (
      id integer primary key autoincrement,
      booking_id text not null references booking(id) on delete cascade,
      kind text not null,
      on_date text not null,
      start_minute integer not null,
      end_minute integer not null,
      space_code text,
      attendees text not null default '',
      note text not null default '',
      outcome text,
      created_at text not null
    )`,

    `create index appointment_by_booking on appointment (booking_id, on_date, start_minute)`,
  ],
};
