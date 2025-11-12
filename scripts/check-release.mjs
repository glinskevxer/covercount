/**
 * What has to be true of a build before it leaves the machine.
 *
 * Each of these is a thing that has actually gone wrong somewhere: a bin entry
 * pointing at a file the build does not emit, a declaration the compiler
 * cannot express, a version in the manifest that the program does not report,
 * and a generated file that was edited by hand. They are cheap to check and
 * expensive to find later.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const problems = [];

function require(condition, message) {
  if (!condition) {
    problems.push(message);
  }
}

// The bin entry has to point at something the build emits.
for (const [name, path] of Object.entries(manifest.bin ?? {})) {
  require(existsSync(path), `bin ${name} points at ${path}, which is not built`);
}

// Declarations have to exist for everything under src, or a consumer cannot
// import the package. tsc --noEmit does not check this.
function countFiles(directory, extension) {
  if (!existsSync(directory)) {
    return 0;
  }
  return readdirSync(directory).reduce((total, entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return total + countFiles(path, extension);
    }
    return total + (entry.endsWith(extension) ? 1 : 0);
  }, 0);
}

const sources = countFiles('src', '.ts');
const emitted = countFiles('dist/src', '.js');
const declared = countFiles('dist/src', '.d.ts');
require(emitted === sources, `${sources} sources compiled to ${emitted} javascript files`);
require(declared === sources, `${sources} sources produced ${declared} declaration files`);

// The version the program reports has to be the version the manifest carries.
const program = readFileSync('src/cli/program.ts', 'utf8');
const declaredVersion = /export const VERSION = '([^']+)'/.exec(program)?.[1];
require(declaredVersion ===
  manifest.version, `the manifest says ${manifest.version} and the program says ${declaredVersion ?? 'nothing'}`);

const service = readFileSync('src/http/service.ts', 'utf8');
const serviceVersion = /export const SERVICE_VERSION = '([^']+)'/.exec(service)?.[1];
require(serviceVersion ===
  manifest.version, `the manifest says ${manifest.version} and the service says ${serviceVersion ?? 'nothing'}`);

// Every generated file is marked as generated, or it lands in the language
// statistics and reads in a review as though somebody typed it.
const attributes = existsSync('.gitattributes') ? readFileSync('.gitattributes', 'utf8') : '';
for (const generated of ['docs/commands.md']) {
  require(attributes.includes(
    `${generated} linguist-generated=true`,
  ), `${generated} is generated and is not marked as generated in .gitattributes`);
}

// The engines field has to admit the node the CI matrix runs.
require(typeof manifest.engines?.node === 'string' &&
  manifest.engines.node.length > 0, 'the manifest names no supported node version');

if (problems.length > 0) {
  console.error('this build is not shippable:');
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}

console.log(`release checks pass, ${sources} sources, ${declared} declarations`);
