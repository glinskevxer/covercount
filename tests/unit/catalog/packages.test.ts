import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty } from '../../support/fixtures.js';
import { seedMenu, seedPackages } from '../../support/menu.js';
import {
  createPackage,
  findPackage,
  listPackages,
  maxSelectionsPerCover,
  packageCourses,
  packageItems,
  requirePackage,
  requiredCourses,
  setPackageActive,
} from '../../../src/catalog/packages.js';
import { catalogCode } from '../../../src/core/ids.js';

const code = catalogCode;

function threeCourse(overrides: Partial<Parameters<typeof createPackage>[2]> = {}) {
  return {
    code: 'PLATED-THREE',
    name: 'Three course plated dinner',
    serviceStyle: 'PLATED',
    minCovers: 20,
    courses: [
      { course: 'STARTER', choices: 1, items: ['BEET-TART'] },
      { course: 'MAIN', choices: 1, items: ['SHORT-RIB', 'HALIBUT', 'ROOT-PLATE'] },
      { course: 'DESSERT', choices: 1, items: ['CHOC-TART', 'SORBET'] },
    ],
    ...overrides,
  };
}

describe('creating a package', () => {
  it('reads back what it was given', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      const created = createPackage(db, CANYON, threeCourse(), FIXED_NOW);
      expect(created.code).toBe('PLATED-THREE');
      expect(created.name).toBe('Three course plated dinner');
      expect(created.serviceStyle).toBe('PLATED');
      expect(created.minCovers).toBe(20);
      expect(created.active).toBe(true);
      expect(created.createdAt).toBe(FIXED_NOW);
    });
  });

  it('holds the courses in print order whatever order they arrived in', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      createPackage(
        db,
        CANYON,
        threeCourse({
          courses: [
            { course: 'DESSERT', items: ['SORBET'] },
            { course: 'MAIN', items: ['ROOT-PLATE'] },
            { course: 'STARTER', items: ['BEET-TART'] },
          ],
        }),
        FIXED_NOW,
      );
      expect(packageCourses(db, CANYON, code('PLATED-THREE')).map((row) => row.course)).toEqual([
        'STARTER',
        'MAIN',
        'DESSERT',
      ]);
    });
  });

  it('holds the choices and whether the course is required', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      createPackage(
        db,
        CANYON,
        threeCourse({
          courses: [
            { course: 'MAIN', choices: 2, items: ['SHORT-RIB', 'HALIBUT', 'ROOT-PLATE'] },
            { course: 'DESSERT', required: false, items: ['SORBET'] },
          ],
        }),
        FIXED_NOW,
      );
      const courses = packageCourses(db, CANYON, code('PLATED-THREE'));
      expect(courses[0]?.choices).toBe(2);
      expect(courses[0]?.required).toBe(true);
      expect(courses[1]?.required).toBe(false);
      expect(courses[0]?.items).toEqual(['HALIBUT', 'ROOT-PLATE', 'SHORT-RIB']);
    });
  });

  it('refuses a blank name, an unknown style and a bad minimum', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(() => createPackage(db, CANYON, threeCourse({ name: ' ' }), FIXED_NOW)).toThrow(
        /needs a name/,
      );
      expect(() =>
        createPackage(db, CANYON, threeCourse({ serviceStyle: 'TAPAS' }), FIXED_NOW),
      ).toThrow(/not a service style/);
      expect(() => createPackage(db, CANYON, threeCourse({ minCovers: -1 }), FIXED_NOW)).toThrow(
        /whole count of covers/,
      );
    });
  });

  it('refuses a package with no courses at all', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(() => createPackage(db, CANYON, threeCourse({ courses: [] }), FIXED_NOW)).toThrow(
        /carries no courses/,
      );
    });
  });
});

