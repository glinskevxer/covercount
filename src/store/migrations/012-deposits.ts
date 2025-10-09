import type { Migration } from '../migrate.js';

/**
 * Deposits and what a cancellation costs.
 *
 * Both are ladders counted back from the arrival date, and both are contract
 * terms rather than house policy, so they hang off the booking rather than off
 * the property. A booking taken at a conference rate has a different ladder
 * from a wedding, and the wedding's is the one that ends at a hundred percent.
 */
export const migration012: Migration = {
  id: 12,
  name: 'deposit and cancellation schedules',
  statements: [
    `create table deposit_schedule (
      booking_id text not null references booking(id) on delete cascade,
      sequence integer not null,
      label text not null,
      days_before integer not null,
      percent_ppm integer not null default 0,
      fixed_minor integer not null default 0,
      primary key (booking_id, sequence)
    )`,

    `create table cancellation_step (
      booking_id text not null references booking(id) on delete cascade,
      days_before integer not null,
      percent_ppm integer not null,
      primary key (booking_id, days_before)
    )`,
  ],
};
