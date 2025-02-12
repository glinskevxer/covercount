/**
 * Building a property through the command line rather than through the store,
 * so the command tests exercise the parser on the way in.
 */

import type { CliHarness } from './cli.js';

export function seedPropertyThroughCli(cli: CliHarness): void {
  cli.run('store', 'init');
  cli.run(
    'property',
    'create',
    '--code',
    'CANYON',
    '--name',
    'Canyon Ridge Hotel',
    '--zone',
    'America/Denver',
    '--guarantee-lead',
    '3',
    '--guarantee-due',
    '12:00',
    '--overset',
    '5',
    '--overset-cap',
    '25',
  );
}

export function seedRoomsThroughCli(cli: CliHarness): void {
  const p = ['--property', 'CANYON'];
  cli.run(
    'space',
    'add',
    ...p,
    '--code',
    'GRAND-A',
    '--name',
    'Grand Ballroom A',
    '--fire',
    '350',
    '--area',
    '3200',
    '--setup',
    '120',
    '--teardown',
    '60',
    '--floor',
    'Lobby',
  );
  cli.run(
    'space',
    'add',
    ...p,
    '--code',
    'GRAND-B',
    '--name',
    'Grand Ballroom B',
    '--fire',
    '350',
    '--area',
    '3200',
    '--setup',
    '120',
    '--teardown',
    '60',
    '--floor',
    'Lobby',
  );
  cli.run(
    'space',
    'add',
    ...p,
    '--code',
    'ASPEN',
    '--name',
    'Aspen Room',
    '--fire',
    '80',
    '--area',
    '900',
    '--setup',
    '45',
    '--teardown',
    '30',
    '--floor',
    'Second',
  );
  cli.run(
    'space',
    'capacity',
    ...p,
    '--code',
    'GRAND-A',
    '--style',
    'ROUNDS-10',
    '--covers',
    '200',
  );
  cli.run(
    'space',
    'capacity',
    ...p,
    '--code',
    'GRAND-B',
    '--style',
    'ROUNDS-10',
    '--covers',
    '200',
  );
  cli.run('space', 'capacity', ...p, '--code', 'ASPEN', '--style', 'ROUNDS-10', '--covers', '60');
}
