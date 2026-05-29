import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness } from '../support/cli.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

const P = ['--property', 'CANYON'];

describe('covercount demo seed', () => {
  it('builds a property that every other command can read', () => {
    const cli = cliHarness({ now: '2025-01-06T09:00:00.000Z' });
    cli.run('store', 'init');
    const result = cli.json<Record<string, number | string>>('demo', 'seed');
    expect(result.property).toBe('CANYON');
    expect(result.rooms).toBe(4);
    expect(result.recipes).toBe(5);

    expect(cli.json<unknown[]>('space', 'list', ...P)).toHaveLength(4);
    expect(cli.json<unknown[]>('account', 'list', ...P)).toHaveLength(1);
    expect(cli.json<unknown[]>('kit', 'list', ...P)).toHaveLength(6);
    expect(cli.json<unknown[]>('tax', 'list', ...P)).toHaveLength(1);
    expect(cli.json<unknown[]>('runsheet', 'show', ...P, '--style', 'PLATED')).toHaveLength(9);
  });

  it('is rejected the second time, because the property is already there', () => {
    const cli = cliHarness({ now: '2025-01-06T09:00:00.000Z' });
    cli.run('store', 'init');
    expect(cli.run('demo', 'seed').code).toBe(0);
    const again = cli.run('demo', 'seed');
    expect(again.code).toBe(1);
    expect(again.err).toContain('already on file');
  });

  it('leaves nothing behind when it is refused', () => {
    const cli = cliHarness({ now: '2025-01-06T09:00:00.000Z' });
    cli.run('store', 'init');
    cli.run('demo', 'seed');
    cli.run('demo', 'seed');
    expect(cli.json<unknown[]>('property', 'list')).toHaveLength(1);
    expect(cli.json<unknown[]>('space', 'list', ...P)).toHaveLength(4);
  });

  it('carries a room that can be combined and one that cannot', () => {
    const cli = cliHarness({ now: '2025-01-06T09:00:00.000Z' });
    cli.run('store', 'init');
    cli.run('demo', 'seed');
    const grand = cli.json<{ occupies: string; clashesWith: string }>(
      'room',
      'footprint',
      ...P,
      '--code',
      'GRAND',
    );
    expect(grand.occupies).toBe('GRAND-A, GRAND-B');
    expect(grand.clashesWith).toBe('GRAND, GRAND-A, GRAND-B');

    const aspen = cli.json<{ occupies: string }>('room', 'footprint', ...P, '--code', 'ASPEN');
    expect(aspen.occupies).toBe('ASPEN');
  });
});

describe('the house rules the demo publishes', () => {
  it('leaves every rule driven command with something to say', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    const seeded = cli.json<{ houseRules: number }>('demo', 'seed');
    expect(seeded.houseRules).toBeGreaterThan(0);

    const P = ['--property', 'CANYON'];
    expect(cli.json<{ style: string }[]>('factor', 'list', ...P).length).toBeGreaterThan(1);
    expect(cli.json<{ days: number }[]>('damages', 'scale', ...P)).toHaveLength(4);
    expect(cli.json<{ from: string }[]>('turn', 'table', ...P)).toHaveLength(3);
    expect(cli.json<{ role: string }[]>('pool', 'table', ...P).length).toBeGreaterThan(3);
    expect(cli.json<{ recipient: string }[]>('send', 'list', ...P)).toHaveLength(3);
  });

  it('prices enough of the larder to cost a plate', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    cli.run('demo', 'seed');
    const costed = cli.json<{ item: string; cost: string }[]>(
      'cost',
      'recipe',
      '--property',
      'CANYON',
      '--recipe',
      'BRAISED-SHORT-RIB',
      '--on',
      '2025-04-18',
    );
    expect(costed.length).toBeGreaterThan(0);
    expect(costed[0]?.cost).not.toBe('$0.00');
  });

  it('gives the account terms to age a statement against', () => {
    const cli = cliHarness();
    cli.run('store', 'init');
    cli.run('demo', 'seed');
    const ageing = cli.json<{ age: string }[]>(
      'statement',
      'ageing',
      '--property',
      'CANYON',
      '--account',
      'FENWICK',
      '--on',
      '2025-06-01',
    );
    expect(ageing).toHaveLength(5);
  });
});
