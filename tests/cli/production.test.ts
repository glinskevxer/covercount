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
  return { cli, slot };
}

function splitEverything(cli: CliHarness, slot: string, covers = 180): void {
  cli.run(
    'split',
    'set',
    '--function',
    slot,
    '--course',
    'STARTER',
    '--covers',
    `BEET-TART:${covers}`,
  );
  cli.run(
    'split',
    'set',
    '--function',
    slot,
    '--course',
    'MAIN',
    '--covers',
    `SHORT-RIB:${Math.ceil(covers * 0.6)},HALIBUT:${covers - Math.ceil(covers * 0.6)}`,
  );
  cli.run(
    'split',
    'set',
    '--function',
    slot,
    '--course',
    'DESSERT',
    '--covers',
    `SORBET:${covers}`,
  );
}

describe('covercount split', () => {
  it('takes a split as item and count pairs', () => {
    const { cli, slot } = seeded();
    const rows = cli.json<{ item: string; covers: number }[]>(
      'split',
      'set',
      '--function',
      slot,
      '--course',
      'MAIN',
      '--covers',
      'SHORT-RIB:110,HALIBUT:70',
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.item === 'SHORT-RIB')?.covers).toBe(110);
  });

  it('refuses a pair that is not one', () => {
    const { cli, slot } = seeded();
    const result = cli.run(
      'split',
      'set',
      '--function',
      slot,
      '--course',
      'MAIN',
      '--covers',
      'SHORT-RIB',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('write it as ITEM:120');
  });

  it('reports a course that does not add up on standard error', () => {
    const { cli, slot } = seeded();
    cli.run('split', 'set', '--function', slot, '--course', 'MAIN', '--covers', 'SHORT-RIB:100');
    const result = cli.run('split', 'show', '--function', slot);
    expect(result.err).toContain('the MAIN split adds to 100 against 180 standard covers');
  });

  it('clears every split at once', () => {
    const { cli, slot } = seeded();
    splitEverything(cli, slot);
    expect(cli.json<{ removed: number }>('split', 'clear', '--function', slot).removed).toBe(4);
    expect(cli.run('split', 'show', '--function', slot).out).toBe('nothing has been split yet');
  });
});

describe('covercount kitchen', () => {
  it('turns the split into plates, batches and stores', () => {
    const { cli, slot } = seeded();
    splitEverything(cli, slot);

    const plates = cli.json<{ item: string; plates: number }[]>(
      'kitchen',
      'plates',
      '--function',
      slot,
    );
    expect(plates.find((row) => row.item === 'SHORT-RIB')?.plates).toBe(108);

    const batches = cli.json<{ recipe: string; batches: number }[]>(
      'kitchen',
      'batches',
      '--function',
      slot,
    );
    expect(batches.find((row) => row.recipe === 'BRAISED-SHORT-RIB')?.batches).toBe(6);

    const stores = cli.json<{ item: string; packs: number }[]>(
      'kitchen',
      'stores',
      '--function',
      slot,
    );
    expect(stores.find((row) => row.item === 'SHORT-RIB')?.packs).toBe(4);
  });

  it('says so before anything is split', () => {
    const { cli, slot } = seeded();
    expect(cli.run('kitchen', 'plates', '--function', slot).out).toBe('nothing has been split yet');
  });
});

