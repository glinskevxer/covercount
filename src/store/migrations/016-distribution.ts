import type { Migration } from '../migrate.js';

export const migration016: Migration = {
  id: 16,
  name: 'service charge distribution to the roles that worked',
  statements: [
    `create table distribution_point (
      property_code text not null references property(code) on delete cascade,
      role text not null,
      points integer not null,
      primary key (property_code, role)
    )`,

    `create table distribution_line (
      invoice_id text not null references invoice(id) on delete cascade,
      role text not null,
      head_hours_thousandths integer not null,
      points integer not null,
      weight integer not null,
      share_minor integer not null,
      primary key (invoice_id, role)
    )`,

    `create table distribution_run (
      invoice_id text primary key references invoice(id) on delete cascade,
      pool_minor integer not null,
      run_at text not null
    )`,
  ],
};
