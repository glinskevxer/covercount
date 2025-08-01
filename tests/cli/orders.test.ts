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
  cli.run('covers', 'guarantee', '--function', slot, '--covers', '180');
  return { cli, slot };
}

describe('covercount order preview', () => {
  it('prints the sheet without freezing anything', () => {
    const { cli, slot } = seeded();
    const result = cli.run('order', 'preview', '--function', slot);
    expect(result.code).toBe(0);
    expect(result.out).toContain('BANQUET EVENT ORDER');
    expect(result.out).toContain('180 standard plates, room set for 189');
    expect(cli.run('order', 'list', '--function', slot).out).toBe('no sheet has been drawn yet');
  });

  it('prints it as JSON when asked', () => {
    const { cli, slot } = seeded();
    const order = cli.json<{ covers: { guaranteed: number } }>(
      'order',
      'preview',
      '--function',
      slot,
    );
    expect(order.covers.guaranteed).toBe(180);
  });
});

describe('covercount order draw and sign', () => {
  it('draws a revision, numbers it and lists it', () => {
    const { cli, slot } = seeded();
    const drawn = cli.json<{ id: string; revision: number; status: string }>(
      'order',
      'draw',
      '--function',
      slot,
      '--note',
      'first pass',
    );
    expect(drawn.revision).toBe(0);
    expect(drawn.status).toBe('DRAFT');
    const rows = cli.json<{ id: string }[]>('order', 'list', '--function', slot);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(drawn.id);
  });

  it('refuses to distribute a sheet with warnings on it', () => {
    const { cli, slot } = seeded();
    const drawn = cli.json<{ id: string }>('order', 'draw', '--function', slot);
    const result = cli.run('order', 'distribute', '--id', drawn.id);
    expect(result.code).toBe(1);
    expect(result.err).toContain('still carries');
  });

  it('reports drift once the guarantee moves', () => {
    const { cli, slot } = seeded();
    cli.run('order', 'draw', '--function', slot);
    expect(cli.run('order', 'drift', '--function', slot).out).toContain('is still current');
    cli.run('covers', 'guarantee', '--function', slot, '--covers', '190');
    const drift = cli.json<{ field: string; was: string; becomes: string }[]>(
      'order',
      'drift',
      '--function',
      slot,
    );
    expect(drift.find((row) => row.field === 'guaranteed')).toEqual({
      field: 'guaranteed',
      was: '180',
      becomes: '190',
    });
  });

  it('says so when nothing has been drawn', () => {
    const { cli, slot } = seeded();
    expect(cli.run('order', 'drift', '--function', slot).out).toBe('no sheet has been drawn yet');
  });
});

describe('covercount change', () => {
  it('raises a change order off the drift', () => {
    const { cli, slot } = seeded();
    cli.run('order', 'draw', '--function', slot);
    cli.run('covers', 'guarantee', '--function', slot, '--covers', '190');
    const raised = cli.json<{ id: string; afterCutoff: boolean; fee: string }>(
      'change',
      'raise',
      '--function',
      slot,
      '--reason',
      'two coaches confirmed',
    );
    expect(raised.id).toBe('CO-2025-0001');
    expect(raised.afterCutoff).toBe(false);
    expect(raised.fee).toBe('$0.00');
  });

  it('refuses a fee before the cutoff and takes one after it', () => {
    const { cli, slot } = seeded();
    cli.run('order', 'draw', '--function', slot);
    cli.run('covers', 'guarantee', '--function', slot, '--covers', '190');
    const early = cli.run(
      'change',
      'raise',
      '--function',
      slot,
      '--reason',
      'x',
      '--fee',
      '250.00',
    );
    expect(early.code).toBe(1);
    expect(early.err).toContain('cannot carry a late fee');

    const late = cliHarness({ storePath: cli.storePath, now: '2025-04-17T09:00:00.000Z' });
    const raised = late.json<{ afterCutoff: boolean; fee: string }>(
      'change',
      'raise',
      '--function',
      slot,
      '--reason',
      'late coaches',
      '--fee',
      '250.00',
    );
    expect(raised.afterCutoff).toBe(true);
    expect(raised.fee).toBe('$250.00');
  });

  it('says so when nothing has changed', () => {
    const { cli, slot } = seeded();
    cli.run('order', 'draw', '--function', slot);
    const result = cli.run('change', 'raise', '--function', slot, '--reason', 'x');
    expect(result.code).toBe(1);
    expect(result.err).toContain('nothing has moved on');
  });
});
