/**
 * The command groups added after the first release, driven the way the office
 * drives them: through the parser, against a real store file.
 *
 * Their rules already have unit tests. What those do not cover is the layer
 * between an option string and the call, and that layer is where the mistakes
 * are: an option name that collides with a global one, a flag read as a
 * string, a report that prints nothing because the format branch was wrong.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness, type CliHarness } from '../support/cli.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

const P = ['--property', 'CANYON'];

function seeded(): { cli: CliHarness; slot: string; booking: string } {
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
  return { cli, slot, booking };
}

describe('the production factor at a terminal', () => {
  it('sets one, lists it and shows it', () => {
    const { cli } = seeded();
    expect(
      cli.json<{ style: string }>('factor', 'set', ...P, '--style', 'BUFFET', '--percent', '115')
        .style,
    ).toBe('BUFFET');
    expect(cli.json<{ style: string }[]>('factor', 'list', ...P)).toHaveLength(1);
    expect(cli.json<{ factor: string }>('factor', 'show', ...P, '--style', 'BUFFET').factor).toBe(
      '115%',
    );
  });
});

describe('the minimum at a terminal', () => {
  it('sets, shows, sweeps and clears', () => {
    const { cli, slot } = seeded();
    cli.run('minimum', 'set', '--function', slot, '--amount', '15000');
    expect(cli.json<{ met: boolean }>('minimum', 'show', '--function', slot).met).toBe(false);

    const swept = cli.json<{ shortfall: string; replaced: number }>(
      'minimum',
      'sweep',
      '--function',
      slot,
    );
    expect(swept.shortfall).toBe('$15,000.00');
    expect(swept.replaced).toBe(0);
    expect(
      cli.json<{ cleared: boolean; lines: number }>('minimum', 'clear', '--function', slot),
    ).toEqual({ cleared: true, lines: 1 });
  });

  it('says so when a function is not sold against one', () => {
    const { cli, slot } = seeded();
    expect(cli.run('minimum', 'show', '--function', slot).out).toContain('not sold against');
  });
});

describe('the cancellation scale at a terminal', () => {
  it('publishes bands, quotes a walkaway and drops a band', () => {
    const { cli, booking } = seeded();
    cli.run('damages', 'band', ...P, '--days', '90', '--percent', '50');
    cli.run('damages', 'band', ...P, '--days', '0', '--percent', '100');
    expect(cli.json<{ days: number }[]>('damages', 'scale', ...P)).toHaveLength(2);

    const priced =
      cli.json<{ id: string }[]>('function', 'list', '--booking', booking)[0]?.id ?? '';
    expect(cli.run('charge', 'package', '--function', priced).code).toBe(0);
    const quote = cli.json<{ band: string; owed: string }[]>(
      'damages',
      'quote',
      '--booking',
      booking,
      '--on',
      '2025-01-20',
    );
    expect(quote).toHaveLength(1);
    expect(quote[0]?.band).toBe('100%');
    expect(quote[0]?.owed).not.toBe('$0.00');
    expect(cli.json<{ removed: boolean }>('damages', 'drop', ...P, '--days', '0').removed).toBe(
      true,
    );
  });
});

describe('the shelf at a terminal', () => {
  it('adds an ingredient, counts it, moves it and orders against it', () => {
    const { cli } = seeded();
    cli.run(
      'larder',
      'add',
      ...P,
      '--code',
      'TRUFFLE',
      '--name',
      'Black truffle',
      '--area',
      'CHILL',
      '--unit',
      'OZ',
      '--pack',
      '8',
    );
    expect(
      cli.json<{ onHand: string }>(
        'stock',
        'count',
        ...P,
        '--item',
        'TRUFFLE',
        '--on-hand',
        '10OZ',
        '--par',
        '16OZ',
      ).onHand,
    ).toBe('10 OZ');
    expect(cli.json<{ item: string }[]>('stock', 'short', ...P)).toHaveLength(1);
    expect(
      cli.json<{ onHand: string }>(
        'stock',
        'move',
        ...P,
        '--item',
        'TRUFFLE',
        '--by',
        '6OZ',
        '--reason',
        'RECEIVE',
      ).onHand,
    ).toBe('16 OZ');
    expect(
      cli.json<{ packs: number }>('stock', 'order', ...P, '--item', 'TRUFFLE', '--need', '20OZ')
        .packs,
    ).toBe(3);
    expect(
      cli.json<{ reason: string }[]>('stock', 'history', ...P, '--item', 'TRUFFLE'),
    ).toHaveLength(2);
    expect(cli.json<{ code: string }[]>('larder', 'list', ...P).length).toBeGreaterThan(1);
    expect(
      cli.json<{ active: boolean }>('larder', 'retire', ...P, '--code', 'TRUFFLE').active,
    ).toBe(false);
  });
});

describe('the money reports at a terminal', () => {
  it('sets terms, ages a statement and compares commission bases', () => {
    const { cli, slot, booking } = seeded();
    expect(cli.run('charge', 'package', '--function', slot).code).toBe(0);
    const invoice = cli.json<{ id: string }>(
      'invoice',
      'raise',
      ...P,
      '--booking',
      booking,
      '--profile',
      'DENVER',
    ).id;
    expect(cli.run('settle', 'advance', '--id', invoice, '--to', 'ISSUED').code).toBe(0);

    expect(
      cli.json<{ net: number }>('statement', 'terms', ...P, '--account', 'FENWICK', '--net', '45')
        .net,
    ).toBe(45);
    expect(
      cli.json<{ invoice: string }[]>(
        'statement',
        'show',
        ...P,
        '--account',
        'FENWICK',
        '--on',
        '2025-06-01',
      ).length,
    ).toBe(1);
    expect(
      cli.json<{ age: string }[]>(
        'statement',
        'ageing',
        ...P,
        '--account',
        'FENWICK',
        '--on',
        '2025-06-01',
      ),
    ).toHaveLength(5);

    cli.run(
      'commission',
      'agree',
      ...P,
      '--account',
      'FENWICK',
      '--planner',
      'Renbrook',
      '--percent',
      '10',
      '--base',
      'NET',
    );
    expect(
      cli.json<{ planner: string }>('commission', 'due', ...P, '--invoice', invoice).planner,
    ).toBe('Renbrook');
    expect(
      cli.json<{ base: string }[]>(
        'commission',
        'compare',
        ...P,
        '--invoice',
        invoice,
        '--percent',
        '10',
      ),
    ).toHaveLength(3);
  });
});

describe('the sheets at a terminal', () => {
  it('prints the morning page and the pace', () => {
    const { cli } = seeded();
    expect(cli.run('today', ...P, '--date', '2025-04-18').out).toContain('Awards Dinner');
    expect(cli.json<{ covers: number }>('today', ...P, '--date', '2025-04-18').covers).toBe(180);
    expect(
      cli.run('pace', 'range', ...P, '--from', '2025-04-14', '--to', '2025-04-20').out,
    ).toContain('CANYON pace');
    expect(
      cli.json<{ held: number }>(
        'pace',
        'summary',
        ...P,
        '--from',
        '2025-04-14',
        '--to',
        '2025-04-20',
      ).held,
    ).toBe(180);
  });

  it('prints the turns and the cupboard', () => {
    const { cli } = seeded();
    cli.run(
      'turn',
      'standard',
      ...P,
      '--from',
      'THEATER',
      '--to',
      'ROUNDS-10',
      '--minutes',
      '150',
      '--heads',
      '6',
    );
    expect(cli.json<{ from: string }[]>('turn', 'table', ...P)).toHaveLength(1);
    expect(cli.run('turn', 'day', ...P, '--date', '2025-04-18').out).toContain('no room turns');
    expect(cli.run('cupboard', 'day', ...P, '--date', '2025-04-18').out).toContain(
      'nothing is pulled',
    );
  });
});

describe('the store commands at a terminal', () => {
  it('reports health, plans and the code catalogue', () => {
    const { cli } = seeded();
    expect(cli.json<{ integrity: string }>('store', 'health').integrity).toBe('ok');
    expect(cli.run('store', 'plans').out).toContain('none of them scanning');
    expect(cli.json<{ code: string }[]>('codes', '--area', 'covers').length).toBeGreaterThan(3);
    expect(cli.json<{ statistics: number }>('store', 'analyse').statistics).toBe(1);
  });

  it('rolls the season forward and refuses a backwards one', () => {
    const { cli } = seeded();
    const roll = cli.json<{ what: string }[]>(
      'season',
      ...P,
      '--from',
      '2025-01-01',
      '--to',
      '2026-01-01',
      '--uplift',
      '4',
      '--dry-run',
    );
    expect(roll.length).toBeGreaterThan(0);
    const bad = cli.run(
      'season',
      ...P,
      '--from',
      '2026-01-01',
      '--to',
      '2025-01-01',
      '--uplift',
      '4',
    );
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('nothing to roll into');
  });
});

describe('the meetings and the distribution at a terminal', () => {
  it('books a tasting and reads the window', () => {
    const { cli, booking } = seeded();
    const appointment = cli.json<{ id: number }>(
      'meet',
      'book',
      '--booking',
      booking,
      '--kind',
      'TASTING',
      '--date',
      '2025-02-10',
      '--start',
      '11:00',
      '--end',
      '13:00',
      '--who',
      'Ms Fenwick',
    ).id;
    expect(cli.json<{ kind: string }[]>('meet', 'list', '--booking', booking)).toHaveLength(1);
    expect(
      cli.json<{ outcome: string }>(
        'meet',
        'outcome',
        '--id',
        String(appointment),
        '--said',
        'took the halibut',
      ).outcome,
    ).toBe('took the halibut');
    expect(cli.json<{ closesOn: string }>('meet', 'window', '--booking', booking).closesOn).toBe(
      '2025-04-15',
    );
    expect(
      cli.json<{ cancelled: boolean }>('meet', 'drop', '--id', String(appointment)).cancelled,
    ).toBe(true);
  });

  it('keeps a distribution list', () => {
    const { cli } = seeded();
    cli.run('send', 'add', ...P, '--to', 'chef@canyon', '--role', 'Chef', '--channel', 'EMAIL');
    expect(cli.json<{ recipient: string }[]>('send', 'list', ...P)).toHaveLength(1);
    expect(
      cli.json<{ retired: boolean }>('send', 'retire', ...P, '--to', 'chef@canyon').retired,
    ).toBe(true);
    expect(cli.json<{ recipient: string }[]>('send', 'list', ...P)).toHaveLength(0);
  });
});
