import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness, type CliHarness } from '../support/cli.js';
import {
  seedBookingThroughCli,
  seedPropertyThroughCli,
  seedRoomsThroughCli,
} from '../support/cliSeed.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

function seeded(): { cli: CliHarness; slot: string } {
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
  return { cli, slot };
}

describe('covercount covers', () => {
  it('opens a count and works out the deadline', () => {
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
    const record = cli.json<Record<string, string>>(
      'covers',
      'open',
      '--function',
      slot,
      '--contract',
      '2025-01-20',
    );
    expect(record.guaranteeDue).toBe('2025-04-15 12:00 America/Denver');
  });

  it('sets a guarantee and reports what the room is set for', () => {
    const { cli, slot } = seeded();
    const record = cli.json<Record<string, number | string>>(
      'covers',
      'guarantee',
      '--function',
      slot,
      '--covers',
      '180',
    );
    expect(record.guaranteed).toBe(180);
    expect(record.setFor).toBe(189);
  });

  it('refuses to lower the guarantee after the deadline', () => {
    const { cli, slot } = seeded();
    cli.run('covers', 'guarantee', '--function', slot, '--covers', '180');
    const late = cliHarness({ storePath: cli.storePath, now: '2025-04-17T09:00:00.000Z' });
    const result = late.run('covers', 'guarantee', '--function', slot, '--covers', '170');
    expect(result.code).toBe(1);
    expect(result.err).toContain('cannot be lowered from 180 to 170');
    expect(result.err).toContain('hint: raise it instead');
  });

  it('lets the guarantee be raised after the deadline', () => {
    const { cli, slot } = seeded();
    cli.run('covers', 'guarantee', '--function', slot, '--covers', '180');
    const late = cliHarness({ storePath: cli.storePath, now: '2025-04-17T09:00:00.000Z' });
    const record = late.json<{ guaranteed: number }>(
      'covers',
      'guarantee',
      '--function',
      slot,
      '--covers',
      '186',
    );
    expect(record.guaranteed).toBe(186);
  });

  it('records what was served and reconciles it', () => {
    const { cli, slot } = seeded();
    cli.run('covers', 'guarantee', '--function', slot, '--covers', '180');
    const record = cli.json<Record<string, number>>(
      'covers',
      'served',
      '--function',
      slot,
      '--covers',
      '172',
    );
    expect(record.billed).toBe(180);
    expect(record.shortfall).toBe(8);
    expect(record.overage).toBe(0);
  });
});
