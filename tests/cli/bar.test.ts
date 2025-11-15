import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness, type CliHarness } from '../support/cli.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

const P = ['--property', 'CANYON'];

function seeded(): { cli: CliHarness; slot: string } {
  const cli = cliHarness({ now: '2025-04-10T09:00:00.000Z' });
  cli.run('store', 'init');
  cli.run('demo', 'seed');
  const booking = cli.json<{ id: string }>(
    'booking',
    'create',
    ...P,
    '--post-as',
    'Fenwick Annual Symposium',
    '--arrival',
    '2025-04-17',
    '--departure',
    '2025-04-19',
    '--account',
    'FENWICK',
  ).id;
  const slot = cli.json<{ id: string }>(
    'function',
    'add',
    '--booking',
    booking,
    '--room',
    'GRAND-A',
    '--name',
    'Awards Dinner',
    '--date',
    '2025-04-18',
    '--start',
    '18:00',
    '--end',
    '23:00',
    '--setup',
    'ROUNDS-10',
    '--service',
    'PLATED',
    '--covers',
    '180',
  ).id;
  cli.run(
    'covers',
    'open',
    '--function',
    slot,
    '--contract',
    '2025-01-20',
    '--package',
    'PLATED-THREE',
    '--book',
    'RACK-2025',
  );
  cli.run('covers', 'guarantee', '--function', slot, '--covers', '180');
  cli.run(
    'bartier',
    'add',
    ...P,
    '--code',
    'HOUSE',
    '--name',
    'House bar',
    '--first',
    '18.00',
    '--extra',
    '12.00',
  );
  return { cli, slot };
}

describe('covercount bartier', () => {
  it('puts a tier on file and lists it', () => {
    const { cli } = seeded();
    const rows = cli.json<{ code: string; firstHour: string }[]>('bartier', 'list', ...P);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('HOUSE');
    expect(rows[0]?.firstHour).toBe('$18.00');
  });

  it('refuses an extra hour dearer than the first', () => {
    const { cli } = seeded();
    const result = cli.run(
      'bartier',
      'add',
      ...P,
      '--code',
      'X',
      '--name',
      'X',
      '--first',
      '10.00',
      '--extra',
      '12.00',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('nobody would buy');
  });
});

describe('covercount bar', () => {
  it('charges a package bar against the guarantee', () => {
    const { cli, slot } = seeded();
    cli.run(
      'bar',
      'set',
      '--function',
      slot,
      '--kind',
      'PACKAGE',
      '--tier',
      'HOUSE',
      '--hours',
      '4',
    );
    const record = cli.json<{ amount: string; covers: number }>('bar', 'show', '--function', slot);
    expect(record.covers).toBe(180);
    expect(record.amount).toBe('$9,720.00');
  });

  it('charges a consumption bar what came out of the bottles', () => {
    const { cli, slot } = seeded();
    cli.run('bar', 'set', '--function', slot, '--kind', 'CONSUMPTION');
    cli.run(
      'bar',
      'pour',
      '--function',
      slot,
      '--item',
      'HOUSE-RED',
      '--opening',
      '120',
      '--closing',
      '43',
      '--unit',
      '42.00',
    );
    const record = cli.json<{ amount: string; detail: string }>('bar', 'show', '--function', slot);
    expect(record.amount).toBe('$323.40');
    expect(record.detail).toContain('7.7 bottles');
    expect(cli.json<unknown[]>('bar', 'pours', '--function', slot)).toHaveLength(1);
  });

  it('refuses a bottle count on a package bar', () => {
    const { cli, slot } = seeded();
    cli.run(
      'bar',
      'set',
      '--function',
      slot,
      '--kind',
      'PACKAGE',
      '--tier',
      'HOUSE',
      '--hours',
      '4',
    );
    const result = cli.run(
      'bar',
      'pour',
      '--function',
      slot,
      '--item',
      'HOUSE-RED',
      '--opening',
      '10',
      '--closing',
      '0',
      '--unit',
      '42.00',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('nobody counts the bottles');
  });

  it('says so when a function has no bar on it', () => {
    const { cli, slot } = seeded();
    const result = cli.run('bar', 'show', '--function', slot);
    expect(result.code).toBe(1);
    expect(result.err).toContain('has no bar on it');
  });
});
