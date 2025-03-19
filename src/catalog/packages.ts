/**
 * Menu packages.
 *
 * A package is a price per head and a shape: which courses it carries, how
 * many things a guest picks in each, and which of the catalog's items are on
 * offer there. The shape is what the selection rules later grade against, so
 * it is validated hard on the way in. A course that offers two items but lets
 * a guest choose three is not a package anybody can serve.
 */

import { conflict, invalidInput, notFound } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { isServiceStyle, type ServiceStyle } from '../property/types.js';
import { requireProperty } from '../property/store.js';
import { inTransaction, type Database } from '../store/database.js';
import { requireItem } from './items.js';
import {
  compareCourses,
  courseOrder,
  isCourse,
  type Course,
  type MenuPackage,
  type PackageCourse,
} from './types.js';

interface PackageRow {
  property_code: string;
  code: string;
  name: string;
  service_style: string;
  min_covers: number;
  active: number;
  created_at: string;
}

function toPackage(row: PackageRow): MenuPackage {
  return {
    propertyCode: catalogCode(row.property_code),
    code: catalogCode(row.code),
    name: row.name,
    serviceStyle: row.service_style as ServiceStyle,
    minCovers: row.min_covers,
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

export interface CoursePlanInput {
  readonly course: string;
  readonly choices?: number;
  readonly required?: boolean;
  readonly items: readonly string[];
}

export interface CreatePackageInput {
  readonly code: string;
  readonly name: string;
  readonly serviceStyle: string;
  readonly minCovers?: number;
  readonly courses: readonly CoursePlanInput[];
}

export function createPackage(
  db: Database,
  propertyCode: CatalogCode,
  input: CreatePackageInput,
  now: string,
): MenuPackage {
  requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  const name = input.name.trim();
  if (name.length === 0) {
    throw invalidInput('package.name', 'a package needs a name');
  }
  const serviceStyle = input.serviceStyle.trim().toUpperCase();
  if (!isServiceStyle(serviceStyle)) {
    throw invalidInput('package.style', `${input.serviceStyle} is not a service style`);
  }
  const minCovers = input.minCovers ?? 0;
  if (!Number.isInteger(minCovers) || minCovers < 0) {
    throw invalidInput('package.minimum', 'a package minimum is a whole count of covers');
  }
  if (input.courses.length === 0) {
    throw invalidInput(
      'package.courses',
      `${code} carries no courses, so there is nothing to sell`,
    );
  }

  const plans = input.courses.map((plan) => normaliseCoursePlan(db, propertyCode, code, plan));
  const seen = new Set<Course>();
  for (const plan of plans) {
    if (seen.has(plan.course)) {
      throw invalidInput('package.courses', `${code} lists the ${plan.course} course twice`);
    }
    seen.add(plan.course);
  }
  plans.sort((left, right) => compareCourses(left.course, right.course));

  return inTransaction(db, (handle) => {
    const clash = handle
      .prepare<
        [string, string],
        { code: string }
      >('select code from menu_package where property_code = ? and code = ?')
      .get(propertyCode, code);
    if (clash !== undefined) {
      throw conflict('package.exists', `${propertyCode} already has a package ${code}`, code);
    }

    handle
      .prepare(
        `insert into menu_package (property_code, code, name, service_style, min_covers, created_at)
         values (?, ?, ?, ?, ?, ?)`,
      )
      .run(propertyCode, code, name, serviceStyle, minCovers, now);

    const insertCourse = handle.prepare(
      `insert into package_course (property_code, package_code, course, choices, required, position)
       values (?, ?, ?, ?, ?, ?)`,
    );
    const insertItem = handle.prepare(
      `insert into package_course_item (property_code, package_code, course, item_code)
       values (?, ?, ?, ?)`,
    );

    for (const plan of plans) {
      insertCourse.run(
        propertyCode,
        code,
        plan.course,
        plan.choices,
        plan.required ? 1 : 0,
        courseOrder(plan.course),
      );
      for (const item of plan.items) {
        insertItem.run(propertyCode, code, plan.course, item);
      }
    }

    return requirePackage(handle, propertyCode, code);
  });
}

function normaliseCoursePlan(
  db: Database,
  propertyCode: CatalogCode,
  packageCode: CatalogCode,
  plan: CoursePlanInput,
): { course: Course; choices: number; required: boolean; items: CatalogCode[] } {
  const course = plan.course.trim().toUpperCase();
  if (!isCourse(course)) {
    throw invalidInput('package.course', `${plan.course} is not a course`);
  }
  if (course === 'NONE') {
    throw invalidInput('package.course', `${packageCode} cannot carry a course called NONE`);
  }
  const choices = plan.choices ?? 1;
  if (!Number.isInteger(choices) || choices < 1) {
    throw invalidInput(
      'package.choices',
      `the ${course} course of ${packageCode} lets a guest pick ${choices}, which is not a whole number of one or more`,
    );
  }

  const items: CatalogCode[] = [];
  for (const raw of plan.items) {
    const itemCode = catalogCode(raw);
    if (items.includes(itemCode)) {
      throw invalidInput(
        'package.items',
        `${packageCode} offers ${itemCode} twice in the ${course} course`,
      );
    }
    const item = requireItem(db, propertyCode, itemCode);
    if (item.course !== course) {
      throw invalidInput(
        'package.items',
        `${itemCode} is a ${item.course} item and cannot be offered in the ${course} course`,
      );
    }
    items.push(itemCode);
  }

  if (items.length === 0) {
    throw invalidInput(
      'package.items',
      `the ${course} course of ${packageCode} offers nothing to choose from`,
    );
  }
  if (choices > items.length) {
    throw invalidInput(
      'package.choices',
      `the ${course} course of ${packageCode} lets a guest pick ${choices} from ${items.length}`,
    );
  }

  return { course, choices, required: plan.required !== false, items };
}

export function findPackage(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): MenuPackage | undefined {
  const row = db
    .prepare<
      [string, string],
      PackageRow
    >('select * from menu_package where property_code = ? and code = ?')
    .get(propertyCode, code);
  return row === undefined ? undefined : toPackage(row);
}

export function requirePackage(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
): MenuPackage {
  const found = findPackage(db, propertyCode, code);
  if (found === undefined) {
    throw notFound('package.missing', code, `${propertyCode} has no package ${code}`);
  }
  return found;
}

export function listPackages(
  db: Database,
  propertyCode: CatalogCode,
  options: { activeOnly?: boolean } = {},
): MenuPackage[] {
  const clause = options.activeOnly === true ? ' and active = 1' : '';
  return db
    .prepare<
      [string],
      PackageRow
    >(`select * from menu_package where property_code = ?${clause} order by code`)
    .all(propertyCode)
    .map(toPackage);
}

export function packageCourses(
  db: Database,
  propertyCode: CatalogCode,
  packageCode: CatalogCode,
): PackageCourse[] {
  const courses = db
    .prepare<
      [string, string],
      { course: string; choices: number; required: number; position: number }
    >(
      `select course, choices, required, position from package_course
       where property_code = ? and package_code = ? order by position, course`,
    )
    .all(propertyCode, packageCode);

  const items = db
    .prepare<[string, string], { course: string; item_code: string }>(
      `select course, item_code from package_course_item
       where property_code = ? and package_code = ? order by course, item_code`,
    )
    .all(propertyCode, packageCode);

  return courses.map((row) => ({
    course: row.course as Course,
    choices: row.choices,
    required: row.required === 1,
    position: row.position,
    items: items
      .filter((item) => item.course === row.course)
      .map((item) => catalogCode(item.item_code)),
  }));
}

export function setPackageActive(
  db: Database,
  propertyCode: CatalogCode,
  code: CatalogCode,
  active: boolean,
): MenuPackage {
  requirePackage(db, propertyCode, code);
  db.prepare('update menu_package set active = ? where property_code = ? and code = ?').run(
    active ? 1 : 0,
    propertyCode,
    code,
  );
  return requirePackage(db, propertyCode, code);
}

/** Every item any course of the package offers, deduplicated. */
export function packageItems(
  db: Database,
  propertyCode: CatalogCode,
  packageCode: CatalogCode,
): CatalogCode[] {
  const out: CatalogCode[] = [];
  for (const course of packageCourses(db, propertyCode, packageCode)) {
    for (const item of course.items) {
      if (!out.includes(item)) {
        out.push(item);
      }
    }
  }
  return out.sort();
}

/**
 * The most items one guest can end up with. It is the sum of the choices in
 * every course, and the production sheet needs it to size a plate count before
 * anybody has chosen anything.
 */
export function maxSelectionsPerCover(
  db: Database,
  propertyCode: CatalogCode,
  packageCode: CatalogCode,
): number {
  return packageCourses(db, propertyCode, packageCode).reduce(
    (total, course) => total + course.choices,
    0,
  );
}

/** Courses a guest has to choose in. */
export function requiredCourses(
  db: Database,
  propertyCode: CatalogCode,
  packageCode: CatalogCode,
): Course[] {
  return packageCourses(db, propertyCode, packageCode)
    .filter((course) => course.required)
    .map((course) => course.course);
}
