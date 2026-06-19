#!/usr/bin/env node
import { runCli } from './program.js';

/**
 * The environment the program actually runs in.
 *
 * Only the variables the command line reads are passed through, rather than
 * `process.env` whole. That is not tidiness: `runCli` takes an environment so
 * a test can hand it one, and a test that hands over the real environment
 * passes or fails depending on what happens to be exported on the machine
 * running it. Naming the four keeps the injection honest in both directions.
 */
const code = runCli(process.argv.slice(2), {
  env: {
    ...(process.env.COVERCOUNT_STORE === undefined
      ? {}
      : { COVERCOUNT_STORE: process.env.COVERCOUNT_STORE }),
    ...(process.env.COVERCOUNT_PROPERTY === undefined
      ? {}
      : { COVERCOUNT_PROPERTY: process.env.COVERCOUNT_PROPERTY }),
    ...(process.env.COVERCOUNT_FORMAT === undefined
      ? {}
      : { COVERCOUNT_FORMAT: process.env.COVERCOUNT_FORMAT }),
    ...(process.env.COVERCOUNT_ACTOR === undefined
      ? {}
      : { COVERCOUNT_ACTOR: process.env.COVERCOUNT_ACTOR }),
  },
});
process.exitCode = code;
