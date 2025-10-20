import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { seedFunction } from '../../support/fixtures.js';
import { KITCHEN_NOW, readyFunction } from '../../support/production.js';
import { seedLabour } from '../../support/labour.js';
import { conferenceResume, renderResume } from '../../../src/reports/resume.js';
import { openCovers, setGuarantee } from '../../../src/covers/guarantee.js';
import { setCourseSplit } from '../../../src/covers/selections.js';
import { buildRoster } from '../../../src/labour/shifts.js';
import { drawPackageCharges } from '../../../src/billing/charges.js';
import { drawRevision } from '../../../src/orders/revisions.js';
import type { Database } from '../../../src/store/database.js';

function conference(db: Database) {
  const dinner = readyFunction(db, { guarantee: 180 });
  seedLabour(db);
  buildRoster(db, dinner.id, KITCHEN_NOW);
  drawPackageCharges(db, dinner.id);

  const breakfast = seedFunction(db, dinner.bookingId, {
    spaceCode: 'ASPEN',
    name: 'Committee Breakfast',
    serviceDate: '2025-04-17',
    setupStyle: 'ROUNDS-10',
    expectedCovers: 40,
    startMinute: 420,
    endMinute: 540,
  });
  openCovers(db, breakfast.id, { packageCode: 'PLATED-THREE', contractDate: '2025-01-20' });
  setGuarantee(db, breakfast.id, 40, KITCHEN_NOW);
  setCourseSplit(db, breakfast.id, 'STARTER', [{ itemCode: 'BEET-TART', covers: 40 }]);
  setCourseSplit(db, breakfast.id, 'MAIN', [{ itemCode: 'SHORT-RIB', covers: 40 }]);
  setCourseSplit(db, breakfast.id, 'DESSERT', [{ itemCode: 'SORBET', covers: 40 }]);

  return { dinner, breakfast, bookingId: dinner.bookingId };
}

describe('the resume', () => {
  it('carries the header off the booking', () => {
    withStore((db) => {
      const { bookingId } = conference(db);
      const resume = conferenceResume(db, bookingId);
      expect(resume.postAs).toBe('Fenwick Annual Symposium');
      expect(resume.accountName).toBe('Fenwick Geological Society');
      expect(resume.salesManager).toBe('r.okonkwo');
      expect(resume.arrival).toBe('2025-04-17');
    });
  });

  it('lists the functions in date and time order', () => {
    withStore((db) => {
      const { bookingId, breakfast, dinner } = conference(db);
      const resume = conferenceResume(db, bookingId);
      expect(resume.rows.map((row) => row.functionId)).toEqual([breakfast.id, dinner.id]);
      expect(resume.rows[0]?.start).toBe('7am');
      expect(resume.rows[1]?.start).toBe('6pm');
    });
  });

  it('reports the peak cover count rather than the sum', () => {
    withStore((db) => {
      const { bookingId } = conference(db);
      expect(conferenceResume(db, bookingId).peakCovers).toBe(180);
    });
  });

  it('totals the charges and the labour', () => {
    withStore((db) => {
      const { bookingId } = conference(db);
      const resume = conferenceResume(db, bookingId);
      expect(resume.totalCharges.amount).toBeGreaterThan(0);
      expect(resume.totalLabour.amount).toBeGreaterThan(0);
    });
  });

  it('names what is still open on each function', () => {
    withStore((db) => {
      const { bookingId, breakfast } = conference(db);
      const resume = conferenceResume(db, bookingId);
      const row = resume.rows.find((each) => each.functionId === breakfast.id);
      expect(row?.open).toContain('nothing charged');
      expect(row?.open).toContain('nobody rostered');
      expect(resume.openItems).toBeGreaterThan(0);
    });
  });

  it('reports the state of the sheet on each function', () => {
    withStore((db) => {
      const { bookingId, dinner } = conference(db);
      expect(
        conferenceResume(db, bookingId).rows.find((row) => row.functionId === dinner.id)?.sheet,
      ).toBe('not drawn');

      const drawn = drawRevision(db, dinner.id, KITCHEN_NOW);
      expect(
        conferenceResume(db, bookingId).rows.find((row) => row.functionId === dinner.id)?.sheet,
      ).toBe(`${drawn.id} draft`);

      setGuarantee(db, dinner.id, 190, KITCHEN_NOW);
      expect(
        conferenceResume(db, bookingId).rows.find((row) => row.functionId === dinner.id)?.sheet,
      ).toBe(`${drawn.id} stale`);
    });
  });

  it('prints one page with a heading a day', () => {
    withStore((db) => {
      const { bookingId } = conference(db);
      const text = renderResume(conferenceResume(db, bookingId));
      expect(text).toContain('RESUME  BK-2025-0001  Fenwick Annual Symposium');
      expect(text).toContain('Thu 17 Apr 2025');
      expect(text).toContain('Fri 18 Apr 2025');
      expect(text).toContain('peak 180 covers');
      expect(text).toContain('open: nothing charged');
    });
  });

  it('says so on a booking with no functions', () => {
    withStore((db) => {
      const { bookingId } = conference(db);
      const built = conferenceResume(db, bookingId);
      expect(built.rows.length).toBeGreaterThan(0);
      expect(renderResume({ ...built, rows: [] })).toContain('no functions');
    });
  });
});
