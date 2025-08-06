import type { Migration } from '../migrate.js';

/**
 * The run of show.
 *
 * A template step hangs off an anchor with an offset, and it may also carry a
 * per cover allowance. Plating three courses for a hundred and eighty is not
 * the same job as plating them for forty, so the step that starts the plate up
 * has to move earlier as the guarantee rises. Holding that as seconds per
 * cover on the template is what makes the timeline follow the count instead of
 * being retyped every time it moves.
 */
export const migration010: Migration = {
  id: 10,
  name: 'run of show templates and timelines',
  statements: [
    `create table timeline_template (
      property_code text not null references property(code) on delete cascade,
      service_style text not null,
      sequence integer not null,
      label text not null,
      anchor text not null,
      offset_minutes integer not null default 0,
      per_cover_seconds integer not null default 0,
      owner text not null default '',
      primary key (property_code, service_style, sequence)
    )`,

    `create table function_timeline (
      function_id text not null references function_slot(id) on delete cascade,
      sequence integer not null,
      label text not null,
      minute integer not null,
      owner text not null default '',
      note text not null default '',
      pinned integer not null default 0,
      primary key (function_id, sequence)
    )`,
  ],
};
