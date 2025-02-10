/**
 * Running the real command line in a test.
 *
 * Nothing is stubbed except the clock and the store path. The parser, the
 * commands, the store and the output rendering are the ones that ship.
 */

import { runCli } from '../../src/cli/program.js';
import { scratchStorePath } from './store.js';

export interface CliRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly lines: string[];
}

export interface CliHarness {
  readonly storePath: string;
  run: (...args: string[]) => CliRun;
  json: <T>(...args: string[]) => T;
}

export const CLI_NOW = '2025-03-03T15:00:00.000Z';

export function cliHarness(options: { storePath?: string; now?: string } = {}): CliHarness {
  const storePath = options.storePath ?? scratchStorePath();
  const now = options.now ?? CLI_NOW;

  const run = (...args: string[]): CliRun => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runCli(['--store', storePath, ...args], {
      env: {},
      now: () => now,
      write: (line) => out.push(line),
      writeError: (line) => err.push(line),
    });
    return {
      code,
      out: out.join('\n'),
      err: err.join('\n'),
      lines: out
        .join('\n')
        .split('\n')
        .filter((line) => line.length > 0),
    };
  };

  return {
    storePath,
    run,
    json: <T>(...args: string[]): T => {
      const result = run('--format', 'json', ...args);
      if (result.code !== 0) {
        throw new Error(`command failed with ${result.code}: ${result.err}`);
      }
      return JSON.parse(result.out) as T;
    },
  };
}
