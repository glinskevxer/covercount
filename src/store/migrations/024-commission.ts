import type { Migration } from '../migrate.js';

export const migration024: Migration = {
  id: 24,
  name: 'what a third party planner is owed',
  statements: [
    `create table commission_agreement (
      property_code text not null,
      account_code text not null,
      planner text not null,
      rate_ppm integer not null,
      base text not null,
      note text not null default '',
      primary key (property_code, account_code),
      foreign key (property_code, account_code)
        references account (property_code, code) on delete cascade
    )`,
  ],
};
