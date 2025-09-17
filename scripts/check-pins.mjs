/**
 * Every dependency is pinned to an exact version.
 *
 * A caret on a production dependency means the build that ships is not the
 * build that was tested. This runs in CI rather than being a convention,
 * because a convention is a thing somebody forgets at five o clock.
 */

import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const groups = ['dependencies', 'devDependencies', 'optionalDependencies'];
const exact = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const loose = [];
for (const group of groups) {
  for (const [name, range] of Object.entries(manifest[group] ?? {})) {
    if (!exact.test(range)) {
      loose.push(`${group}.${name} is ${range}`);
    }
  }
}

if (loose.length > 0) {
  console.error('these dependencies are not pinned to an exact version:');
  for (const line of loose) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

const counted = groups.reduce(
  (total, group) => total + Object.keys(manifest[group] ?? {}).length,
  0,
);
console.log(`${counted} dependencies, all pinned`);
