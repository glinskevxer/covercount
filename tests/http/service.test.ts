/**
 * The read service, driven over a real socket against a real store file.
 * Nothing is stubbed: the store is built through the command line, the server
 * binds a port, and the assertions are made on what came back over the wire.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cliHarness, type CliHarness } from '../support/cli.js';
import {
  seedBookingThroughCli,
  seedPropertyThroughCli,
  seedRoomsThroughCli,
} from '../support/cliSeed.js';
import { cleanScratch } from '../support/store.js';
import { createService, listen, type RunningService } from '../../src/http/service.js';

const open: RunningService[] = [];

afterEach(async () => {
  while (open.length > 0) {
    const service = open.pop();
    if (service !== undefined) {
      await service.close();
    }
  }
  cleanScratch();
});

function seeded(): { cli: CliHarness; slot: string; booking: string } {
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
  return { cli, slot, booking };
}

async function start(storePath: string): Promise<string> {
  const service = createService({ storePath });
  open.push(service);
  const port = await listen(service, 0);
  return `http://127.0.0.1:${port}`;
}

async function get(base: string, path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`);
  const text = await response.text();
  return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
}

describe('the service over a socket', () => {
  it('serves its own index', async () => {
    const { cli } = seeded();
    const base = await start(cli.storePath);
    const { status, body } = await get(base, '/');
    expect(status).toBe(200);
    const index = body as { service: string; routes: unknown[] };
    expect(index.service).toBe('covercount');
    expect(index.routes.length).toBeGreaterThan(10);
  });

  it('reports health', async () => {
    const { cli } = seeded();
    const base = await start(cli.storePath);
    const { status, body } = await get(base, '/health');
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, properties: 1 });
  });

  it('serves the function board for a date', async () => {
    const { cli, slot } = seeded();
    const base = await start(cli.storePath);
    const { body } = await get(base, '/properties/CANYON/board?date=2025-04-18');
    const board = body as { totalCovers: number; rows: { functionId: string }[] };
    expect(board.totalCovers).toBe(180);
    expect(board.rows[0]?.functionId).toBe(slot);
  });

  it('serves the covers on a function', async () => {
    const { cli, slot } = seeded();
    const base = await start(cli.storePath);
    const { body } = await get(base, `/functions/${slot}/covers`);
    const covers = body as { guaranteed: number; setFor: number };
    expect(covers.guaranteed).toBe(180);
    expect(covers.setFor).toBe(189);
  });

  it('serves a booking with its functions', async () => {
    const { cli, booking, slot } = seeded();
    const base = await start(cli.storePath);
    const { body } = await get(base, `/bookings/${booking}`);
    const found = body as { postAs: string; functions: { id: string }[] };
    expect(found.postAs).toBe('Fenwick Annual Symposium');
    expect(found.functions[0]?.id).toBe(slot);
  });

  it('answers 404 for a path nothing is served at', async () => {
    const { cli } = seeded();
    const base = await start(cli.storePath);
    const { status, body } = await get(base, '/nowhere');
    expect(status).toBe(404);
    expect((body as { error: string }).error).toBe('http.route');
  });

  it('answers 404 for a record that is not on file', async () => {
    const { cli } = seeded();
    const base = await start(cli.storePath);
    const { status, body } = await get(base, '/bookings/BK-2025-9999');
    expect(status).toBe(404);
    expect((body as { kind: string }).kind).toBe('not-found');
  });

  it('answers 400 when a query value is missing or wrong', async () => {
    const { cli } = seeded();
    const base = await start(cli.storePath);
    expect((await get(base, '/properties/CANYON/board')).status).toBe(400);
    expect((await get(base, '/properties/CANYON/board?date=Friday')).status).toBe(400);
  });

  it('answers 422 when the domain refuses the read', async () => {
    const { cli, booking } = seeded();
    const bare = cli.json<{ id: string }>(
      'function',
      'add',
      '--booking',
      booking,
      '--room',
      'ASPEN',
      '--name',
      'Breakfast',
      '--date',
      '2025-04-18',
      '--start',
      '07:00',
      '--end',
      '09:00',
      '--setup',
      'ROUNDS-10',
      '--service',
      'PLATED',
      '--covers',
      '40',
    ).id;
    cli.run('covers', 'open', '--function', bare, '--contract', '2025-01-20');
    const base = await start(cli.storePath);
    const { status, body } = await get(base, `/functions/${bare}/covers`);
    expect(status).toBe(422);
    expect((body as { kind: string }).kind).toBe('rule-violation');
  });

  it('sets no store caching and a JSON content type', async () => {
    const { cli } = seeded();
    const base = await start(cli.storePath);
    const response = await fetch(`${base}/health`);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    await response.text();
  });
});
