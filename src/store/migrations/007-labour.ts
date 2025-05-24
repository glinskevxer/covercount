import type { Migration } from '../migrate.js';

/**
 * Staffing.
 *
 * A ratio is one server per so many covers, and it depends on the service
 * style: plated needs a server on every two tables, a buffet needs a fraction
 * of that, and a reception needs bartenders rather than servers. The ratios
 * are per property because they are what the union agreement or the standards
 * manual says, not something this build gets to decide.
 */
export const migration007: Migration = {
  id: 7,
  name: 'staffing ratios and shifts',
  statements: [
    `create table staffing_rule (
      property_code text not null references property(code) on delete cascade,
      service_style text not null,
      role text not null,
      covers_per_head integer not null,
      minimum_heads integer not null default 0,
      minimum_hours integer not null default 4,
      lead_in_minutes integer not null default 60,
      lead_out_minutes integer not null default 30,
      primary key (property_code, service_style, role)
    )`,

    `create table labour_rate (
      property_code text not null references property(code) on delete cascade,
      role text not null,
      effective_from text not null,
      hourly_minor integer not null,
      primary key (property_code, role, effective_from)
    )`,

    `create table shift (
      id text primary key,
      function_id text not null references function_slot(id) on delete cascade,
      role text not null,
      heads integer not null,
      start_minute integer not null,
      end_minute integer not null,
      hourly_minor integer not null,
      created_at text not null,
      note text not null default ''
    )`,

    `create index shift_by_function on shift (function_id)`,
  ],
};
