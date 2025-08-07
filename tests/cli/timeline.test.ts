import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness, type CliHarness } from '../support/cli.js';
import {
  seedBookingThroughCli,
  seedPropertyThroughCli,
  seedRoomsThroughCli,
  seedRunSheetThroughCli,
} from '../support/cliSeed.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

const P = ['--property', 'CANYON'];

function seeded(): { cli: CliHarness; slot: string } {
  const cli = cliHarness({ now: '2025-04-10T09:00:00.000Z' });
  seedPropertyThroughCli(cli);
  seedRoomsThroughCli(cli);
  seedRunSheetThroughCli(cli);
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

describe('covercount runsheet', () => {
  it('puts a template on file and prints it in sequence', () => {
    const { cli } = seeded();
    const rows = cli.json<{ sequence: number; label: string }[]>(
      'runsheet',
      'show',
      ...P,
      '--style',
      'PLATED',
    );
    expect(rows).toHaveLength(6);
    expect(rows[0]?.label).toBe('crew in, room set');
  });

  it('says so for a style with no template', () => {
    const { cli } = seeded();
    expect(cli.run('runsheet', 'show', ...P, '--style', 'BUFFET').out).toBe(
      'that style carries no template',
    );
  });

  it('refuses a style or anchor it does not know', () => {
    const { cli } = seeded();
    const bad = cli.run('runsheet', 'show', ...P, '--style', 'TAPAS');
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('not a service style');
  });
});

describe('covercount timeline', () => {
  it('reports the anchors off the function and the room', () => {
    const { cli, slot } = seeded();
    const anchors = cli.json<Record<string, number>>('timeline', 'anchors', '--function', slot);
    expect(anchors.DOORS).toBe(1080);
    expect(anchors.SETUP).toBe(960);
    expect(anchors.TEARDOWN).toBe(1440);
  });

  it('previews the run of show without saving it', () => {
    const { cli, slot } = seeded();
    const result = cli.run('timeline', 'preview', '--function', slot);
    expect(result.out).toContain('plate up starts');
    expect(cli.run('timeline', 'show', '--function', slot).out).toBe('no run of show');
  });

  it('pulls the plate up earlier as the count rises', () => {
    const { cli, slot } = seeded();
    const at180 = cli.json<{ label: string; minute: number }[]>(
      'timeline',
      'preview',
      '--function',
      slot,
    );
    expect(at180.find((row) => row.label === 'plate up starts')?.minute).toBe(1110 - 63);

    const at60 = cli.json<{ label: string; minute: number }[]>(
      'timeline',
      'preview',
      '--function',
      slot,
      '--covers',
      '60',
    );
    expect(at60.find((row) => row.label === 'plate up starts')?.minute).toBe(1110 - 20);
  });

  it('saves it and keeps a pinned step through a redraw', () => {
    const { cli, slot } = seeded();
    cli.run('timeline', 'save', '--function', slot);
    cli.run('timeline', 'pin', '--function', slot, '--sequence', '3', '--minute', '1000');
    cli.run('covers', 'guarantee', '--function', slot, '--covers', '190');
    const steps = cli.json<{ sequence: number; minute: number; pinned: boolean }[]>(
      'timeline',
      'save',
      '--function',
      slot,
    );
    const pinned = steps.find((row) => row.sequence === 3);
    expect(pinned?.minute).toBe(1000);
    expect(pinned?.pinned).toBe(true);
  });

  it('lets a pin go again', () => {
    const { cli, slot } = seeded();
    cli.run('timeline', 'save', '--function', slot);
    cli.run('timeline', 'pin', '--function', slot, '--sequence', '3', '--minute', '1000');
    cli.run('timeline', 'unpin', '--function', slot, '--sequence', '3');
    const steps = cli.json<{ sequence: number; minute: number }[]>(
      'timeline',
      'save',
      '--function',
      slot,
    );
    expect(steps.find((row) => row.sequence === 3)?.minute).toBe(1110 - 63);
  });
});
