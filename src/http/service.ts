/**
 * The read service.
 *
 * Node's own http module, no framework. The store is opened read only, so
 * whatever this process does it cannot write to the file the banquet office is
 * working in, and that is not a policy anybody has to remember to follow.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { describeError, isDomainError } from '../core/errors.js';
import { closeDatabase, type Database } from '../store/database.js';
import { openStore } from '../store/schema.js';
import { buildRouter, type ServiceContext } from './routes.js';
import type { Router } from './router.js';

export const SERVICE_VERSION = '0.1.0';

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

/**
 * Answer one request. Split out from the server so the tests drive the real
 * routes and the real store without binding a port.
 */
export function answer(
  router: Router<ServiceContext>,
  context: ServiceContext,
  method: string,
  url: string,
): ServiceResponse {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  };
  try {
    const payload = router.dispatch(method, url, context);
    return { status: 200, body: `${JSON.stringify(payload, null, 2)}\n`, headers };
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
    const result = answer(router, context, request.method ?? 'GET', request.url ?? '/');
    response.writeHead(result.status, result.headers);
    response.end(request.method === 'HEAD' ? undefined : result.body);
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
