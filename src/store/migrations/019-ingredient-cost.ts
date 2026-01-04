import type { Migration } from '../migrate.js';

export const migration019: Migration = {
  id: 19,
  name: 'what a pack costs, by the date it was quoted',
  statements: [
    `create table ingredient_cost (
      property_code text not null,
      ingredient_code text not null,
      effective_from text not null,
      pack_minor integer not null,
      supplier text not null default '',
      primary key (property_code, ingredient_code, effective_from)
    )`,

    `create index ingredient_cost_by_date
      on ingredient_cost (property_code, ingredient_code, effective_from)`,
  ],
};
