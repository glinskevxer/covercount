/**
 * What every command needs before it can do anything.
 *
 * The store path, the property being worked on, the clock, and where output
 * goes. Holding them in one object rather than reaching for process.env inside
 * commands is what lets the command tests run the real commands against a
 * scratch file with a frozen clock.
 */

import { invalidInput } from '../core/errors.js';
import { catalogCode, type CatalogCode } from '../core/ids.js';
import { closeDatabase, type Database } from '../store/database.js';
import { openStore } from '../store/schema.js';
import { isOutputFormat, type OutputFormat } from './output.js';

export interface CliEnvironment {
  readonly COVERCOUNT_STORE?: string | undefined;
  readonly COVERCOUNT_PROPERTY?: string | undefined;
  readonly COVERCOUNT_FORMAT?: string | undefined;
  readonly COVERCOUNT_ACTOR?: string | undefined;
}

export interface CliOptions {
  readonly store?: string;
  readonly property?: string;
  readonly format?: string;
  readonly actor?: string;
}

export interface CliContext {
  readonly storePath: string;
  readonly format: OutputFormat;
  readonly actor: string;
  readonly now: () => string;
  readonly write: (line: string) => void;
  readonly writeError: (line: string) => void;
  openStore: (options?: { readOnly?: boolean }) => Database;
  requireProperty: () => CatalogCode;
}

export interface BuildContextInput {
  readonly options: CliOptions;
  readonly env?: CliEnvironment;
  readonly now?: () => string;
  readonly write?: (line: string) => void;
  readonly writeError?: (line: string) => void;
}

export const DEFAULT_STORE = 'covercount.db';

export function buildContext(input: BuildContextInput): CliContext {
  const env = input.env ?? {};
  const storePath = input.options.store ?? env.COVERCOUNT_STORE ?? DEFAULT_STORE;

  const formatText = input.options.format ?? env.COVERCOUNT_FORMAT ?? 'table';
  if (!isOutputFormat(formatText)) {
    throw invalidInput(
      'cli.format',
      `${formatText} is not an output format, use table, plain or json`,
    );
  }

  const propertyText = input.options.property ?? env.COVERCOUNT_PROPERTY;

  return {
    storePath,
    format: formatText,
    actor: (input.options.actor ?? env.COVERCOUNT_ACTOR ?? 'system').trim() || 'system',
    now: input.now ?? (() => new Date().toISOString()),
    write: input.write ?? ((line) => process.stdout.write(`${line}\n`)),
    writeError: input.writeError ?? ((line) => process.stderr.write(`${line}\n`)),
    openStore: (options = {}) => openStore(storePath, options),
    requireProperty: () => {
      if (propertyText === undefined || propertyText.trim().length === 0) {
        throw invalidInput(
          'cli.property',
          'no property was named, pass --property or set COVERCOUNT_PROPERTY',
        );
      }
      return catalogCode(propertyText);
    },
  };
}

/** Open the store, run the work, and close it whatever happens. */
export function withOpenStore<T>(
  context: CliContext,
  work: (db: Database) => T,
  options: { readOnly?: boolean } = {},
): T {
  const db = context.openStore(options);
  try {
    return work(db);
  } finally {
    closeDatabase(db);
  }
}
