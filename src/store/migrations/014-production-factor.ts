import type { Migration } from '../migrate.js';

/**
 * How much more than the plate count a service style has to be produced at.
 *
 * A plated dinner produces one plate a cover. A buffet does not: the last
 * guest through has to see a display that is still worth eating, so the
 * kitchen makes more than the covers and takes the difference as waste. A
 * station is worse again, because the guest serves themselves and takes more
 * than a plated portion.
 *
 * The multiplier is the property's number rather than a constant, because it
 * is the thing the chef and the controller argue about, and it is per service
 * style because that is what it depends on.
 */
export const migration014: Migration = {
  id: 14,
  name: 'production factors by service style',
  statements: [
    `create table production_factor (
      property_code text not null references property(code) on delete cascade,
      service_style text not null,
      factor_ppm integer not null,
      note text not null default '',
      primary key (property_code, service_style)
    )`,
  ],
};
