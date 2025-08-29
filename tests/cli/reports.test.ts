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
  cli.run('covers', 'guarantee', '--function', slot, '--covers', '180');
  return { cli, slot };
}

describe('covercount sheet board', () => {
  it('prints the day with the covers on it', () => {
    const { cli } = seeded();
    const result = cli.run('sheet', 'board', ...P, '--date', '2025-04-18');
    expect(result.code).toBe(0);
    expect(result.out).toContain('FUNCTION BOARD  Fri 18 Apr 2025');
    expect(result.out).toContain('Grand Ballroom A');
    expect(result.out).toContain('180 covers in the building');
  });

  it('gives the rows as JSON', () => {
    const { cli, slot } = seeded();
    const board = cli.json<{ rows: { functionId: string; setFor: number }[] }>(
      'sheet',
      'board',
      ...P,
      '--date',
      '2025-04-18',
    );
    expect(board.rows[0]?.functionId).toBe(slot);
    expect(board.rows[0]?.setFor).toBe(189);
  });

  it('says so on an empty day', () => {
    const { cli } = seeded();
    expect(cli.run('sheet', 'board', ...P, '--date', '2025-04-20').out).toContain(
      'nothing is in the diary',
    );
  });

  it('refuses a date that is not one', () => {
    const { cli } = seeded();
    const result = cli.run('sheet', 'board', ...P, '--date', 'Friday');
    expect(result.code).toBe(1);
    expect(result.err).toContain('YYYY-MM-DD');
  });
});

describe('covercount sheet reader', () => {
  it('shows nothing until the function is definite', () => {
    const { cli, slot } = seeded();
    expect(cli.run('sheet', 'reader', ...P, '--date', '2025-04-18').out).toBe('no functions today');
    cli.run('slot', 'status', '--id', slot, '--to', 'DEFINITE');
    const out = cli.run('sheet', 'reader', ...P, '--date', '2025-04-18').out;
    expect(out).toContain('Fenwick Annual Symposium');
    expect(out).not.toContain('180');
  });
});

describe('covercount sheet staffing', () => {
  it('says so when nobody is called in', () => {
    const { cli } = seeded();
    expect(cli.run('sheet', 'staffing', ...P, '--date', '2025-04-18').out).toContain(
      'nobody is called in',
    );
  });
});

describe('covercount sheet pick', () => {
  it('says so when there is nothing to pick', () => {
    const { cli } = seeded();
    const out = cli.run('sheet', 'pick', ...P, '--date', '2025-04-18').out;
    expect(out).toContain('PICK LIST');
    expect(out).toContain('nothing to pick');
    expect(cli.run('sheet', 'trips', ...P, '--date', '2025-04-18').out).toBe('nothing to pick');
  });
});
