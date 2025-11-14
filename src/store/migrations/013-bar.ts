import type { Migration } from '../migrate.js';

/**
 * The bar.
 *
 * A hosted bar is sold one of two ways and they have nothing in common. A
 * package bar is a price per person per hour against the guarantee, so it
 * follows the cover count. A consumption bar is priced on what was actually
 * poured, which means an opening and a closing count per bottle and no
 * relationship to the covers at all.
 *
 * Holding both as one thing is the mistake that makes a bar module unusable,
 * so the tier and the pour are separate tables and the charge is worked out
 * differently for each.
 */
export const migration013: Migration = {
  id: 13,
  name: 'bar packages and consumption',
  statements: [
    `create table bar_tier (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      first_hour_minor integer not null,
      extra_hour_minor integer not null,
      created_at text not null,
      primary key (property_code, code)
    )`,

    `create table function_bar (
      function_id text primary key references function_slot(id) on delete cascade,
      kind text not null,
      tier_code text,
      hours integer not null default 0,
      opened_at text,
      closed_at text,
      note text not null default ''
    )`,

    `create table bar_pour (
      function_id text not null references function_slot(id) on delete cascade,
      item_code text not null,
      opening_tenths integer not null default 0,
      closing_tenths integer not null default 0,
      unit_minor integer not null default 0,
      primary key (function_id, item_code)
    )`,
  ],
};
