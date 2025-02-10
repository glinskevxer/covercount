import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { cliHarness } from '../support/cli.js';
import { cleanScratch } from '../support/store.js';
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
    const result = cli.run('--format', 'csv', 'store', 'migrations');
    expect(result.code).toBe(1);
    expect(result.err).toContain('not an output format');
  });
});
