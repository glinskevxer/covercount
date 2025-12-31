import type { Migration } from '../migrate.js';

export const migration018: Migration = {
  id: 18,
  name: 'what is on the shelf and what should be',
  statements: [
    `create table stock_level (
      property_code text not null,
      ingredient_code text not null,
      on_hand_milli integer not null default 0,
      par_milli integer not null default 0,
      unit text not null,
      counted_at text not null,
      primary key (property_code, ingredient_code),
      foreign key (property_code, ingredient_code)
        references ingredient (property_code, code) on delete cascade
    )`,

    `create table stock_movement (
      id integer primary key autoincrement,
      property_code text not null,
      ingredient_code text not null,
      moved_milli integer not null,
      unit text not null,
      reason text not null,
      reference text not null default '',
      moved_at text not null
    )`,

    `create index stock_movement_by_item
      on stock_movement (property_code, ingredient_code, id)`,
  ],
};
