import type { Migration } from '../migrate.js';

export const migration015: Migration = {
  id: 15,
  name: 'food and beverage minimums on a function',
  statements: [
    `create table revenue_minimum (
      function_id text primary key references function_slot(id) on delete cascade,
      minimum_minor integer not null,
      counts_beverage integer not null default 1,
      note text not null default '',
      set_at text not null
    )`,
  ],
};