describe('refusing a package nobody could serve', () => {
  it('refuses a course listed twice', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(() =>
        createPackage(
          db,
          CANYON,
          threeCourse({
            courses: [
              { course: 'MAIN', items: ['SHORT-RIB'] },
              { course: 'main', items: ['HALIBUT'] },
            ],
          }),
          FIXED_NOW,
        ),
      ).toThrow(/lists the MAIN course twice/);
    });
  });

  it('refuses a course with nothing to choose from', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(() =>
        createPackage(
          db,
          CANYON,
          threeCourse({ courses: [{ course: 'MAIN', items: [] }] }),
          FIXED_NOW,
        ),
      ).toThrow(/offers nothing to choose from/);
    });
  });

  it('refuses more choices than there are items', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(() =>
        createPackage(
          db,
          CANYON,
          threeCourse({
            courses: [{ course: 'MAIN', choices: 4, items: ['SHORT-RIB', 'HALIBUT'] }],
          }),
          FIXED_NOW,
        ),
      ).toThrow(/lets a guest pick 4 from 2/);
    });
  });

  it('refuses zero or a fractional number of choices', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      for (const choices of [0, -1, 1.5]) {
        expect(() =>
          createPackage(
            db,
            CANYON,
            threeCourse({ courses: [{ course: 'MAIN', choices, items: ['SHORT-RIB'] }] }),
            FIXED_NOW,
          ),
        ).toThrow(/which is not a whole number of one or more/);
      }
    });
  });

  it('refuses the same item offered twice in one course', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(() =>
        createPackage(
          db,
          CANYON,
          threeCourse({ courses: [{ course: 'MAIN', items: ['SHORT-RIB', 'short-rib'] }] }),
          FIXED_NOW,
        ),
      ).toThrow(/offers SHORT-RIB twice in the MAIN course/);
    });
  });

  it('refuses an item filed under a different course', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(() =>
        createPackage(
          db,
          CANYON,
          threeCourse({ courses: [{ course: 'MAIN', items: ['SORBET'] }] }),
          FIXED_NOW,
        ),
      ).toThrow(/is a DESSERT item and cannot be offered in the MAIN course/);
    });
  });

  it('refuses an item that is not in the catalog and a course called NONE', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(() =>
        createPackage(
          db,
          CANYON,
          threeCourse({ courses: [{ course: 'MAIN', items: ['UNICORN'] }] }),
          FIXED_NOW,
        ),
      ).toThrow(/has no menu item UNICORN/);
      expect(() =>
        createPackage(
          db,
          CANYON,
          threeCourse({ courses: [{ course: 'NONE', items: ['CHAFER'] }] }),
          FIXED_NOW,
        ),
      ).toThrow(/cannot carry a course called NONE/);
    });
  });

  it('leaves nothing behind when it refuses part way through', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      expect(() =>
        createPackage(
          db,
          CANYON,
          threeCourse({
            courses: [
              { course: 'STARTER', items: ['BEET-TART'] },
              { course: 'MAIN', items: ['SORBET'] },
            ],
          }),
          FIXED_NOW,
        ),
      ).toThrow();
      expect(findPackage(db, CANYON, code('PLATED-THREE'))).toBeUndefined();
    });
  });

  it('refuses a duplicate package code', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      createPackage(db, CANYON, threeCourse(), FIXED_NOW);
      expect(() => createPackage(db, CANYON, threeCourse(), FIXED_NOW)).toThrow(
        /already has a package PLATED-THREE/,
      );
    });
  });
});

describe('reading packages', () => {
  it('answers for one that is not there', () => {
    withStore((db) => {
      seedProperty(db);
      expect(findPackage(db, CANYON, code('NOTHING'))).toBeUndefined();
      expect(() => requirePackage(db, CANYON, code('NOTHING'))).toThrow(/has no package/);
    });
  });

  it('lists in code order and filters out what is off the menu', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedPackages(db);
      expect(listPackages(db, CANYON).map((row) => row.code)).toEqual([
        'PLATED-THREE',
        'RECEPTION-HOUR',
      ]);
      setPackageActive(db, CANYON, code('RECEPTION-HOUR'), false);
      expect(listPackages(db, CANYON, { activeOnly: true }).map((row) => row.code)).toEqual([
        'PLATED-THREE',
      ]);
      expect(setPackageActive(db, CANYON, code('RECEPTION-HOUR'), true).active).toBe(true);
    });
  });

  it('lists every item any course offers', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedPackages(db);
      expect(packageItems(db, CANYON, code('PLATED-THREE'))).toEqual([
        'BEET-TART',
        'CHOC-TART',
        'HALIBUT',
        'ROOT-PLATE',
        'SHORT-RIB',
        'SORBET',
      ]);
    });
  });

  it('counts the most plates one guest can end up with', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedPackages(db);
      expect(maxSelectionsPerCover(db, CANYON, code('PLATED-THREE'))).toBe(3);
      expect(maxSelectionsPerCover(db, CANYON, code('RECEPTION-HOUR'))).toBe(1);
    });
  });

  it('names the courses a guest has to choose in', () => {
    withStore((db) => {
      seedProperty(db);
      seedMenu(db);
      seedPackages(db);
      expect(requiredCourses(db, CANYON, code('PLATED-THREE'))).toEqual([
        'STARTER',
        'MAIN',
        'DESSERT',
      ]);
      expect(requiredCourses(db, CANYON, code('RECEPTION-HOUR'))).toEqual([]);
    });
  });
});
