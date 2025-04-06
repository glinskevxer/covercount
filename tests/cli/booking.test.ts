import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness, type CliHarness } from '../support/cli.js';
import { seedPropertyThroughCli, seedRoomsThroughCli } from '../support/cliSeed.js';
import { cleanScratch } from '../support/store.js';

afterEach(cleanScratch);

const P = ['--property', 'CANYON'];

function seeded(): CliHarness {
  const cli = cliHarness();
  seedPropertyThroughCli(cli);
  seedRoomsThroughCli(cli);
  cli.run(
    'account',
    'add',
    ...P,
    '--code',
    'FENWICK',
    '--name',
    'Fenwick Geological Society',
    '--kind',
    'ASSOCIATION',
    '--email',
    'ap@fenwick.example',
  );
  return cli;
}

describe('covercount account', () => {
  it('adds an account and reads it back', () => {
    const cli = seeded();
    const record = cli.json<Record<string, string>>('account', 'show', ...P, '--code', 'FENWICK');
    expect(record.name).toBe('Fenwick Geological Society');
    expect(record.kind).toBe('ASSOCIATION');
    expect(record.credit).toBe('APPROVED');
  });

  it('lists accounts', () => {
    const cli = seeded();
    const rows = cli.json<{ code: string }[]>('account', 'list', ...P);
    expect(rows.map((row) => row.code)).toEqual(['FENWICK']);
  });

  it('moves credit status', () => {
    const cli = seeded();
    const record = cli.json<Record<string, string>>(
      'account',
      'credit',
      ...P,
      '--code',
      'FENWICK',
      '--status',
      'hold',
    );
    expect(record.credit).toBe('HOLD');
  });

  it('refuses a kind it does not know', () => {
    const cli = seeded();
    const result = cli.run(
      'account',
      'add',
      ...P,
      '--code',
      'X',
      '--name',
      'X',
      '--kind',
      'WEDDING',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('not an account kind');
  });
});

describe('covercount booking', () => {
  it('opens a booking as an inquiry', () => {
    const cli = seeded();
    const record = cli.json<Record<string, string>>(
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
    );
    expect(record.id).toBe('BK-2025-0001');
    expect(record.status).toBe('INQUIRY');
    expect(record.account).toBe('FENWICK');
  });

  it('lists and filters', () => {
    const cli = seeded();
    cli.run(
      'booking',
      'create',
      ...P,
      '--post-as',
      'One',
      '--arrival',
      '2025-04-17',
      '--departure',
      '2025-04-19',
    );
    cli.run(
      'booking',
      'create',
      ...P,
      '--post-as',
      'Two',
      '--arrival',
      '2025-09-01',
      '--departure',
      '2025-09-02',
    );
    expect(cli.json<unknown[]>('booking', 'list', ...P)).toHaveLength(2);
    expect(cli.json<unknown[]>('booking', 'list', ...P, '--from', '2025-08-01')).toHaveLength(1);
    expect(cli.json<unknown[]>('booking', 'list', ...P, '--status', 'DEFINITE')).toHaveLength(0);
  });

  it('says so when nothing matches', () => {
    const cli = seeded();
    expect(cli.run('booking', 'list', ...P).out).toBe('no bookings match');
  });

  it('refuses a departure before the arrival', () => {
    const cli = seeded();
    const result = cli.run(
      'booking',
      'create',
      ...P,
      '--post-as',
      'Backwards',
      '--arrival',
      '2025-04-19',
      '--departure',
      '2025-04-17',
    );
    expect(result.code).toBe(1);
    expect(result.err).toContain('falls before the arrival');
  });
});
