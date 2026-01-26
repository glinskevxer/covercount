import type { Migration } from '../migrate.js';

export const migration023: Migration = {
  id: 23,
  name: 'how long it takes to turn a room between two setups',
  statements: [
    `create table turn_standard (
      property_code text not null references property(code) on delete cascade,
      from_style text not null,
      to_style text not null,
      minutes integer not null,
      heads integer not null,
      primary key (property_code, from_style, to_style)
    )`,
  ],
};
