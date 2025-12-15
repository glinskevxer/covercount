/**
 * Two handles on one file.
 *
 * The store sits on a shared drive with the banquet office writing to it and
 * the kitchen screen reading. That is the only concurrency this build has, and
 * it is worth proving rather than assuming: a reader must never see half a
 * transaction, a second writer must wait rather than fail, and a reader must
 * never be able to write however it was opened.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanScratch, scratchStorePath } from '../support/store.js';
import { closeDatabase, inTransaction, openDatabase } from '../../src/store/database.js';
import { openStore } from '../../src/store/schema.js';
import { createProperty, listSpaces, addSpace } from '../../src/property/store.js';
import { allocateSequence } from '../../src/store/sequence.js';
import { catalogCode } from '../../src/core/ids.js';
import { FIXED_NOW } from '../support/fixtures.js';

afterEach(cleanScratch);

const CANYON = catalogCode('CANYON');

function seed(path: string) {
  const db = openStore(path);
  createProperty(
    db,
    {
      code: 'CANYON',
      name: 'Canyon Ridge Hotel',
      timeZone: 'America/Denver',
      currency: 'USD',
      guaranteeLeadDays: 3,
      guaranteeDueMinute: 720,
      oversetPpm: 50_000,
      oversetCap: 25,
    },
    FIXED_NOW,
  );
  return db;
}

describe('a reader alongside a writer', () => {
  it('never sees half a transaction', () => {
    const path = scratchStorePath();
    const writer = seed(path);
    const reader = openDatabase(path, { readOnly: true });

    expect(listSpaces(reader, CANYON)).toHaveLength(0);

    expect(() =>
      inTransaction(writer, (handle) => {
        addSpace(handle, CANYON, {
          code: 'GRAND-A',
          name: 'Grand Ballroom A',
          areaSqFt: 3200,
          fireCapacity: 350,
          setupMinutes: 120,
          teardownMinutes: 60,
        });
        // The reader is looking at the file right now and must not see it.
        expect(listSpaces(reader, CANYON)).toHaveLength(0);
        throw new Error('the sale fell through');
      }),
    ).toThrow('the sale fell through');

    expect(listSpaces(reader, CANYON)).toHaveLength(0);
    closeDatabase(reader);
    closeDatabase(writer);
  });

  it('sees a committed write on the next read', () => {
    const path = scratchStorePath();
    const writer = seed(path);
    const reader = openDatabase(path, { readOnly: true });

    addSpace(writer, CANYON, {
      code: 'GRAND-A',
      name: 'Grand Ballroom A',
      areaSqFt: 3200,
      fireCapacity: 350,
      setupMinutes: 120,
      teardownMinutes: 60,
    });

    expect(listSpaces(reader, CANYON).map((row) => row.code)).toEqual(['GRAND-A']);
    closeDatabase(reader);
    closeDatabase(writer);
  });

  it('will not let a reader write however it is asked', () => {
    const path = scratchStorePath();
    const writer = seed(path);
    const reader = openDatabase(path, { readOnly: true });

    expect(() =>
      addSpace(reader, CANYON, {
        code: 'GRAND-A',
        name: 'Grand Ballroom A',
        areaSqFt: 3200,
        fireCapacity: 350,
        setupMinutes: 120,
        teardownMinutes: 60,
      }),
    ).toThrow();
    expect(() => reader.exec('delete from property')).toThrow();
    expect(() => reader.pragma('journal_mode = DELETE')).toThrow();

    closeDatabase(reader);
    closeDatabase(writer);
  });
});

describe('two writers on one file', () => {
  it('does not hand the same booking number out twice', () => {
    const path = scratchStorePath();
    const first = seed(path);
    const second = openStore(path);

    const issued = new Set<number>();
    for (let round = 0; round < 20; round += 1) {
      issued.add(allocateSequence(first, CANYON, 'booking', 2025));
      issued.add(allocateSequence(second, CANYON, 'booking', 2025));
    }
    expect(issued.size).toBe(40);
    expect(Math.max(...issued)).toBe(40);

    closeDatabase(second);
    closeDatabase(first);
  });

  it('rolls one writer back without touching the other', () => {
    const path = scratchStorePath();
    const first = seed(path);
    const second = openStore(path);

    addSpace(first, CANYON, {
      code: 'GRAND-A',
      name: 'Grand Ballroom A',
      areaSqFt: 3200,
      fireCapacity: 350,
      setupMinutes: 120,
      teardownMinutes: 60,
    });

    expect(() =>
      inTransaction(second, (handle) => {
        addSpace(handle, CANYON, {
          code: 'ASPEN',
          name: 'Aspen Room',
          areaSqFt: 900,
          fireCapacity: 80,
          setupMinutes: 45,
          teardownMinutes: 30,
        });
        throw new Error('changed their mind');
      }),
    ).toThrow('changed their mind');

    expect(listSpaces(first, CANYON).map((row) => row.code)).toEqual(['GRAND-A']);
    expect(listSpaces(second, CANYON).map((row) => row.code)).toEqual(['GRAND-A']);

    closeDatabase(second);
    closeDatabase(first);
  });

  it('leaves the store readable after both close', () => {
    const path = scratchStorePath();
    const first = seed(path);
    const second = openStore(path);
    addSpace(second, CANYON, {
      code: 'ASPEN',
      name: 'Aspen Room',
      areaSqFt: 900,
      fireCapacity: 80,
      setupMinutes: 45,
      teardownMinutes: 30,
    });
    closeDatabase(first);
    closeDatabase(second);

    const reader = openDatabase(path, { readOnly: true });
    expect(listSpaces(reader, CANYON).map((row) => row.code)).toEqual(['ASPEN']);
    closeDatabase(reader);
  });
});
