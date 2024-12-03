/**
 * Identifiers a banquet office reads out over the phone.
 *
 * Nobody in a sales office quotes a UUID. They quote "the Fenwick wedding,
 * booking twenty five dash oh one four two", so the identifiers here are
 * short, sequential within a year, and carry their kind on the front. The
 * catalog uses codes people type instead, which is a different shape and gets
 * a different validator.
 */

import { invalidInput } from './errors.js';

export const ID_PREFIXES = {
  booking: 'BK',
  functionSlot: 'FN',
  beo: 'BEO',
  changeOrder: 'CO',
  invoice: 'INV',
  requisition: 'RQ',
  shift: 'SH',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export type EntityId<K extends IdKind = IdKind> = string & { readonly __idKind: K };

const ID_SHAPE = /^([A-Z]{2,3})-(\d{4})-(\d{4})$/;

export function formatEntityId<K extends IdKind>(
  kind: K,
  year: number,
  sequence: number,
): EntityId<K> {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw invalidInput('id.year', `${year} is not a four digit year`);
  }
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw invalidInput('id.sequence', `${sequence} is outside the sequence range 1 to 9999`);
  }
  const prefix = ID_PREFIXES[kind];
  return `${prefix}-${year}-${sequence.toString().padStart(4, '0')}` as EntityId<K>;
}

export function parseEntityId<K extends IdKind>(kind: K, text: string): EntityId<K> {
  const trimmed = text.trim().toUpperCase();
  const match = ID_SHAPE.exec(trimmed);
  if (match === null) {
    throw invalidInput('id.shape', `${JSON.stringify(text)} is not an identifier this office uses`);
  }
  if (match[1] !== ID_PREFIXES[kind]) {
    throw invalidInput(
      'id.kind',
      `${trimmed} is a ${match[1] ?? '?'} identifier, not a ${ID_PREFIXES[kind]} one`,
    );
  }
  return trimmed as EntityId<K>;
}

export function entityIdKind(text: string): IdKind | undefined {
  const match = ID_SHAPE.exec(text.trim().toUpperCase());
  if (match === null) {
    return undefined;
  }
  for (const [kind, prefix] of Object.entries(ID_PREFIXES)) {
    if (prefix === match[1]) {
      return kind as IdKind;
    }
  }
  return undefined;
}

export function entityIdYear(id: EntityId): number {
  return Number(id.slice(id.indexOf('-') + 1, id.lastIndexOf('-')));
}

export function entityIdSequence(id: EntityId): number {
  return Number(id.slice(id.lastIndexOf('-') + 1));
}

/**
 * A revision identifier hangs off its parent, so a banquet event order reads
 * BEO-2025-0142 r3 and sorts next to its siblings.
 */
export function formatRevisionId(parent: EntityId<'beo'>, revision: number): string {
  if (!Number.isInteger(revision) || revision < 0) {
    throw invalidInput('id.revision', `${revision} is not a revision number`);
  }
  return `${parent} r${revision}`;
}

const CODE_SHAPE = /^[A-Z0-9]+(?:[-.][A-Z0-9]+)*$/;

export type CatalogCode = string & { readonly __brand: 'CatalogCode' };

/** Catalog codes are typed by hand all day, so they normalise hard. */
export function catalogCode(text: string): CatalogCode {
  const normalised = text.trim().toUpperCase().replace(/\s+/g, '-');
  if (normalised.length === 0) {
    throw invalidInput('code.empty', 'a catalog code cannot be blank');
  }
  if (normalised.length > 32) {
    throw invalidInput('code.length', `${normalised} is longer than 32 characters`);
  }
  if (!CODE_SHAPE.test(normalised)) {
    throw invalidInput(
      'code.shape',
      `${JSON.stringify(text)} is not a catalog code, use letters, digits, dashes and dots`,
    );
  }
  return normalised as CatalogCode;
}

export function isCatalogCode(text: string): boolean {
  try {
    catalogCode(text);
    return true;
  } catch {
    return false;
  }
}
