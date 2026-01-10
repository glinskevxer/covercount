import type { Migration } from '../migrate.js';

export const migration020: Migration = {
  id: 20,
  name: 'what the kitchen actually made and what came back',
  statements: [
    `create table production_actual (
      function_id text not null references function_slot(id) on delete cascade,
      recipe_code text not null,
      produced integer not null,
      returned integer not null default 0,
      note text not null default '',
      recorded_at text not null,
      primary key (function_id, recipe_code)
    )`,
  ],
};
