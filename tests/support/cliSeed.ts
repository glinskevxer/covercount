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

export function seedCombinedRoomThroughCli(cli: CliHarness): void {
  const p = ['--property', 'CANYON'];
  cli.run(
    'room',
    'combine',
    ...p,
    '--code',
    'GRAND',
    '--name',
    'Grand Ballroom',
    '--parts',
    'GRAND-A,GRAND-B',
  );
  cli.run('space', 'capacity', ...p, '--code', 'GRAND', '--style', 'ROUNDS-10', '--covers', '420');
}

export function seedBookingThroughCli(cli: CliHarness): string {
  const p = ['--property', 'CANYON'];
  cli.run(
    'account',
    'add',
    ...p,
    '--code',
    'FENWICK',
    '--name',
    'Fenwick Geological Society',
    '--kind',
    'ASSOCIATION',
  );
  const record = cli.json<{ id: string }>(
    'booking',
    'create',
    ...p,
    '--post-as',
    'Fenwick Annual Symposium',
    '--arrival',
    '2025-04-17',
    '--departure',
    '2025-04-19',
    '--account',
    'FENWICK',
  );
  return record.id;
}

export function seedReceptionCapacityThroughCli(cli: CliHarness): void {
  const p = ['--property', 'CANYON'];
  cli.run(
    'space',
    'capacity',
    ...p,
    '--code',
    'GRAND-A',
    '--style',
    'RECEPTION',
    '--covers',
    '350',
  );
  cli.run(
    'space',
    'capacity',
    ...p,
    '--code',
    'GRAND-B',
    '--style',
    'RECEPTION',
    '--covers',
    '350',
  );
}

export function seedRunSheetThroughCli(cli: CliHarness): void {
  const p = ['--property', 'CANYON'];
  const steps: [string, string, string, string, string, string][] = [
    ['1', 'crew in, room set', 'SETUP', '0', '0', 'HOUSEMAN'],
    ['2', 'mise en place', 'DOORS', '-180', '0', 'CHEF'],
    ['3', 'plate up starts', 'SERVICE', '0', '20', 'CHEF'],
    ['4', 'doors open', 'DOORS', '0', '0', 'CAPTAIN'],
    ['5', 'main fired', 'SERVICE', '45', '0', 'CHEF'],
    ['6', 'room struck', 'TEARDOWN', '0', '0', 'HOUSEMAN'],
  ];
  for (const [sequence, label, anchor, offset, perCover, owner] of steps) {
    cli.run(
      'runsheet',
      'step',
      ...p,
      '--style',
      'PLATED',
      '--sequence',
      sequence,
      '--label',
      label,
      '--anchor',
      anchor,
      '--offset',
      offset,
      '--per-cover',
      perCover,
      '--owner',
      owner,
    );
  }
}
