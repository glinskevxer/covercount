/**
 * Rooms that are made of other rooms.
 *
 * The Grand Ballroom is an airwall away from being three rooms, and the diary
 * has to know that booking the whole thing takes all three out. Every space is
 * therefore resolved down to the physical rooms it occupies, and two spaces
 * clash when those sets intersect. A combination cannot be built out of
 * another combination, because one level of indirection is all the airwalls
 * give you and nesting them makes the clash set ambiguous.
 */

import { conflict, invalidInput } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { inTransaction, type Database } from '../store/database.js';
import { listSpaces, requireProperty, requireSpace } from './store.js';
import type { FunctionSpace } from './types.js';

export interface DefineCombinationInput {
  readonly code: string;
  readonly name: string;
  readonly components: readonly string[];
  readonly floor?: string;
  readonly fireCapacity?: number;
  readonly setupMinutes?: number;
  readonly teardownMinutes?: number;
}

export function defineCombination(
  db: Database,
  propertyCode: CatalogCode,
  input: DefineCombinationInput,
): FunctionSpace {
  requireProperty(db, propertyCode);
  const code = catalogCode(input.code);
  if (input.components.length < 2) {
    throw invalidInput('combination.parts', 'a combination is made of at least two rooms');
  }

  const componentCodes = input.components.map((part) => catalogCode(part));
  const distinct = new Set(componentCodes);
  if (distinct.size !== componentCodes.length) {
    throw invalidInput('combination.parts', `${code} lists the same room twice`);
  }
  if (distinct.has(code)) {
    throw invalidInput('combination.parts', `${code} cannot be one of its own components`);
  }

  const components = componentCodes.map((part) => requireSpace(db, propertyCode, part));
  for (const component of components) {
    if (component.isCombination) {
      throw invalidInput(
        'combination.nested',
        `${component.code} is itself a combination, and a combination cannot be built from one`,
      );
    }
  }

  const existing = db
    .prepare<
      [string, string],
      { code: string }
    >('select code from function_space where property_code = ? and code = ?')
    .get(propertyCode, code);
  if (existing !== undefined) {
    throw conflict('space.exists', `${propertyCode} already has a room called ${code}`, code);
  }

  const area = components.reduce((total, part) => total + part.areaSqFt, 0);
  const fire =
    input.fireCapacity ?? components.reduce((total, part) => total + part.fireCapacity, 0);
  const setup = input.setupMinutes ?? Math.max(...components.map((part) => part.setupMinutes));
  const teardown =
    input.teardownMinutes ?? Math.max(...components.map((part) => part.teardownMinutes));

  return inTransaction(db, (handle) => {
    handle
      .prepare(
        `insert into function_space (property_code, code, name, floor, area_sq_ft, fire_capacity,
          setup_minutes, teardown_minutes, is_combination)
         values (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        propertyCode,
        code,
        input.name.trim(),
        input.floor ?? components[0]?.floor ?? '',
        area,
        fire,
        setup,
        teardown,
      );

    const insert = handle.prepare(
      'insert into space_component (property_code, combination_code, component_code) values (?, ?, ?)',
    );
    for (const component of components) {
      insert.run(propertyCode, code, component.code);
    }

    return requireSpace(handle, propertyCode, code);
  });
}

export function componentsOf(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
): CatalogCode[] {
  return db
    .prepare<[string, string], { component_code: string }>(
      `select component_code from space_component
       where property_code = ? and combination_code = ? order by component_code`,
    )
    .all(propertyCode, spaceCode)
    .map((row) => catalogCode(row.component_code));
}

/**
 * The physical rooms a space takes out of the diary. A plain room occupies
 * itself; a combination occupies its parts and not itself, because nobody can
 * book the airwall.
 */
export function physicalFootprint(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
): CatalogCode[] {
  const space = requireSpace(db, propertyCode, spaceCode);
  if (!space.isCombination) {
    return [space.code];
  }
  return componentsOf(db, propertyCode, spaceCode);
}

/** Every space whose footprint touches this one, itself included. */
export function clashingSpaces(
  db: Database,
  propertyCode: CatalogCode,
  spaceCode: CatalogCode,
): CatalogCode[] {
  const footprint = new Set(physicalFootprint(db, propertyCode, spaceCode));
  const clashes: CatalogCode[] = [];
  for (const candidate of listSpaces(db, propertyCode)) {
    const other = physicalFootprint(db, propertyCode, candidate.code);
    if (other.some((part) => footprint.has(part))) {
      clashes.push(candidate.code);
    }
  }
  return clashes.sort();
}

export function spacesClash(
  db: Database,
  propertyCode: CatalogCode,
  left: CatalogCode,
  right: CatalogCode,
): boolean {
  const footprint = new Set(physicalFootprint(db, propertyCode, left));
  return physicalFootprint(db, propertyCode, right).some((part) => footprint.has(part));
}

/** Which combinations a physical room is part of, for a diary that shows both. */
export function combinationsContaining(
  db: Database,
  propertyCode: CatalogCode,
  componentCode: CatalogCode,
): CatalogCode[] {
  return db
    .prepare<[string, string], { combination_code: string }>(
      `select combination_code from space_component
       where property_code = ? and component_code = ? order by combination_code`,
    )
    .all(propertyCode, componentCode)
    .map((row) => catalogCode(row.combination_code));
}
