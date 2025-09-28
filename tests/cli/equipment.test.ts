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
  cli.run(
    'kit',
    'add',
    ...P,
    '--code',
    'ROUND-72',
    '--name',
    '72 inch round',
    '--kind',
    'TABLE',
    '--owned',
    '40',
  );
  cli.run(
    'kit',
    'add',
    ...P,
    '--code',
    'BANQUET-CHAIR',
    '--name',
    'Banquet chair',
    '--kind',
    'SEATING',
    '--owned',
    '400',
  );
  cli.run(
    'kit',
    'add',
    ...P,
    '--code',
    'PLACE-SETTING',
    '--name',
    'Place setting',
    '--kind',
    'CHINA',
    '--owned',
    '150',
    '--rental',
    '2.75',
  );
  cli.run('kit', 'rule', ...P, '--style', 'ROUNDS-10', '--item', 'ROUND-72', '--per-table', '1');
  cli.run(
    'kit',
    'rule',
    ...P,
    '--style',
    'ROUNDS-10',
    '--item',
    'BANQUET-CHAIR',
    '--per-cover',
    '1',
  );
  cli.run(
    'kit',
    'rule',
    ...P,
    '--style',
    'ROUNDS-10',
    '--item',
    'PLACE-SETTING',
    '--per-cover',
    '1',
  );

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

describe('covercount kit', () => {
  it('lists the cupboard', () => {
    const { cli } = seeded();
    const rows = cli.json<{ code: string; owned: number }[]>('kit', 'list', ...P);
    expect(rows.map((row) => row.code)).toEqual(['BANQUET-CHAIR', 'PLACE-SETTING', 'ROUND-72']);
    expect(rows.find((row) => row.code === 'ROUND-72')?.owned).toBe(40);
  });

  it('lists what a style pulls and says so for one that pulls nothing', () => {
    const { cli } = seeded();
    expect(cli.json<unknown[]>('kit', 'rules', ...P, '--style', 'ROUNDS-10')).toHaveLength(3);
    expect(cli.run('kit', 'rules', ...P, '--style', 'THEATER').out).toBe(
      'that style pulls nothing',
    );
  });

  it('refuses a rule that would pull nothing', () => {
    const { cli } = seeded();
    const result = cli.run('kit', 'rule', ...P, '--style', 'ROUNDS-10', '--item', 'ROUND-72');
    expect(result.code).toBe(1);
    expect(result.err).toContain('would never be pulled');
  });
});

describe('covercount pull', () => {
  it('works the sheet out off the covers the room is set for', () => {
    const { cli, slot } = seeded();
    const rows = cli.json<{ item: string; need: number; hire: number }[]>(
      'pull',
      'sheet',
      '--function',
      slot,
    );
    expect(rows.find((row) => row.item === 'ROUND-72')?.need).toBe(19);
    expect(rows.find((row) => row.item === 'BANQUET-CHAIR')?.need).toBe(189);
    const settings = rows.find((row) => row.item === 'PLACE-SETTING');
    expect(settings?.need).toBe(189);
    expect(settings?.hire).toBe(39);
  });

  it('prices the hire', () => {
    const { cli, slot } = seeded();
    const rows = cli.json<{ item: string; hireCost: string }[]>(
      'pull',
      'sheet',
      '--function',
      slot,
    );
    expect(rows.find((row) => row.item === 'PLACE-SETTING')?.hireCost).toBe('$107.25');
    expect(rows.find((row) => row.item === 'ROUND-72')?.hireCost).toBe('$0.00');
  });

  it('takes an override count', () => {
    const { cli, slot } = seeded();
    const rows = cli.json<{ item: string; need: number }[]>(
      'pull',
      'sheet',
      '--function',
      slot,
      '--covers',
      '40',
    );
    expect(rows.find((row) => row.item === 'ROUND-72')?.need).toBe(4);
  });

  it('counts tables for a style directly', () => {
    const { cli } = seeded();
    const record = cli.json<{ tables: number }>(
      'pull',
      'tables',
      '--style',
      'ROUNDS-10',
      '--covers',
      '181',
    );
    expect(record.tables).toBe(19);
  });
});
