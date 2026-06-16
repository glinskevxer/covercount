import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { cliHarness } from '../support/cli.js';
import { cleanScratch, scratchDirectory } from '../support/store.js';
import { TARGET_SCHEMA_VERSION } from '../../src/store/schema.js';

afterEach(cleanScratch);

describe('covercount store init', () => {
  it('creates the file and reports the version', () => {
    const cli = cliHarness();
    expect(existsSync(cli.storePath)).toBe(false);
    const result = cli.run('store', 'init');
    expect(result.code).toBe(0);
    expect(existsSync(cli.storePath)).toBe(true);
    expect(result.out).toContain(`version  ${TARGET_SCHEMA_VERSION}`);
  });

  it('is safe to run twice', () => {
    const cli = cliHarness();
    expect(cli.run('store', 'init').code).toBe(0);
    expect(cli.run('store', 'init').code).toBe(0);
  });

  it('reports as JSON when asked', () => {
    const cli = cliHarness();
    const record = cli.json<{ version: number; tables: number }>('store', 'init');
    expect(record.version).toBe(TARGET_SCHEMA_VERSION);
    expect(record.tables).toBeGreaterThan(5);
  });
});

describe('covercount store status', () => {
  it('lists what has been applied', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const rows = cli.json<{ id: number; name: string }[]>('store', 'status');
    expect(rows).toHaveLength(TARGET_SCHEMA_VERSION);
    expect(rows[0]?.name).toBe('property and spaces');
  });

  it('prints a table by default', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const result = cli.run('store', 'status');
    expect(result.lines[0]).toMatch(/^id\s+name\s+checksum\s+applied$/);
  });

  it('fails cleanly against a store that is not there', () => {
    const cli = cliHarness();
    const result = cli.run('store', 'status');
    expect(result.code).toBe(1);
    expect(result.err).toContain('there is no store at');
  });
});

describe('covercount store migrations', () => {
  it('lists what the build carries without opening a store', () => {
    const cli = cliHarness();
    const rows = cli.json<{ id: number; target: boolean }[]>('store', 'migrations');
    expect(rows).toHaveLength(TARGET_SCHEMA_VERSION);
    expect(rows.at(-1)?.target).toBe(true);
    expect(rows[0]?.target).toBe(TARGET_SCHEMA_VERSION === 1);
    expect(existsSync(cli.storePath)).toBe(false);
  });
});

describe('the program itself', () => {
  it('prints help and exits clean', () => {
    const cli = cliHarness();
    const result = cli.run('--help');
    expect(result.code).toBe(0);
    expect(result.out).toContain('banquet event orders');
    expect(result.out).toContain('store');
  });

  it('prints its version', () => {
    const cli = cliHarness();
    const result = cli.run('--version');
    expect(result.code).toBe(0);
    expect(result.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('refuses an unknown command with exit code two', () => {
    const cli = cliHarness();
    const result = cli.run('nonsense');
    expect(result.code).toBe(2);
    expect(result.err).toContain('unknown command');
  });

  it('refuses an output format it does not have', () => {
    const cli = cliHarness();
    const result = cli.run('--format', 'xml', 'store', 'migrations');
    expect(result.code).toBe(1);
    expect(result.err).toContain('not an output format');
  });

  it('prints the migration list as a spreadsheet', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const result = cli.run('--format', 'csv', 'store', 'migrations');
    expect(result.code).toBe(0);
    expect(result.lines[0]).toContain('id,name');
    expect(result.lines.length).toBeGreaterThan(20);
  });
});

describe('covercount store health', () => {
  it('reports a clean store', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const health = cli.json<{
      integrity: string;
      referenceProblems: string[];
      tables: number;
      pages: { bytes: number };
      biggest: { table: string; rows: number }[];
    }>('store', 'health');
    expect(health.integrity).toBe('ok');
    expect(health.referenceProblems).toEqual([]);
    expect(health.tables).toBeGreaterThan(20);
    expect(health.pages.bytes).toBeGreaterThan(0);
    expect(health.biggest[0]?.table).toBe('schema_migration');
  });

  it('compacts and says how much it handed back', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    cli.run('demo', 'seed');
    const result = cli.json<{ before: number; after: number; freed: number }>('store', 'compact');
    expect(result.before).toBeGreaterThan(0);
    expect(result.after).toBeGreaterThan(0);
    expect(result.freed).toBeGreaterThanOrEqual(0);
    expect(cli.json<{ integrity: string }>('store', 'health').integrity).toBe('ok');
  });

  it('refreshes the planner statistics', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    cli.run('demo', 'seed');
    expect(cli.json<{ statistics: number }>('store', 'analyse').statistics).toBe(1);
  });
});

describe('where the store file goes', () => {
  it('creates the directory it is pointed at', () => {
    const cli = cliHarness();
    const buried = join(scratchDirectory(), 'season', '2026', 'property.covercount.db');
    const result = cli.runAt(buried, 'store', 'init');
    expect(result.code).toBe(0);
    expect(existsSync(buried)).toBe(true);
  });

  it('refuses to read a store that is not there rather than making one', () => {
    const cli = cliHarness();
    const missing = join(scratchDirectory(), 'nothing.covercount.db');
    const result = cli.runAt(missing, 'store', 'health');
    // Exit 3 is this program saying it has a bug. A store that is not there
    // is not one, and the difference decides whether an operator reads the
    // message or opens a ticket.
    expect(result.code).toBe(1);
    expect(result.err).toContain('there is no store at');
    expect(existsSync(missing)).toBe(false);
  });
});
