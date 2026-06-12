/**
 * One version number, in three places, checked.
 *
 * The package carries a version, the command line prints one and the read
 * service serves one. They are three different files and nothing has ever made
 * them agree, so the way this goes wrong is not dramatic: somebody bumps the
 * package for a release, the CLI keeps printing the old number, and six months
 * later a support call turns on which build is actually installed.
 *
 * Inlining the package version into the source is not the fix — it would mean
 * the built output reads a JSON file at runtime from a path that differs
 * between the source tree, the dist tree and the container. Checking is.
 */

import { readFileSync } from 'node:fs';

function versionIn(file, pattern, what) {
  const text = readFileSync(file, 'utf8');
  const match = pattern.exec(text);
  if (match === null) {
    console.error(`could not find ${what} in ${file}`);
    process.exit(1);
  }
  return { file, what, version: match[1] };
}

const found = [
  {
    file: 'package.json',
    what: 'the package version',
    version: JSON.parse(readFileSync('package.json', 'utf8')).version,
  },
  versionIn('src/cli/program.ts', /export const VERSION = '([^']+)'/, 'the command line version'),
  versionIn(
    'src/http/service.ts',
    /export const SERVICE_VERSION = '([^']+)'/,
    'the service version',
  ),
];

const SEMVER = /^\d+\.\d+\.\d+$/;
const wrong = found.filter((entry) => !SEMVER.test(entry.version));
if (wrong.length > 0) {
  for (const entry of wrong) {
    console.error(
      `${entry.file}: ${entry.what} is ${JSON.stringify(entry.version)}, not a version`,
    );
  }
  process.exit(1);
}

const distinct = new Set(found.map((entry) => entry.version));
if (distinct.size > 1) {
  console.error('the version is not the same in every place it is written:');
  for (const entry of found) {
    console.error(`  ${entry.file.padEnd(22)} ${entry.what.padEnd(26)} ${entry.version}`);
  }
  process.exit(1);
}

console.log(`version ${[...distinct][0]} in all ${found.length} places`);
