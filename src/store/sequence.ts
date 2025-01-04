/**
 * Identifier allocation.
 *
 * Booking numbers restart at one every year and must not skip, because the
 * controller reconciles the gap. That rules out a rowid and it rules out
 * anything optimistic: the counter is read and written inside one exclusive
 * transaction, and a caller that throws afterwards has to roll the allocation
 * back with it, which is why every writer allocates inside its own unit of
 * work rather than before it.
 */

import { conflict, invalidInput } from '../core/errors.js';
import { formatEntityId, type EntityId, type IdKind } from '../core/ids.js';
import type { CatalogCode } from '../core/ids.js';
import { inExclusiveTransaction, type Database } from './database.js';

export const MAX_SEQUENCE = 9999;

export function allocateSequence(
  db: Database,
  propertyCode: CatalogCode,
  kind: IdKind,
  year: number,
): number {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw invalidInput('sequence.year', `${year} is not a four digit year`);
  }
  return inExclusiveTransaction(db, (handle) => {
    const row = handle
      .prepare<
        [string, string, number],
        { next_value: number }
      >('select next_value from id_sequence where property_code = ? and kind = ? and year = ?')
      .get(propertyCode, kind, year);

    const next = row?.next_value ?? 1;
    if (next > MAX_SEQUENCE) {
      throw conflict(
        'sequence.exhausted',
        `${propertyCode} has used every ${kind} number for ${year}`,
      );
    }

    if (row === undefined) {
      handle
        .prepare(
          'insert into id_sequence (property_code, kind, year, next_value) values (?, ?, ?, ?)',
        )
        .run(propertyCode, kind, year, next + 1);
    } else {
      handle
        .prepare(
          `update id_sequence set next_value = ?
           where property_code = ? and kind = ? and year = ?`,
        )
        .run(next + 1, propertyCode, kind, year);
    }
    return next;
  });
}

export function allocateEntityId<K extends IdKind>(
  db: Database,
  propertyCode: CatalogCode,
  kind: K,
  year: number,
): EntityId<K> {
  return formatEntityId(kind, year, allocateSequence(db, propertyCode, kind, year));
}

/** What the next number would be, without taking it. */
export function peekSequence(
  db: Database,
  propertyCode: CatalogCode,
  kind: IdKind,
  year: number,
): number {
  const row = db
    .prepare<
      [string, string, number],
      { next_value: number }
    >('select next_value from id_sequence where property_code = ? and kind = ? and year = ?')
    .get(propertyCode, kind, year);
  return row?.next_value ?? 1;
}

/**
 * Move a counter forward, never back. A property being loaded from a previous
 * system arrives with numbers already issued, and the counter has to clear
 * them or the first new booking collides with a historical one.
 */
export function reserveSequenceThrough(
  db: Database,
  propertyCode: CatalogCode,
  kind: IdKind,
  year: number,
  highestUsed: number,
): number {
  if (!Number.isInteger(highestUsed) || highestUsed < 0) {
    throw invalidInput('sequence.reserve', 'the highest used number is a whole count');
  }
  if (highestUsed > MAX_SEQUENCE) {
    throw invalidInput('sequence.reserve', `${highestUsed} is past the end of the ${year} range`);
  }
  return inExclusiveTransaction(db, (handle) => {
    const current = peekSequence(handle, propertyCode, kind, year);
    const target = Math.max(current, highestUsed + 1);
    handle
      .prepare(
        `insert into id_sequence (property_code, kind, year, next_value) values (?, ?, ?, ?)
         on conflict (property_code, kind, year) do update set next_value = excluded.next_value`,
      )
      .run(propertyCode, kind, year, target);
    return target;
  });
}

export interface SequenceState {
  readonly kind: IdKind;
  readonly year: number;
  readonly nextValue: number;
}

export function listSequences(db: Database, propertyCode: CatalogCode): SequenceState[] {
  return db
    .prepare<[string], { kind: string; year: number; next_value: number }>(
      'select kind, year, next_value from id_sequence where property_code = ? order by kind, year',
    )
    .all(propertyCode)
    .map((row) => ({
      kind: row.kind as IdKind,
      year: row.year,
      nextValue: row.next_value,
    }));
}
