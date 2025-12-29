import type { Migration } from '../migrate.js';

export const migration017: Migration = {
  id: 17,
  name: 'cancellation damages on a sliding scale',
  statements: [
    `create table cancellation_band (
      property_code text not null references property(code) on delete cascade,
      days_before integer not null,
      rate_ppm integer not null,
      note text not null default '',
      primary key (property_code, days_before)
    )`,
  ],
};
