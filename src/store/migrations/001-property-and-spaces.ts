import type { Migration } from '../migrate.js';

/**
 * The property, the rooms in it, and the two calendars every deadline is
 * measured against. Capacity is per setup style rather than a single number
 * because a room that seats two hundred on rounds of ten holds four hundred
 * standing, and the fire capacity is a third number again.
 */
export const migration001: Migration = {
  id: 1,
  name: 'property and spaces',
  statements: [
    `create table property (
      code text primary key,
      name text not null,
      time_zone text not null,
      currency text not null,
      guarantee_lead_days integer not null,
      guarantee_due_minute integer not null,
      overset_ppm integer not null,
      overset_cap integer not null,
      created_at text not null
    )`,

    `create table function_space (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      floor text not null default '',
      area_sq_ft integer not null,
      fire_capacity integer not null,
      setup_minutes integer not null,
      teardown_minutes integer not null,
      is_combination integer not null default 0,
      active integer not null default 1,
      primary key (property_code, code)
    )`,

    `create table space_component (
      property_code text not null,
      combination_code text not null,
      component_code text not null,
      primary key (property_code, combination_code, component_code),
      foreign key (property_code, combination_code)
        references function_space(property_code, code) on delete cascade,
      foreign key (property_code, component_code)
        references function_space(property_code, code) on delete cascade
    )`,

    `create index space_component_by_part
      on space_component (property_code, component_code)`,

    `create table space_capacity (
      property_code text not null,
      space_code text not null,
      setup_style text not null,
      capacity integer not null,
      primary key (property_code, space_code, setup_style),
      foreign key (property_code, space_code)
        references function_space(property_code, code) on delete cascade
    )`,

    `create table house_calendar (
      property_code text not null references property(code) on delete cascade,
      calendar text not null,
      service_date text not null,
      kind text not null,
      note text not null default '',
      primary key (property_code, calendar, service_date)
    )`,

    `create table id_sequence (
      property_code text not null references property(code) on delete cascade,
      kind text not null,
      year integer not null,
      next_value integer not null,
      primary key (property_code, kind, year)
    )`,
  ],
};
