import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness } from '../support/cli.js';
import { seedPropertyThroughCli, seedRoomsThroughCli } from '../support/cliSeed.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

describe('covercount property create', () => {
  it('puts a property on file and echoes its settings', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const result = cli.run(
      'property',
      'create',
      '--code',
      'CANYON',
      '--name',
      'Canyon Ridge Hotel',
      '--zone',
      'America/Denver',
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain('code           CANYON');
    expect(result.out).toContain('guaranteeDue   12:00');
    expect(result.out).toContain('overset        5%');
  });

  it('takes the guarantee settings off the command line', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const record = cli.json<Record<string, unknown>>(
      'property',
      'create',
      '--code',
      'CANYON',
      '--name',
      'Canyon Ridge Hotel',
      '--zone',
      'America/Denver',
      '--guarantee-lead',
      '5',
      '--guarantee-due',
      '10:30',
      '--overset',
      '7.5',
    );
    expect(record.guaranteeLead).toBe(5);
    expect(record.guaranteeDue).toBe('10:30');
    expect(record.overset).toBe('7.5%');
  });

  it('refuses a guarantee lead that is not a number', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const worse = cli.run(
      'property',
      'create',
      '--code',
      'X',
      '--name',
      'X',
      '--zone',
      'UTC',
      '--guarantee-lead',
      'three',
    );
    expect(worse.code).toBe(1);
    expect(worse.err).toContain('takes a whole number');
  });

  it('refuses a missing required option with exit code two', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const result = cli.run('property', 'create', '--code', 'X');
    expect(result.code).toBe(2);
    expect(result.err).toContain('required option');
  });
});

describe('covercount property list and show', () => {
  it('lists what is on file', () => {
    const cli = cliHarness();
    seedPropertyThroughCli(cli);
    const rows = cli.json<{ code: string; overset: number }[]>('property', 'list');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('CANYON');
    expect(rows[0]?.overset).toBe(5);
  });

  it('says so when there is nothing on file', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    expect(cli.run('property', 'list').out).toBe('no properties are on file');
  });

  it('shows one property with a room count', () => {
    const cli = cliHarness();
    seedPropertyThroughCli(cli);
    seedRoomsThroughCli(cli);
    const record = cli.json<{ rooms: number }>('property', 'show', '--property', 'CANYON');
    expect(record.rooms).toBe(3);
  });

  it('asks for a property when none is named', () => {
    const cli = cliHarness();
    seedPropertyThroughCli(cli);
    const result = cli.run('property', 'show');
    expect(result.code).toBe(1);
    expect(result.err).toContain('no property was named');
  });
});

describe('a refusal from the core reaches the command line as a refusal', () => {
  it('reports an unknown time zone with exit code one', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const result = cli.run(
      'property',
      'create',
      '--code',
      'X',
      '--name',
      'X',
      '--zone',
      'Middle/Earth',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('clock.invalid');
    expect(result.err).toContain('not a time zone');
  });

  it('reports a date that is not a date with exit code one', () => {
    const cli = cliHarness();
    seedPropertyThroughCli(cli);
    const result = cli.run(
      'calendar',
      'close',
      '--property',
      'CANYON',
      '--calendar',
      'office',
      '--date',
      '4th July',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('calendar.invalid');
  });

  it('reports a room code that is not a code with exit code one', () => {
    const cli = cliHarness();
    seedPropertyThroughCli(cli);
    const result = cli.run(
      'space',
      'add',
      '--property',
      'CANYON',
      '--code',
      'grand/a',
      '--name',
      'Grand',
      '--fire',
      '100',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('code.shape');
  });
});
