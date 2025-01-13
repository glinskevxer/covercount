import type { Migration } from '../migrate.js';

/**
 * The accounts that book, the bookings themselves, and the individual
 * functions inside them. A function's end minute is allowed past 1440 because
 * a wedding that starts at seven ends the following morning and splitting it
 * across two dates would break every diary query in the build.
 */
export const migration002: Migration = {
  id: 2,
  name: 'bookings and functions',
  statements: [
    `create table account (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      kind text not null,
      billing_email text not null default '',
      credit_status text not null default 'APPROVED',
      tax_exempt_id text not null default '',
      created_at text not null,
      primary key (property_code, code)
    )`,

    `create table booking (
      id text primary key,
      property_code text not null references property(code) on delete cascade,
      account_code text,
      post_as text not null,
      sales_manager text not null default '',
      status text not null,
      arrival_date text not null,
      departure_date text not null,
      created_at text not null,
      updated_at text not null,
      closed_at text,
      cancel_reason text,
      foreign key (property_code, account_code) references account(property_code, code)
    )`,

    `create index booking_by_property on booking (property_code, arrival_date)`,

    `create index booking_by_account on booking (property_code, account_code)`,

    `create table function_slot (
      id text primary key,
      booking_id text not null references booking(id) on delete cascade,
      property_code text not null,
      space_code text not null,
      name text not null,
      service_date text not null,
      start_minute integer not null,
      end_minute integer not null,
      setup_style text not null,
      service_style text not null,
      expected_covers integer not null,
      status text not null,
      created_at text not null,
      updated_at text not null,
      foreign key (property_code, space_code)
        references function_space(property_code, code)
    )`,

    `create index function_slot_diary
      on function_slot (property_code, service_date, space_code)`,

    `create index function_slot_by_booking on function_slot (booking_id)`,

    `create table booking_event (
      seq integer primary key autoincrement,
      booking_id text not null references booking(id) on delete cascade,
      occurred_at text not null,
      actor text not null,
      kind text not null,
      detail text not null default ''
    )`,

    `create index booking_event_by_booking on booking_event (booking_id, seq)`,
  ],
};
