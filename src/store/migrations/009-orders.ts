import type { Migration } from '../migrate.js';

/**
 * The banquet event order and the change orders that move it.
 *
 * A revision is a snapshot, not a diff. What the kitchen worked from on the
 * Tuesday has to be readable in March even though the guarantee has moved
 * three times since, and reconstructing it from a chain of diffs is exactly
 * the sort of thing that goes wrong in the week somebody needs it.
 */
export const migration009: Migration = {
  id: 9,
  name: 'banquet event orders and change orders',
  statements: [
    `create table beo (
      id text primary key,
      function_id text not null references function_slot(id) on delete cascade,
      property_code text not null references property(code) on delete cascade,
      revision integer not null,
      status text not null,
      body text not null,
      drawn_at text not null,
      drawn_by text not null,
      signed_at text,
      signed_by text,
      note text not null default ''
    )`,

    `create unique index beo_revision on beo (function_id, revision)`,

    `create index beo_by_function on beo (function_id)`,

    `create table change_order (
      id text primary key,
      function_id text not null references function_slot(id) on delete cascade,
      property_code text not null references property(code) on delete cascade,
      raised_at text not null,
      raised_by text not null,
      after_cutoff integer not null default 0,
      reason text not null,
      status text not null,
      fee_minor integer not null default 0,
      applied_at text
    )`,

    `create index change_order_by_function on change_order (function_id)`,

    `create table change_order_line (
      change_order_id text not null references change_order(id) on delete cascade,
      position integer not null,
      field text not null,
      was text not null default '',
      becomes text not null default '',
      primary key (change_order_id, position)
    )`,
  ],
};
