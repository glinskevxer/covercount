import type { Migration } from '../migrate.js';

/**
 * Equipment, and what a setup actually needs.
 *
 * A room set on rounds of ten needs a table every ten covers, ten chairs on
 * each, a cloth per table and a place setting per cover. Holding that as a
 * rule per setup style rather than as a number somebody types is what lets the
 * pull sheet follow the guarantee, and it is what catches the function that
 * needs more chairs than the property owns.
 */
export const migration011: Migration = {
  id: 11,
  name: 'equipment and setup rules',
  statements: [
    `create table equipment (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      kind text not null,
      owned integer not null default 0,
      rental_minor integer not null default 0,
      created_at text not null,
      primary key (property_code, code)
    )`,

    `create table setup_requirement (
      property_code text not null,
      setup_style text not null,
      equipment_code text not null,
      per_cover integer not null default 0,
      per_table integer not null default 0,
      fixed integer not null default 0,
      primary key (property_code, setup_style, equipment_code),
      foreign key (property_code, equipment_code)
        references equipment(property_code, code) on delete cascade
    )`,

    `create table function_equipment (
      function_id text not null references function_slot(id) on delete cascade,
      equipment_code text not null,
      quantity integer not null,
      source text not null default 'RULE',
      note text not null default '',
      primary key (function_id, equipment_code)
    )`,
  ],
};
