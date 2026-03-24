/**
 * The refusal codes, as a list.
 *
 * Every refusal in this build carries a stable code so a caller can branch on
 * the rule rather than on the wording. That only holds if the codes are worth
 * branching on, and the way they stop being worth branching on is gradual: one
 * gets reused for two different rules, another is spelled two ways, a third
 * says `error` and could mean anything.
 *
 * So the codes are read out of the source and checked. It is a lint rather
 * than a runtime concern, which is why it lives next to the error type and
 * runs from a test rather than from the domain.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainErrorKind } from './errors.js';

export interface CodeUse {
  readonly code: string;
  readonly file: string;
  readonly kind: DomainErrorKind;
}

const HELPERS: Record<string, DomainErrorKind> = {
  invalidInput: 'invalid-input',
  notFound: 'not-found',
  conflict: 'conflict',
  ruleViolation: 'rule-violation',
  deadlinePassed: 'deadline-passed',
  capacityExceeded: 'capacity-exceeded',
  notPermitted: 'not-permitted',
};

/**
 * Codes deliberately raised from more than one place.
 *
 * Each of these is one rule that two modules enforce, not two rules that share
 * a name. "There is no such item" is the same refusal whether the catalog or a
 * recipe asked, and a caller branching on it wants both.
 */
const SHARED = new Set([
  'store.identifier',
  'store.keys',
  'booking.finished',
  'cli.status',
  'covers.unguaranteed',
  'item.missing',
  'recipe.missing',
  'space.exists',
  'staffing.missing',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (name.endsWith('.ts')) {
      out.push(path.split('\\').join('/'));
    }
  }
  return out;
}

/** Every code raised anywhere under `root`, with the file that raises it. */
export function collectCodes(root = 'src'): CodeUse[] {
  const uses: CodeUse[] = [];
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    for (const [helper, kind] of Object.entries(HELPERS)) {
      const pattern = new RegExp(`\\b${helper}\\(\\s*'([^']+)'`, 'g');
      for (const match of text.matchAll(pattern)) {
        const code = match[1];
        if (code !== undefined) {
          uses.push({ code, file, kind });
        }
      }
    }
  }
  return uses.sort((left, right) => left.code.localeCompare(right.code));
}

export interface CatalogueProblem {
  readonly code: string;
  readonly message: string;
}

const SHAPE = /^[a-z][a-z0-9]*\.[a-z][a-z0-9-]*$/;

/**
 * What is wrong with the catalogue.
 *
 * Three things count. A code that is not `area.reason` cannot be read at a
 * glance. A code raised from two different files is one a caller cannot use to
 * tell two rules apart. And a code carrying two different kinds is one that
 * answers with a different status depending on which line threw it, which is
 * worse than either.
 */
export function catalogueProblems(uses: readonly CodeUse[]): CatalogueProblem[] {
  const problems: CatalogueProblem[] = [];
  const byCode = new Map<string, CodeUse[]>();
  for (const use of uses) {
    const existing = byCode.get(use.code);
    if (existing === undefined) {
      byCode.set(use.code, [use]);
    } else {
      existing.push(use);
    }
  }

  for (const [code, entries] of [...byCode.entries()].sort()) {
    if (!SHAPE.test(code)) {
      problems.push({ code, message: 'is not shaped as area.reason' });
    }
    const files = new Set(entries.map((entry) => entry.file));
    if (files.size > 1 && !SHARED.has(code)) {
      problems.push({
        code,
        message: `is raised from ${files.size} files: ${[...files].sort().join(', ')}`,
      });
    }
    const kinds = new Set(entries.map((entry) => entry.kind));
    if (kinds.size > 1) {
      problems.push({
        code,
        message: `carries ${kinds.size} kinds: ${[...kinds].sort().join(', ')}`,
      });
    }
  }
  return problems;
}

export interface CatalogueEntry {
  readonly code: string;
  readonly kind: DomainErrorKind;
  readonly area: string;
  readonly raisedIn: string;
}

/** The catalogue itself, for printing. */
export function catalogue(uses: readonly CodeUse[]): CatalogueEntry[] {
  const seen = new Map<string, CatalogueEntry>();
  for (const use of uses) {
    if (seen.has(use.code)) {
      continue;
    }
    seen.set(use.code, {
      code: use.code,
      kind: use.kind,
      area: use.code.split('.')[0] ?? '',
      raisedIn: use.file,
    });
  }
  return [...seen.values()].sort((left, right) => left.code.localeCompare(right.code));
}
