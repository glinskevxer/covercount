/**
 * The catalog vocabulary.
 *
 * Courses are an ordered list rather than a set, because the run of show, the
 * production sheet and the printed menu all read in course order and none of
 * them should be sorting alphabetically. Allergens and diets are held apart on
 * purpose: an allergen is a thing the dish contains, a diet is a rule a guest
 * follows, and the mapping between them is not one to one.
 */

import type { CalendarDate } from '../core/calendar.js';
import type { CatalogCode } from '../core/ids.js';
import type { CurrencyCode, Money } from '../core/money.js';
import type { ServiceStyle } from '../property/types.js';

export const COURSES = [
  'CANAPE',
  'STARTER',
  'SOUP',
  'SALAD',
  'INTERMEZZO',
  'MAIN',
  'CHEESE',
  'DESSERT',
  'BEVERAGE',
  'STATION',
  'NONE',
] as const;

export type Course = (typeof COURSES)[number];

export const ITEM_KINDS = ['FOOD', 'BEVERAGE', 'RENTAL', 'AV', 'LABOR', 'FEE'] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];

export const SOLD_BY = ['PERSON', 'PIECE', 'DOZEN', 'GALLON', 'EACH', 'HOUR'] as const;

export type SoldBy = (typeof SOLD_BY)[number];

export const ALLERGENS = [
  'MILK',
  'EGG',
  'FISH',
  'SHELLFISH',
  'TREENUT',
  'PEANUT',
  'WHEAT',
  'SOY',
  'SESAME',
  'SULPHITE',
  'ALCOHOL',
  'PORK',
  'BEEF',
  'GELATIN',
] as const;

export type Allergen = (typeof ALLERGENS)[number];

export const DIETS = [
  'VEGETARIAN',
  'VEGAN',
  'PESCATARIAN',
  'GLUTEN-FREE',
  'DAIRY-FREE',
  'NUT-FREE',
  'HALAL',
  'KOSHER',
  'LOW-SODIUM',
] as const;

export type Diet = (typeof DIETS)[number];

const PRICE_SUBJECTS = ['ITEM', 'PACKAGE'] as const;

export type PriceSubject = (typeof PRICE_SUBJECTS)[number];

export interface MenuItem {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly kind: ItemKind;
  readonly course: Course;
  readonly soldBy: SoldBy;
  readonly isUpcharge: boolean;
  readonly active: boolean;
  readonly description: string;
  readonly createdAt: string;
}

export interface MenuPackage {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly serviceStyle: ServiceStyle;
  readonly minCovers: number;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface PackageCourse {
  readonly course: Course;
  /** How many of the offered items a guest picks. */
  readonly choices: number;
  /** Whether the course has to be chosen at all. */
  readonly required: boolean;
  readonly position: number;
  readonly items: CatalogCode[];
}

export interface PriceBook {
  readonly propertyCode: CatalogCode;
  readonly code: CatalogCode;
  readonly name: string;
  readonly currency: CurrencyCode;
  readonly createdAt: string;
}

export interface PriceLine {
  readonly bookCode: CatalogCode;
  readonly subjectKind: PriceSubject;
  readonly subjectCode: CatalogCode;
  readonly effectiveFrom: CalendarDate;
  readonly price: Money;
}

export function isCourse(value: string): value is Course {
  return (COURSES as readonly string[]).includes(value);
}

export function isItemKind(value: string): value is ItemKind {
  return (ITEM_KINDS as readonly string[]).includes(value);
}

export function isSoldBy(value: string): value is SoldBy {
  return (SOLD_BY as readonly string[]).includes(value);
}

export function isAllergen(value: string): value is Allergen {
  return (ALLERGENS as readonly string[]).includes(value);
}

export function isDiet(value: string): value is Diet {
  return (DIETS as readonly string[]).includes(value);
}

export function isPriceSubject(value: string): value is PriceSubject {
  return (PRICE_SUBJECTS as readonly string[]).includes(value);
}

/** Where a course sits in the order a menu prints. */
export function courseOrder(course: Course): number {
  return COURSES.indexOf(course);
}

export function compareCourses(left: Course, right: Course): number {
  return courseOrder(left) - courseOrder(right);
}

/** A course that arrives on a plate in front of a seated guest. */
export function isPlatedCourse(course: Course): boolean {
  return (
    course === 'STARTER' ||
    course === 'SOUP' ||
    course === 'SALAD' ||
    course === 'INTERMEZZO' ||
    course === 'MAIN' ||
    course === 'CHEESE' ||
    course === 'DESSERT'
  );
}

/** Items priced per head scale with covers; everything else is a flat count. */
export function scalesWithCovers(soldBy: SoldBy): boolean {
  return soldBy === 'PERSON';
}
