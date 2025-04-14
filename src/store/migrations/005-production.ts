import type { Migration } from '../migrate.js';

/**
 * Recipes and what they take.
 *
 * A recipe line carries the quantity for one batch and a yield factor. The
 * yield is the fraction of what is bought that survives to the plate: a case
 * of romaine loses the outer leaves and the root, so ordering the plate weight
 * leaves the kitchen short. The factor lives on the line rather than on the
 * ingredient because it depends on what is being done to it.
 */
export const migration005: Migration = {
  id: 5,
  name: 'recipes and requisitions',
  statements: [
    `create table ingredient (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      store text not null,
      purchase_unit text not null,
      pack_size_milli integer not null,
      pack_unit text not null,
      active integer not null default 1,
      created_at text not null,
      primary key (property_code, code)
    )`,

    `create index ingredient_by_store on ingredient (property_code, store)`,

    `create table recipe (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      item_code text,
      batch_portions integer not null,
      station text not null,
      method text not null default '',
      created_at text not null,
      primary key (property_code, code),
      foreign key (property_code, item_code)
        references menu_item(property_code, code) on delete set null
    )`,

    `create table recipe_line (
      property_code text not null,
      recipe_code text not null,
      position integer not null,
      ingredient_code text not null,
      quantity_milli integer not null,
      quantity_unit text not null,
      yield_percent integer not null default 100,
      note text not null default '',
      primary key (property_code, recipe_code, position),
      foreign key (property_code, recipe_code)
        references recipe(property_code, code) on delete cascade,
      foreign key (property_code, ingredient_code)
        references ingredient(property_code, code)
    )`,

    `create index recipe_line_by_ingredient
      on recipe_line (property_code, ingredient_code)`,

    `create table requisition (
      id text primary key,
      property_code text not null references property(code) on delete cascade,
      service_date text not null,
      store text not null,
      status text not null,
      created_at text not null,
      note text not null default ''
    )`,

    `create index requisition_by_date on requisition (property_code, service_date)`,

    `create table requisition_line (
      requisition_id text not null references requisition(id) on delete cascade,
      ingredient_code text not null,
      needed_milli integer not null,
      needed_unit text not null,
      packs integer not null,
      position integer not null,
      primary key (requisition_id, ingredient_code)
    )`,
  ],
};
