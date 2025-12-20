/**
 * The whole story, through the command line only.
 *
 * Nothing here reaches past the parser. A person sitting at a terminal could
 * type every one of these lines in this order, and if they could not this test
 * fails. It is the test that catches an option that exists in the store layer
 * and was never wired to a flag, which is the failure a unit test cannot see.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness, type CliHarness } from '../support/cli.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

const P = ['--property', 'CANYON'];

function at(cli: CliHarness, now: string): CliHarness {
  return cliHarness({ storePath: cli.storePath, now });
}

function sellIt(sold: CliHarness): { booking: string; dinner: string } {
  expect(sold.run('store', 'init').code).toBe(0);
  expect(sold.run('demo', 'seed').code).toBe(0);

  const booking = sold.json<{ id: string; status: string }>(
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
    '--manager',
    'r.okonkwo',
  );
  expect(booking.status).toBe('INQUIRY');

  const dinner = sold.json<{ id: string; status: string }>(
    'function',
    'add',
    '--booking',
    booking.id,
    '--room',
    'GRAND',
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
  expect(dinner.status).toBe('HELD');

  return { booking: booking.id, dinner: dinner.id };
}

describe('a symposium, typed out', () => {
  it('refuses to double book the room the combination already holds', () => {
    const sold = cliHarness({ now: '2025-01-20T15:00:00.000Z' });
    sellIt(sold);
    const clash = sold.run(
      'function',
      'add',
      '--booking',
      'BK-2025-0001',
      '--room',
      'GRAND-A',
      '--name',
      'Clashing',
      '--date',
      '2025-04-18',
      '--start',
      '19:00',
      '--end',
      '22:00',
      '--setup',
      'ROUNDS-10',
      '--service',
      'PLATED',
      '--covers',
      '100',
    );
    expect(clash.code).toBe(1);
    expect(clash.err).toContain('is already taken');
  });

  it('takes the function definite along with the booking', () => {
    const sold = cliHarness({ now: '2025-01-20T15:00:00.000Z' });
    const { booking, dinner } = sellIt(sold);
    expect(
      sold.json<{ status: string }>('deal', 'advance', '--id', booking, '--to', 'TENTATIVE').status,
    ).toBe('TENTATIVE');
    expect(
      sold.json<{ status: string }>('deal', 'advance', '--id', booking, '--to', 'DEFINITE').status,
    ).toBe('DEFINITE');
    expect(sold.json<{ status: string }>('slot', 'show', '--id', dinner).status).toBe('DEFINITE');
  });

  it('goes from an empty file to a settled invoice without leaving the command line', () => {
    const sold = cliHarness({ now: '2025-01-20T15:00:00.000Z' });
    const { booking, dinner } = sellIt(sold);
    sold.run('deal', 'advance', '--id', booking, '--to', 'TENTATIVE');
    sold.run('deal', 'advance', '--id', booking, '--to', 'DEFINITE');

    const opened = sold.json<{ guaranteeDue: string }>(
      'covers',
      'open',
      '--function',
      dinner,
      '--contract',
      '2025-01-20',
      '--package',
      'PLATED-THREE',
      '--book',
      'RACK-2025',
    );
    expect(opened.guaranteeDue).toBe('2025-04-15 12:00 America/Denver');

    guaranteeAndSplit(sold, dinner);
    kitchenAndCrew(sold, dinner);
    moneyAndSheet(sold, dinner);
    afterTheCutoff(sold, dinner);
    theNight(sold, dinner, booking);
  });
});

function guaranteeAndSplit(sold: CliHarness, dinner: string): void {
  const early = at(sold, '2025-04-10T09:00:00.000Z');
  expect(
    early.json<{ setFor: number }>('covers', 'guarantee', '--function', dinner, '--covers', '180')
      .setFor,
  ).toBe(189);

  early.run(
    'special',
    'add',
    '--function',
    dinner,
    '--guest',
    'A Okafor',
    '--covers',
    '12',
    '--diet',
    'VEGAN',
    '--substitute',
    'ROOT-PLATE',
  );
  expect(early.json<{ standard: number }>('count', 'show', '--function', dinner).standard).toBe(
    168,
  );

  early.run(
    'split',
    'set',
    '--function',
    dinner,
    '--course',
    'STARTER',
    '--covers',
    'BEET-TART:168',
  );
  early.run(
    'split',
    'set',
    '--function',
    dinner,
    '--course',
    'MAIN',
    '--covers',
    'SHORT-RIB:101,HALIBUT:67',
  );
  early.run('split', 'set', '--function', dinner, '--course', 'DESSERT', '--covers', 'SORBET:168');
  expect(early.run('split', 'show', '--function', dinner).err).toBe('');
}

function kitchenAndCrew(sold: CliHarness, dinner: string): void {
  const early = at(sold, '2025-04-10T09:00:00.000Z');
  expect(
    early.json<{ packs: number }[]>('kitchen', 'stores', '--function', dinner).length,
  ).toBeGreaterThan(4);

  const requisition = early.json<{ id: string; packs: number }>(
    'req',
    'raise',
    ...P,
    '--date',
    '2025-04-18',
    '--area',
    'BUTCHER',
    '--functions',
    dinner,
  );
  expect(requisition.packs).toBeGreaterThan(0);
  expect(early.json<{ label: string }[]>('timeline', 'save', '--function', dinner).length).toBe(9);
  expect(early.json<{ item: string }[]>('pull', 'sheet', '--function', dinner).length).toBe(6);
  expect(early.json<{ role: string }[]>('crew', 'build', '--function', dinner).length).toBe(3);
}

function moneyAndSheet(sold: CliHarness, dinner: string): void {
  const early = at(sold, '2025-04-10T09:00:00.000Z');
  early.run('charge', 'package', '--function', dinner);
  early.run(
    'bartier',
    'add',
    ...P,
    '--code',
    'HOUSE',
    '--name',
    'House bar',
    '--first',
    '18.00',
    '--extra',
    '12.00',
  );
  early.run(
    'bar',
    'set',
    '--function',
    dinner,
    '--kind',
    'PACKAGE',
    '--tier',
    'HOUSE',
    '--hours',
    '4',
  );
  early.run('barbill', 'draw', '--function', dinner);

  const drawn = early.json<{ id: string; status: string }>('order', 'draw', '--function', dinner);
  expect(drawn.status).toBe('DRAFT');
  expect(early.json<{ status: string }>('order', 'distribute', '--id', drawn.id).status).toBe(
    'DISTRIBUTED',
  );
  expect(
    early.json<{ status: string }>('order', 'sign', '--id', drawn.id, '--by', 'A Fenwick').status,
  ).toBe('SIGNED');
}

function afterTheCutoff(sold: CliHarness, dinner: string): void {
  const late = at(sold, '2025-04-17T09:00:00.000Z');
  const lowered = late.run('covers', 'guarantee', '--function', dinner, '--covers', '170');
  expect(lowered.code).toBe(1);
  expect(lowered.err).toContain('cannot be lowered');

  late.run('covers', 'guarantee', '--function', dinner, '--covers', '192');
  late.run(
    'split',
    'set',
    '--function',
    dinner,
    '--course',
    'STARTER',
    '--covers',
    'BEET-TART:180',
  );
  late.run(
    'split',
    'set',
    '--function',
    dinner,
    '--course',
    'MAIN',
    '--covers',
    'SHORT-RIB:108,HALIBUT:72',
  );
  late.run('split', 'set', '--function', dinner, '--course', 'DESSERT', '--covers', 'SORBET:180');

  const change = late.json<{ id: string; afterCutoff: boolean }>(
    'change',
    'raise',
    '--function',
    dinner,
    '--reason',
    'two coaches confirmed',
    '--fee',
    '250.00',
  );
  expect(change.afterCutoff).toBe(true);
  expect(late.json<{ status: string }>('change', 'apply', '--id', change.id).status).toBe(
    'APPLIED',
  );
}

function theNight(sold: CliHarness, dinner: string, booking: string): void {
  const night = at(sold, '2025-04-19T05:00:00.000Z');
  expect(
    night.json<{ billed: number }>('covers', 'served', '--function', dinner, '--covers', '188')
      .billed,
  ).toBe(192);
  night.run('charge', 'package', '--function', dinner);

  const invoice = night.json<{ id: string }>(
    'invoice',
    'raise',
    ...P,
    '--booking',
    booking,
    '--profile',
    'DENVER',
  );
  const totals = night.json<{ gross: string; balance: string }>(
    'invoice',
    'show',
    '--id',
    invoice.id,
  );
  expect(totals.gross).toMatch(/^\$[\d,]+\.\d\d$/);
  expect(totals.balance).toBe(totals.gross);

  night.run('settle', 'advance', '--id', invoice.id, '--to', 'ISSUED');
  night.run(
    'settle',
    'pay',
    '--id',
    invoice.id,
    '--kind',
    'PAYMENT',
    '--amount',
    totals.gross.replace('$', ''),
  );
  expect(
    night.json<{ status: string }>('settle', 'advance', '--id', invoice.id, '--to', 'PAID').status,
  ).toBe('PAID');
}
