import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness, type CliHarness } from '../support/cli.js';
import {
  seedBookingThroughCli,
  seedPropertyThroughCli,
  seedRoomsThroughCli,
} from '../support/cliSeed.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

const P = ['--property', 'CANYON'];

function seeded(): { cli: CliHarness; booking: string; slot: string } {
  const cli = cliHarness({ now: '2025-04-10T09:00:00.000Z' });
  seedPropertyThroughCli(cli);
  seedRoomsThroughCli(cli);
  const booking = seedBookingThroughCli(cli);
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
  cli.run('covers', 'open', '--function', slot, '--contract', '2025-01-20');
  cli.run('covers', 'guarantee', '--function', slot, '--covers', '180');
  cli.run('tax', 'profile', ...P, '--code', 'DENVER', '--name', 'Denver County', '--service', '22');
  cli.run('tax', 'rate', ...P, '--profile', 'DENVER', '--category', 'FOOD', '--percent', '8.81');
  cli.run('tax', 'rate', ...P, '--profile', 'DENVER', '--category', 'SERVICE', '--percent', '8.81');
  return { cli, booking, slot };
}

describe('covercount tax', () => {
  it('puts a profile on file and echoes the rates', () => {
    const { cli } = seeded();
    const rows = cli.json<{ code: string; service: string; serviceTaxable: boolean }[]>(
      'tax',
      'list',
      ...P,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe('DENVER');
    expect(rows[0]?.service).toBe('22%');
    expect(rows[0]?.serviceTaxable).toBe(true);
  });

  it('takes a profile whose service charge is not taxable', () => {
    const { cli } = seeded();
    const record = cli.json<{ serviceTaxable: boolean }>(
      'tax',
      'profile',
      ...P,
      '--code',
      'OFFSITE',
      '--name',
      'Off site',
      '--service',
      '20',
      '--service-untaxed',
    );
    expect(record.serviceTaxable).toBe(false);
  });

  it('refuses a percentage that is not one', () => {
    const { cli } = seeded();
    const result = cli.run(
      'tax',
      'profile',
      ...P,
      '--code',
      'X',
      '--name',
      'X',
      '--service',
      'lots',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('takes a percentage');
  });
});

describe('covercount charge', () => {
  it('adds a line and totals it', () => {
    const { cli, slot } = seeded();
    const record = cli.json<Record<string, string | number>>(
      'charge',
      'add',
      '--function',
      slot,
      '--category',
      'AV',
      '--description',
      'Projection screen',
      '--quantity',
      '2',
      '--unit',
      '225.00',
    );
    expect(record.total).toBe('$450.00');
    expect(record.serviceable).toBe(false);
  });

  it('lists the lines on a function', () => {
    const { cli, slot } = seeded();
    cli.run(
      'charge',
      'add',
      '--function',
      slot,
      '--category',
      'FEE',
      '--description',
      'Cake cutting',
      '--quantity',
      '180',
      '--unit',
      '3.00',
    );
    const rows = cli.json<{ description: string }[]>('charge', 'list', '--function', slot);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.description).toBe('Cake cutting');
  });

  it('says so when a function carries nothing', () => {
    const { cli, slot } = seeded();
    expect(cli.run('charge', 'list', '--function', slot).out).toBe(
      'nothing is on that function yet',
    );
  });
});
