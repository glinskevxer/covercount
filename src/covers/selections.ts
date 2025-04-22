/**
 * The split, and whether it adds up.
 *
 * Every required course of the package has to be chosen for every standard
 * cover. Standard covers are the guarantee less the special meals, because a
 * guest eating the vegan substitution is not also eating a main off the split.
 * A split that adds to more than the standard count means somebody has been
 * counted twice; one that adds to less means plates nobody has decided about.
 */

import { invalidInput, ruleViolation } from '../core/errors.js';
import { catalogCode, type CatalogCode, type EntityId } from '../core/ids.js';
import { isCourse, type Course } from '../catalog/types.js';
import { packageCourses } from '../catalog/packages.js';
import { requireFunction } from '../booking/functions.js';
import { inTransaction, type Database } from '../store/database.js';
import { requireCovers } from './guarantee.js';
import { coverBreakdown } from './special.js';

export interface CourseSelection {
  readonly course: Course;
  readonly itemCode: CatalogCode;
  readonly covers: number;
  readonly note: string;
}

interface SelectionRow {
  course: string;
  item_code: string;
  covers: number;
  note: string;
}

export function listSelections(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): CourseSelection[] {
  return db
    .prepare<[string], SelectionRow>(
      'select course, item_code, covers, note from function_selection where function_id = ? order by course, item_code',
    )
    .all(functionId)
    .map((row) => ({
      course: row.course as Course,
      itemCode: catalogCode(row.item_code),
      covers: row.covers,
      note: row.note,
    }));
}

export function selectionsForCourse(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  course: Course,
): CourseSelection[] {
  return listSelections(db, functionId).filter((row) => row.course === course);
}

export interface SetSplitEntry {
  readonly itemCode: string;
  readonly covers: number;
  readonly note?: string;
}

/**
 * Replace the split for one course. The whole course is written at once
 * because a partial edit leaves a split that does not add up, and there is no
 * useful state between one split and the next.
 */
export function setCourseSplit(
  db: Database,
  functionId: EntityId<'functionSlot'>,
  courseName: string,
  entries: readonly SetSplitEntry[],
): CourseSelection[] {
  const slot = requireFunction(db, functionId);
  const covers = requireCovers(db, functionId);
  const course = courseName.trim().toUpperCase();
  if (!isCourse(course)) {
    throw invalidInput('selection.course', `${courseName} is not a course`);
  }
  if (covers.packageCode === undefined) {
    throw ruleViolation(
      'selection.nopackage',
      `${functionId} has no package on it, so there is nothing to split`,
    );
  }

  const plan = packageCourses(db, slot.propertyCode, covers.packageCode).find(
    (row) => row.course === course,
  );
  if (plan === undefined) {
    throw invalidInput(
      'selection.course',
      `${covers.packageCode} carries no ${course} course to split`,
    );
  }

  const seen = new Set<string>();
  const normalised = entries.map((entry) => {
    const itemCode = catalogCode(entry.itemCode);
    if (seen.has(itemCode)) {
      throw invalidInput('selection.item', `${itemCode} appears twice in the ${course} split`);
    }
    seen.add(itemCode);
    if (!plan.items.includes(itemCode)) {
      throw invalidInput(
        'selection.item',
        `${itemCode} is not offered in the ${course} course of ${covers.packageCode}`,
      );
    }
    if (!Number.isInteger(entry.covers) || entry.covers < 0) {
      throw invalidInput('selection.covers', 'a split is a whole count of covers');
    }
    return { itemCode, covers: entry.covers, note: (entry.note ?? '').trim() };
  });

  return inTransaction(db, (handle) => {
    handle
      .prepare('delete from function_selection where function_id = ? and course = ?')
      .run(functionId, course);
    const insert = handle.prepare(
      'insert into function_selection (function_id, course, item_code, covers, note) values (?, ?, ?, ?, ?)',
    );
    for (const entry of normalised) {
      if (entry.covers === 0) {
        continue;
      }
      insert.run(functionId, course, entry.itemCode, entry.covers, entry.note);
    }
    return selectionsForCourse(handle, functionId, course);
  });
}

export interface SplitProblem {
  readonly course: Course;
  readonly expected: number;
  readonly chosen: number;
  readonly required: boolean;
}

/**
 * Every course whose split does not add up to the standard cover count. A
 * course the package does not require is only a problem when somebody has
 * started splitting it and stopped part way.
 */
export function splitProblems(db: Database, functionId: EntityId<'functionSlot'>): SplitProblem[] {
  const slot = requireFunction(db, functionId);
  const covers = requireCovers(db, functionId);
  if (covers.packageCode === undefined) {
    return [];
  }
  const standard = coverBreakdown(db, functionId).standard;
  const problems: SplitProblem[] = [];

  for (const plan of packageCourses(db, slot.propertyCode, covers.packageCode)) {
    const chosen = selectionsForCourse(db, functionId, plan.course).reduce(
      (total, row) => total + row.covers,
      0,
    );
    const expected = standard * plan.choices;
    if (!plan.required && chosen === 0) {
      continue;
    }
    if (chosen !== expected) {
      problems.push({ course: plan.course, expected, chosen, required: plan.required });
    }
  }

  return problems;
}

export function assertSplitsAddUp(db: Database, functionId: EntityId<'functionSlot'>): void {
  const problems = splitProblems(db, functionId);
  if (problems.length === 0) {
    return;
  }
  const first = problems[0];
  if (first === undefined) {
    return;
  }
  throw ruleViolation(
    'selection.total',
    `the ${first.course} split on ${functionId} adds to ${first.chosen} against ${first.expected} standard covers`,
    'special meals come out of the standard count before the split is taken',
  );
}

export function splitsAddUp(db: Database, functionId: EntityId<'functionSlot'>): boolean {
  return splitProblems(db, functionId).length === 0;
}

/**
 * Plates per menu item across every course, which is what the kitchen cooks.
 * Special meals are added in under whatever they were substituted with.
 */
export function plateCounts(
  db: Database,
  functionId: EntityId<'functionSlot'>,
): { itemCode: CatalogCode; course: Course; plates: number }[] {
  const tally = new Map<string, { itemCode: CatalogCode; course: Course; plates: number }>();
  for (const selection of listSelections(db, functionId)) {
    const key = `${selection.course}/${selection.itemCode}`;
    const existing = tally.get(key);
    if (existing === undefined) {
      tally.set(key, {
        itemCode: selection.itemCode,
        course: selection.course,
        plates: selection.covers,
      });
    } else {
      existing.plates += selection.covers;
    }
  }
  return [...tally.values()].sort(
    (left, right) =>
      left.course.localeCompare(right.course) || left.itemCode.localeCompare(right.itemCode),
  );
}

export function clearSelections(db: Database, functionId: EntityId<'functionSlot'>): number {
  return db.prepare('delete from function_selection where function_id = ?').run(functionId).changes;
}
