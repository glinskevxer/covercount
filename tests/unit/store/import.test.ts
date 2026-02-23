import { describe, expect, it } from 'vitest';
import { withStore } from '../../support/store.js';
import { CANYON, FIXED_NOW, seedProperty } from '../../support/fixtures.js';
import { seedFullCatalog } from '../../support/menu.js';
import { catalogCode as code } from '../../../src/core/ids.js';
import { calendarDate } from '../../../src/core/calendar.js';
import { findPriceOn } from '../../../src/catalog/pricing.js';
import { listIngredients } from '../../../src/production/ingredients.js';
import { importLarder, importPrices, renderImportReport } from '../../../src/store/import.js';
import type { Database } from '../../../src/store/database.js';

const RACK = code('RACK-2025');
const JUL = calendarDate('2025-07-01');

function priced(db: Database): void {
  seedProperty(db);
  seedFullCatalog(db);
}

const GOOD_PRICES = [
  'subject,code,from,price',
  'ITEM,BEET-TART,2025-07-01,18.50',
  'ITEM,SHORT-RIB,2025-07-01,64.00',
  'PACKAGE,PLATED-THREE,2025-07-01,142.00',
].join('\n');

describe('loading a price book', () => {
  it('writes every row and reads them back on the date', () => {
    withStore((db) => {
      priced(db);
      const report = importPrices(db, CANYON, RACK, GOOD_PRICES);
      expect(report.read).toBe(3);
      expect(report.written).toBe(3);
      expect(report.problems).toEqual([]);
      expect(findPriceOn(db, CANYON, RACK, 'ITEM', code('BEET-TART'), JUL)?.amount).toBe(1_850);
      expect(findPriceOn(db, CANYON, RACK, 'PACKAGE', code('PLATED-THREE'), JUL)?.amount).toBe(
        14_200,
      );
    });
  });

  it('writes nothing at all on a dry run', () => {
    withStore((db) => {
      priced(db);
      const report = importPrices(db, CANYON, RACK, GOOD_PRICES, { dryRun: true });
      expect(report.read).toBe(3);
      expect(report.written).toBe(0);
      expect(report.dryRun).toBe(true);
      expect(findPriceOn(db, CANYON, RACK, 'ITEM', code('BEET-TART'), JUL)).toBeUndefined();
    });
  });

  it('writes nothing when one row is bad, not the rows before it', () => {
    withStore((db) => {
      priced(db);
      const text = [
        'subject,code,from,price',
        'ITEM,BEET-TART,2025-07-01,18.50',
        'ITEM,SHORT-RIB,not-a-date,64.00',
      ].join('\n');
      const report = importPrices(db, CANYON, RACK, text);
      expect(report.written).toBe(0);
      expect(report.problems).toEqual([{ line: 3, message: 'not-a-date is not a date' }]);
      expect(findPriceOn(db, CANYON, RACK, 'ITEM', code('BEET-TART'), JUL)).toBeUndefined();
    });
  });

  it('names the line for a bad amount, a bad subject and a missing code', () => {
    withStore((db) => {
      priced(db);
      const text = [
        'subject,code,from,price',
        'ITEM,BEET-TART,2025-07-01,eighteen fifty',
        'THING,SHORT-RIB,2025-07-01,64.00',
        'ITEM,,2025-07-01,10.00',
      ].join('\n');
      const report = importPrices(db, CANYON, RACK, text);
      expect(report.problems.map((problem) => problem.line)).toEqual([2, 3, 4]);
      expect(report.problems[0]?.message).toContain('not a USD amount');
      expect(report.problems[1]?.message).toContain('neither an item nor a package');
      expect(report.problems[2]?.message).toBe('no code on the row');
    });
  });

  it('catches the same subject priced twice from one date', () => {
    withStore((db) => {
      priced(db);
      const text = [
        'subject,code,from,price',
        'ITEM,BEET-TART,2025-07-01,18.50',
        'ITEM,BEET-TART,2025-07-01,19.50',
      ].join('\n');
      const report = importPrices(db, CANYON, RACK, text);
      expect(report.problems[0]?.message).toContain('priced twice from 2025-07-01');
    });
  });

  it('refuses a file with the wrong columns', () => {
    withStore((db) => {
      priced(db);
      expect(() => importPrices(db, CANYON, RACK, 'code,amount\nBEET-TART,18.50')).toThrow(
        /missing the subject, from, price column/,
      );
    });
  });

  it('reads an empty file as nothing rather than an error', () => {
    withStore((db) => {
      priced(db);
      const report = importPrices(db, CANYON, RACK, '');
      expect(report.read).toBe(0);
      expect(report.written).toBe(0);
    });
  });
});

