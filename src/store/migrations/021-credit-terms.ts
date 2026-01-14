import type { Migration } from '../migrate.js';

export const migration021: Migration = {
  id: 21,
  name: 'how long an account has to pay',
  statements: [
    `create table credit_terms (
      property_code text not null,
      account_code text not null,
      net_days integer not null,
      credit_limit_minor integer not null default 0,
      primary key (property_code, account_code),
      foreign key (property_code, account_code)
        references account (property_code, code) on delete cascade
    )`,
  ],
};
