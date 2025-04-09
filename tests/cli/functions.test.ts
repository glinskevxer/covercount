import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness, type CliHarness } from '../support/cli.js';
import {
  seedBookingThroughCli,
  seedCombinedRoomThroughCli,
  seedReceptionCapacityThroughCli,
  seedPropertyThroughCli,
  seedRoomsThroughCli,
} from '../support/cliSeed.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

const P = ['--property', 'CANYON'];

function seeded(): { cli: CliHarness; booking: string } {
  const cli = cliHarness();
  seedPropertyThroughCli(cli);
  seedRoomsThroughCli(cli);
  seedCombinedRoomThroughCli(cli);
  seedReceptionCapacityThroughCli(cli);
  return { cli, booking: seedBookingThroughCli(cli) };
}

function addDinner(cli: CliHarness, booking: string, overrides: string[] = []): string {
  const record = cli.json<{ id: string }>(
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
    ...overrides,
  );
  return record.id;
}

describe('covercount function add', () => {
  it('puts a function in a room as a hold', () => {
    const { cli, booking } = seeded();
    const record = cli.json<Record<string, string | number>>(
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
    );
    expect(record.id).toBe('FN-2025-0001');
    expect(record.status).toBe('HELD');
    expect(record.start).toBe(1080);
    expect(record.end).toBe(1380);
  });

  it('takes a function that runs past midnight', () => {
    const { cli, booking } = seeded();
    const record = cli.json<{ end: number }>(
      'function',
      'add',
      '--booking',
      booking,
      '--room',
      'GRAND-A',
      '--name',
      'Late Reception',
      '--date',
      '2025-04-18',
      '--start',
      '20:00',
      '--end',
      '25:30',
      '--setup',
      'RECEPTION',
      '--service',
      'RECEPTION',
      '--covers',
      '200',
    );
    expect(record.end).toBe(1530);
  });

  it('refuses a start that is not a time', () => {
    const { cli, booking } = seeded();
    const result = cli.run(
      'function',
      'add',
      '--booking',
      booking,
      '--room',
      'GRAND-A',
      '--name',
      'X',
      '--date',
      '2025-04-18',
      '--start',
      'sixish',
      '--end',
      '23:00',
      '--setup',
      'ROUNDS-10',
      '--service',
      'PLATED',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('takes a time in HH:MM form');
  });

  it('refuses a room that will not hold the covers', () => {
    const { cli, booking } = seeded();
    const result = cli.run(
      'function',
      'add',
      '--booking',
      booking,
      '--room',
      'ASPEN',
      '--name',
      'X',
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
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('over the fire capacity of 80');
  });
});

describe('covercount diary', () => {
  it('shows the function board for a date', () => {
    const { cli, booking } = seeded();
    addDinner(cli, booking);
    const rows = cli.json<{ room: string; name: string }[]>(
      'diary',
      'day',
      ...P,
      '--date',
      '2025-04-18',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.room).toBe('GRAND-A');
    expect(rows[0]?.name).toBe('Awards Dinner');
  });

  it('says the room is free when nothing clashes', () => {
    const { cli } = seeded();
    const result = cli.run(
      'diary',
      'check',
      ...P,
      '--room',
      'GRAND-A',
      '--date',
      '2025-04-18',
      '--start',
      '18:00',
      '--end',
      '23:00',
    );
    expect(result.out).toBe('that room is free');
  });

  it('reports the combined room clashing with a half already booked', () => {
    const { cli, booking } = seeded();
    addDinner(cli, booking);
    const rows = cli.json<{ shares: string }[]>(
      'diary',
      'check',
      ...P,
      '--room',
      'GRAND',
      '--date',
      '2025-04-18',
      '--start',
      '18:00',
      '--end',
      '23:00',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.shares).toBe('GRAND-A');
  });

  it('refuses to book on top of an existing function', () => {
    const { cli, booking } = seeded();
    addDinner(cli, booking);
    const result = cli.run(
      'function',
      'add',
      '--booking',
      booking,
      '--room',
      'GRAND',
      '--name',
      'Whole Room',
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
      '300',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('is already taken by FN-2025-0001');
  });
});

describe('covercount slot', () => {
  it('moves a function and reports the new block', () => {
    const { cli, booking } = seeded();
    const id = addDinner(cli, booking);
    const record = cli.json<{ start: number; room: string }>(
      'slot',
      'move',
      '--id',
      id,
      '--start',
      '19:00',
      '--room',
      'GRAND-B',
    );
    expect(record.start).toBe(1140);
    expect(record.room).toBe('GRAND-B');
  });

  it('moves a function status and refuses one it does not know', () => {
    const { cli, booking } = seeded();
    const id = addDinner(cli, booking);
    expect(
      cli.json<{ status: string }>('slot', 'status', '--id', id, '--to', 'definite').status,
    ).toBe('DEFINITE');
    const bad = cli.run('slot', 'status', '--id', id, '--to', 'pending');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('not a function status');
  });

  it('shows one function', () => {
    const { cli, booking } = seeded();
    const id = addDinner(cli, booking);
    const record = cli.json<{ name: string; covers: number }>('slot', 'show', '--id', id);
    expect(record.name).toBe('Awards Dinner');
    expect(record.covers).toBe(180);
  });
});