const GOOD_LARDER = [
  'code,name,store,unit,pack',
  'SHORT-RIB,Beef short rib bone in,BUTCHER,LB,40',
  'BUTTER,Unsalted butter,CHILL,LB,36',
].join('\n');

describe('loading the larder', () => {
  it('writes every row', () => {
    withStore((db) => {
      seedProperty(db);
      const report = importLarder(db, CANYON, GOOD_LARDER, FIXED_NOW);
      expect(report.written).toBe(2);
      expect(listIngredients(db, CANYON).map((row) => row.code)).toEqual(['BUTTER', 'SHORT-RIB']);
    });
  });

  it('refuses to overwrite an ingredient already on file', () => {
    withStore((db) => {
      seedProperty(db);
      importLarder(db, CANYON, GOOD_LARDER, FIXED_NOW);
      const again = importLarder(db, CANYON, GOOD_LARDER, FIXED_NOW);
      expect(again.written).toBe(0);
      expect(again.problems.map((problem) => problem.message)).toEqual([
        'SHORT-RIB is already on file',
        'BUTTER is already on file',
      ]);
    });
  });

  it('catches the same code twice in one file', () => {
    withStore((db) => {
      seedProperty(db);
      const text = [
        'code,name,store,unit,pack',
        'SHORT-RIB,Beef short rib,BUTCHER,LB,40',
        'SHORT-RIB,Beef short rib again,BUTCHER,LB,40',
      ].join('\n');
      expect(importLarder(db, CANYON, text, FIXED_NOW).problems[0]?.message).toContain(
        'appears twice',
      );
    });
  });

  it('catches a pack size that is not one', () => {
    withStore((db) => {
      seedProperty(db);
      const text = ['code,name,store,unit,pack', 'SHORT-RIB,Beef short rib,BUTCHER,LB,none'].join(
        '\n',
      );
      expect(importLarder(db, CANYON, text, FIXED_NOW).problems[0]?.message).toContain(
        'not a pack size',
      );
    });
  });

  it('writes nothing on a dry run', () => {
    withStore((db) => {
      seedProperty(db);
      expect(importLarder(db, CANYON, GOOD_LARDER, FIXED_NOW, { dryRun: true }).written).toBe(0);
      expect(listIngredients(db, CANYON)).toEqual([]);
    });
  });
});

describe('printing the report', () => {
  it('says what was written', () => {
    withStore((db) => {
      priced(db);
      const text = renderImportReport(importPrices(db, CANYON, RACK, GOOD_PRICES));
      expect(text).toBe('3 row(s) read, 3 written');
    });
  });

  it('says nothing was written and names each line', () => {
    withStore((db) => {
      priced(db);
      const report = importPrices(
        db,
        CANYON,
        RACK,
        'subject,code,from,price\nITEM,BEET-TART,nope,18.50',
      );
      const text = renderImportReport(report);
      expect(text).toContain('nothing was written');
      expect(text).toContain('line    2');
    });
  });

  it('says nothing was written on a dry run', () => {
    withStore((db) => {
      priced(db);
      const text = renderImportReport(
        importPrices(db, CANYON, RACK, GOOD_PRICES, { dryRun: true }),
      );
      expect(text).toBe('3 row(s) read, nothing written');
    });
  });
});
