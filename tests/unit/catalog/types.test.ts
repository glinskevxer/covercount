import { describe, expect, it } from 'vitest';
import {
  ALLERGENS,
  COURSES,
  DIETS,
  ITEM_KINDS,
  SOLD_BY,
  compareCourses,
  courseOrder,
  isAllergen,
  isCourse,
  isDiet,
  isItemKind,
  isPlatedCourse,
  isPriceSubject,
  isSoldBy,
  scalesWithCovers,
} from '../../../src/catalog/types.js';

describe('the catalog vocabularies', () => {
  it('recognises a course, a kind and a unit of sale', () => {
    for (const course of COURSES) {
      expect(isCourse(course)).toBe(true);
    }
    expect(isCourse('AMUSE')).toBe(false);
    for (const kind of ITEM_KINDS) {
      expect(isItemKind(kind)).toBe(true);
    }
    expect(isItemKind('MERCHANDISE')).toBe(false);
    for (const unit of SOLD_BY) {
      expect(isSoldBy(unit)).toBe(true);
    }
    expect(isSoldBy('TRAY')).toBe(false);
  });

  it('keeps allergens and diets apart', () => {
    expect(isAllergen('SHELLFISH')).toBe(true);
    expect(isAllergen('VEGAN')).toBe(false);
    expect(isDiet('VEGAN')).toBe(true);
    expect(isDiet('SHELLFISH')).toBe(false);
    expect(ALLERGENS).toContain('SESAME');
    expect(DIETS).toContain('KOSHER');
  });

  it('recognises the two things a price can attach to', () => {
    expect(isPriceSubject('ITEM')).toBe(true);
    expect(isPriceSubject('PACKAGE')).toBe(true);
    expect(isPriceSubject('FUNCTION')).toBe(false);
  });
});

describe('course order', () => {
  it('runs in the order a menu prints', () => {
    expect(courseOrder('CANAPE')).toBeLessThan(courseOrder('STARTER'));
    expect(courseOrder('STARTER')).toBeLessThan(courseOrder('MAIN'));
    expect(courseOrder('MAIN')).toBeLessThan(courseOrder('DESSERT'));
  });

  it('sorts a shuffled menu back into order', () => {
    const shuffled: (typeof COURSES)[number][] = ['DESSERT', 'MAIN', 'CANAPE', 'SALAD'];
    expect([...shuffled].sort(compareCourses)).toEqual(['CANAPE', 'SALAD', 'MAIN', 'DESSERT']);
  });

  it('puts the non courses at the end', () => {
    expect(courseOrder('NONE')).toBe(COURSES.length - 1);
    expect(courseOrder('STATION')).toBeGreaterThan(courseOrder('DESSERT'));
  });
});

describe('what a course and a unit imply', () => {
  it('knows which courses reach a seated guest on a plate', () => {
    expect(isPlatedCourse('MAIN')).toBe(true);
    expect(isPlatedCourse('SOUP')).toBe(true);
    expect(isPlatedCourse('CANAPE')).toBe(false);
    expect(isPlatedCourse('STATION')).toBe(false);
    expect(isPlatedCourse('BEVERAGE')).toBe(false);
    expect(isPlatedCourse('NONE')).toBe(false);
  });

  it('knows which units scale with the cover count', () => {
    expect(scalesWithCovers('PERSON')).toBe(true);
    expect(scalesWithCovers('PIECE')).toBe(false);
    expect(scalesWithCovers('GALLON')).toBe(false);
    expect(scalesWithCovers('HOUR')).toBe(false);
  });
});
