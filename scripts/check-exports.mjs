/**
 * Find exports nothing imports.
 *
 * A module that grows an export for one caller and then loses the caller keeps
 * the export, and nothing complains: it typechecks, it is covered by its own
 * unit test, and it is dead. Over a year that is how a codebase ends up with
 * two functions that do the same thing and a reader who cannot tell which one
 * is real.
 *
 * The rule here is deliberately narrow. Only `src/` is scanned, only values
 * are checked, tests count as callers, and the entry points are exempt because
 * nothing inside the repo imports them.
 *
 * Types are left out on purpose. An interface naming a function's return shape
 * is part of that function's public surface whether or not anybody writes the
 * name down, so an unimported type says nothing, and a check that reported one
 * would push somebody into deleting the vocabulary the module is described in.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'src';
const ROOTS = ['src', 'tests', 'scripts'];

/** Files nothing in the repo imports, because they are how it is started. */
const ENTRY_POINTS = new Set(['src/cli/main.ts', 'src/index.ts']);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else if (name.endsWith('.ts') || name.endsWith('.mjs')) {
      out.push(path.split('\\').join('/'));
    }
  }
  return out;
}

const EXPORT_PATTERNS = [
  /^export (?:async )?function ([A-Za-z0-9_]+)/gm,
  /^export (?:abstract )?class ([A-Za-z0-9_]+)/gm,
  /^export const ([A-Za-z0-9_]+)/gm,
];

const sourceFiles = walk(SRC);
const allFiles = ROOTS.flatMap((root) => walk(root));
const corpus = new Map(allFiles.map((file) => [file, readFileSync(file, 'utf8')]));

const problems = [];

for (const file of sourceFiles) {
  const key = relative('.', file).split('\\').join('/');
  if (ENTRY_POINTS.has(key)) {
    continue;
  }
  const text = corpus.get(file) ?? '';
  const names = new Set();
  for (const pattern of EXPORT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      names.add(match[1]);
    }
  }

  for (const name of names) {
    let used = false;
    for (const [other, body] of corpus) {
      if (other === file) {
        continue;
      }
      // A word boundary match is enough: an identifier that appears anywhere
      // in another file is either imported or shadowed, and a shadow that
      // happens to share the name is a false negative rather than a false
      // alarm.
      if (new RegExp(`\\b${name}\\b`).test(body)) {
        used = true;
        break;
      }
    }
    if (!used) {
      problems.push(`${key}: ${name} is exported and nothing imports it`);
    }
  }
}

if (problems.length > 0) {
  console.error(`${problems.length} unused export(s):`);
  for (const problem of problems.sort()) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}

console.log(`no unused exports across ${sourceFiles.length} source files`);
