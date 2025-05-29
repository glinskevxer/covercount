import type { Migration } from '../migrate.js';

/**
 * Charges, tax and the invoice.
 *
 * The order the money is assembled in is a contract term and it is held as
 * data. A service charge that is itself taxable is ordinary in most of the
 * United States and unlawful in parts of it, so the profile carries a flag
 * rather than the code carrying an assumption.
 */
export const migration008: Migration = {
  id: 8,
  name: 'charges, tax profiles and invoices',
  statements: [
    `create table tax_profile (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      service_charge_ppm integer not null default 0,
      gratuity_ppm integer not null default 0,
      service_charge_taxable integer not null default 1,
      created_at text not null,
      primary key (property_code, code)
    )`,

    `create table tax_rate (
      property_code text not null,
      profile_code text not null,
      category text not null,
      rate_ppm integer not null,
      primary key (property_code, profile_code, category),
      foreign key (property_code, profile_code)
        references tax_profile(property_code, code) on delete cascade
    )`,

    `create table charge_line (
      id integer primary key autoincrement,
      function_id text not null references function_slot(id) on delete cascade,
      category text not null,
      description text not null,
      quantity integer not null,
      unit_minor integer not null,
      item_code text,
      taxable integer not null default 1,
      serviceable integer not null default 1,
      source text not null default 'MANUAL',
      position integer not null default 0
    )`,

    `create index charge_line_by_function on charge_line (function_id, position)`,

    `create table invoice (
      id text primary key,
      property_code text not null references property(code) on delete cascade,
      booking_id text not null references booking(id) on delete cascade,
      tax_profile_code text not null,
      status text not null,
      issued_at text,
      created_at text not null,
      note text not null default ''
    )`,

    `create index invoice_by_booking on invoice (booking_id)`,

    `create table invoice_function (
      invoice_id text not null references invoice(id) on delete cascade,
      function_id text not null references function_slot(id) on delete cascade,
      primary key (invoice_id, function_id)
    )`,

    `create table invoice_payment (
      seq integer primary key autoincrement,
      invoice_id text not null references invoice(id) on delete cascade,
      received_at text not null,
      kind text not null,
      amount_minor integer not null,
      reference text not null default ''
    )`,
  ],
};
