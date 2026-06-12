/**
 * The read service.
 *
 * Node's own http module, no framework. The store is opened read only, so
 * whatever this process does it cannot write to the file the banquet office is
 * working in, and that is not a policy anybody has to remember to follow.
 *
 * Every answer carries an entity tag over its own body. The reader board in a
 * back corridor polls its route every fifteen seconds all day, and without a
 * tag every one of those polls redraws a screen that has not changed. The tag
 * is computed from the rendered body rather than from a row version, because
 * the body is what the caller is comparing and nothing else is guaranteed to
 * move with it.
 */

import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { describeError, isDomainError } from '../core/errors.js';
import { closeDatabase, type Database } from '../store/database.js';
import { openStore } from '../store/schema.js';
import { buildRouter, type ServiceContext } from './routes.js';
import type { Router } from './router.js';

export const SERVICE_VERSION = '1.0.0';

export interface ServiceOptions {
  readonly storePath: string;
  readonly version?: string;
}

export interface ServiceResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Record<string, string>;
}

const STATUS_FOR_KIND: Record<string, number> = {
  'invalid-input': 400,
  'not-found': 404,
  conflict: 409,
  'rule-violation': 422,
  'deadline-passed': 409,
  'capacity-exceeded': 409,
  'not-permitted': 403,
};

/** A weak tag over the body, which is what the caller actually compares. */
export function entityTag(body: string): string {
  return `W/"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
}

/**
 * Whether the caller already has this version.
 *
 * A header can carry several tags and a bare asterisk. The asterisk means the
 * caller will take whatever it already has, which for a read service is the
 * same as a match.
 */
export function tagMatches(header: string | undefined, tag: string): boolean {
  if (header === undefined) {
    return false;
  }
  const wanted = header
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return wanted.includes('*') || wanted.includes(tag);
}

/**
 * Answer one request. Split out from the server so the tests drive the real
 * routes and the real store without binding a port.
 */
export function answer(
  router: Router<ServiceContext>,
  context: ServiceContext,
  method: string,
  url: string,
  ifNoneMatch?: string,
): ServiceResponse {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  try {
    const payload = router.dispatch(method, url, context);
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    const tag = entityTag(body);
    if (tagMatches(ifNoneMatch, tag)) {
      // A 304 carries no body, and the tag has to go back with it or the
      // caller has nothing to compare against next time.
      return { status: 304, body: '', headers: { ...headers, etag: tag } };
    }
    return { status: 200, body, headers: { ...headers, etag: tag } };
  } catch (error) {
    if (isDomainError(error)) {
      return {
        status: STATUS_FOR_KIND[error.kind] ?? 400,
        body: `${JSON.stringify(error.toJSON(), null, 2)}\n`,
        headers,
      };
    }
    return {
      status: 500,
      body: `${JSON.stringify({ error: 'internal', message: describeError(error) }, null, 2)}\n`,
      headers,
    };
  }
}

export interface RunningService {
  readonly server: Server;
  readonly db: Database;
  close: () => Promise<void>;
}

export function createService(options: ServiceOptions): RunningService {
  const db = openStore(options.storePath, { readOnly: true });
  const router = buildRouter();
  const context: ServiceContext = { db, version: options.version ?? SERVICE_VERSION };

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const conditional = request.headers['if-none-match'];
    const result = answer(
      router,
      context,
      request.method ?? 'GET',
      request.url ?? '/',
      typeof conditional === 'string' ? conditional : undefined,
    );
    response.writeHead(result.status, result.headers);
    response.end(request.method === 'HEAD' || result.status === 304 ? undefined : result.body);
  });

  return {
    server,
    db,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          closeDatabase(db);
          if (error !== undefined && error.message !== 'Server is not running.') {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

export function listen(service: RunningService, port: number, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    service.server.once('error', reject);
    service.server.listen(port, host, () => {
      const address = service.server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    });
  });
}
