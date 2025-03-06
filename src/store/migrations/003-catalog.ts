import type { Migration } from '../migrate.js';

/**
 * The menu catalog. Items, what they contain, the packages built out of them,
 * and the price books that say what any of it costs on a given date.
 *
 * Prices are effective dated rather than mutable. A function booked in October
 * for June is quoted off the book in force on the contract date, and repricing
 * the item later must not silently reprice the contract.
 */
export const migration003: Migration = {
  id: 3,
  name: 'menu catalog and price books',
  statements: [
    `create table menu_item (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      kind text not null,
      course text not null,
      sold_by text not null,
      is_upcharge integer not null default 0,
      active integer not null default 1,
      description text not null default '',
      created_at text not null,
      primary key (property_code, code)
    )`,

    `create index menu_item_by_course on menu_item (property_code, course)`,

    `create table menu_item_allergen (
      property_code text not null,
      item_code text not null,
      allergen text not null,
      primary key (property_code, item_code, allergen),
      foreign key (property_code, item_code)
        references menu_item(property_code, code) on delete cascade
    )`,

    `create table menu_item_diet (
      property_code text not null,
      item_code text not null,
      diet text not null,
      primary key (property_code, item_code, diet),
      foreign key (property_code, item_code)
        references menu_item(property_code, code) on delete cascade
    )`,

    `create table menu_package (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      service_style text not null,
      min_covers integer not null default 0,
      active integer not null default 1,
      created_at text not null,
      primary key (property_code, code)
    )`,

    `create table package_course (
      property_code text not null,
      package_code text not null,
      course text not null,
      choices integer not null default 1,
      required integer not null default 1,
      position integer not null default 0,
      primary key (property_code, package_code, course),
      foreign key (property_code, package_code)
        references menu_package(property_code, code) on delete cascade
    )`,

    `create table package_course_item (
      property_code text not null,
      package_code text not null,
      course text not null,
      item_code text not null,
      primary key (property_code, package_code, course, item_code),
      foreign key (property_code, package_code, course)
        references package_course(property_code, package_code, course) on delete cascade,
      foreign key (property_code, item_code)
        references menu_item(property_code, code) on delete cascade
    )`,

    `create table price_book (
      property_code text not null references property(code) on delete cascade,
      code text not null,
      name text not null,
      currency text not null,
      created_at text not null,
      primary key (property_code, code)
    )`,

    `create table price_line (
      property_code text not null,
      book_code text not null,
      subject_kind text not null,
      subject_code text not null,
      effective_from text not null,
      price_minor integer not null,
      primary key (property_code, book_code, subject_kind, subject_code, effective_from),
      foreign key (property_code, book_code)
        references price_book(property_code, code) on delete cascade
    )`,

    `create index price_line_lookup
      on price_line (property_code, book_code, subject_kind, subject_code, effective_from)`,
  ],
};
