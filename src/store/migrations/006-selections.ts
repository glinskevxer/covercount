import type { Migration } from '../migrate.js';

/**
 * The split.
 *
 * A plated dinner sold with three mains does not send a third of each. The
 * client comes back with a split, ninety beef and sixty fish and thirty
 * vegetarian, and that split is what the kitchen cooks and what the pass
 * calls. It is held per course so a package offering a choice in two courses
 * carries two splits, and each of them has to add up on its own.
 */
export const migration006: Migration = {
  id: 6,
  name: 'course selections',
  statements: [
    `create table function_selection (
      function_id text not null references function_slot(id) on delete cascade,
      course text not null,
      item_code text not null,
      covers integer not null,
      note text not null default '',
      primary key (function_id, course, item_code)
    )`,

    `create index function_selection_by_course on function_selection (function_id, course)`,

    `create table function_extra (
      function_id text not null references function_slot(id) on delete cascade,
      item_code text not null,
      quantity_milli integer not null,
      quantity_unit text not null,
      note text not null default '',
      primary key (function_id, item_code)
    )`,
  ],
};
