import type { Migration } from '../migrate.js';

/**
 * The guarantee, the special meals that come out of it, and the count that was
 * actually served.
 *
 * Every movement of the guarantee is a row rather than a column, because the
 * question the controller asks is not what the guarantee is, it is what it was
 * when the deadline passed and who moved it afterwards.
 */
export const migration004: Migration = {
  id: 4,
  name: 'covers and guarantees',
  statements: [
    `create table function_cover (
      function_id text primary key references function_slot(id) on delete cascade,
      package_code text,
      price_book_code text,
      contract_date text not null,
      guarantee_due_date text not null,
      guarantee_due_minute integer not null,
      guaranteed_covers integer,
      guaranteed_at text,
      served_covers integer,
      served_at text,
      set_covers integer
    )`,

    `create table cover_movement (
      seq integer primary key autoincrement,
      function_id text not null references function_slot(id) on delete cascade,
      occurred_at text not null,
      actor text not null,
      from_covers integer,
      to_covers integer not null,
      after_cutoff integer not null default 0,
      note text not null default ''
    )`,

    `create index cover_movement_by_function on cover_movement (function_id, seq)`,

    `create table special_meal (
      id integer primary key autoincrement,
      function_id text not null references function_slot(id) on delete cascade,
      guest_name text not null default '',
      covers integer not null,
      diet text not null default '',
      allergens text not null default '',
      substitute_item_code text,
      note text not null default '',
      created_at text not null
    )`,

    `create index special_meal_by_function on special_meal (function_id)`,
  ],
};