describe('covercount req', () => {
  it('raises a requisition and moves it along', () => {
    const { cli, slot } = seeded();
    splitEverything(cli, slot);
    const raised = cli.json<{ id: string; packs: number; status: string }>(
      'req',
      'raise',
      ...P,
      '--date',
      '2025-04-18',
      '--area',
      'BUTCHER',
      '--functions',
      slot,
    );
    expect(raised.status).toBe('DRAFT');
    expect(raised.packs).toBe(4);
    expect(cli.json<unknown[]>('req', 'show', '--id', raised.id)).toHaveLength(1);
    expect(
      cli.json<{ status: string }>('req', 'advance', '--id', raised.id, '--to', 'ISSUED').status,
    ).toBe('ISSUED');
    expect(cli.json<unknown[]>('req', 'list', ...P, '--status', 'ISSUED')).toHaveLength(1);
  });

  it('redraws a draft when the guarantee moves', () => {
    const { cli, slot } = seeded();
    splitEverything(cli, slot);
    const raised = cli.json<{ id: string }>(
      'req',
      'raise',
      ...P,
      '--date',
      '2025-04-18',
      '--area',
      'BUTCHER',
      '--functions',
      slot,
    );
    cli.run('covers', 'guarantee', '--function', slot, '--covers', '60');
    splitEverything(cli, slot, 60);
    const lines = cli.json<{ packs: number }[]>(
      'req',
      'redraw',
      '--id',
      raised.id,
      '--functions',
      slot,
    );
    expect(lines[0]?.packs).toBe(2);
  });

  it('refuses a store with nothing in it', () => {
    const { cli, slot } = seeded();
    splitEverything(cli, slot);
    const result = cli.run(
      'req',
      'raise',
      ...P,
      '--date',
      '2025-04-18',
      '--area',
      'NONFOOD',
      '--functions',
      slot,
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('nothing on those functions comes out of NONFOOD');
  });
});

describe('the factor commands', () => {
  it('publishes a factor, lists it and shows the default', () => {
    const cli = cliHarness({ now: '2025-04-10T09:00:00.000Z' });
    cli.run('store', 'init');
    cli.run('demo', 'seed');

    const silent = cli.json<{ factor: string; percent: number }>(
      'factor',
      'show',
      ...P,
      '--style',
      'BUFFET',
    );
    expect(silent.factor).toBe('100%');
    expect(silent.percent).toBe(100);
    expect(cli.run('factor', 'list', ...P).out).toContain('makes exactly what it plates');

    const set = cli.json<{ style: string; factor: string; note: string }>(
      'factor',
      'set',
      ...P,
      '--style',
      'buffet',
      '--percent',
      '115',
      '--note',
      'display holds to the last table',
    );
    expect(set.style).toBe('BUFFET');
    expect(set.factor).toBe('115%');
    expect(set.note).toBe('display holds to the last table');

    const listed = cli.json<{ style: string; factor: string }[]>('factor', 'list', ...P);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.factor).toBe('115%');
    expect(cli.json<{ factor: string }>('factor', 'show', ...P, '--style', 'BUFFET').factor).toBe(
      '115%',
    );
  });

  it('refuses a factor below one to one', () => {
    const cli = cliHarness({ now: '2025-04-10T09:00:00.000Z' });
    cli.run('store', 'init');
    cli.run('demo', 'seed');
    const result = cli.run('factor', 'set', ...P, '--style', 'BUFFET', '--percent', '90');
    expect(result.code).toBe(1);
    expect(result.err).toContain('cannot make less than it plates');
  });

  it('carries the factor through to the batch sheet', () => {
    const { cli, slot } = seeded();
    splitEverything(cli, slot);
    const before = cli.json<
      { recipe: string; plates: number; produced: number; batches: number }[]
    >('kitchen', 'batches', '--function', slot);
    const ribBefore = before.find((row) => row.recipe === 'BRAISED-SHORT-RIB');
    expect(ribBefore?.produced).toBe(ribBefore?.plates);

    cli.run('factor', 'set', ...P, '--style', 'PLATED', '--percent', '115');
    const after = cli.json<{ recipe: string; plates: number; produced: number; batches: number }[]>(
      'kitchen',
      'batches',
      '--function',
      slot,
    );
    const ribAfter = after.find((row) => row.recipe === 'BRAISED-SHORT-RIB');
    expect(ribAfter?.plates).toBe(ribBefore?.plates);
    expect(ribAfter?.produced).toBeGreaterThan(ribBefore?.produced ?? 0);
    expect(ribAfter?.batches).toBeGreaterThanOrEqual(ribBefore?.batches ?? 0);
  });
});
