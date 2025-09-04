/**
 * A very small router.
 *
 * The read service exists so a screen in the kitchen and a screen in the
 * banquet office can both show the same day without either of them holding a
 * copy of the store. It is read only on purpose: everything that changes goes
 * through the command line, where it is one writer and one transaction.
 *
 * There is no framework here because there is nothing a framework would do.
 * Ten routes, no middleware stack, no sessions, and the whole thing fits in a
 * page.
 */

import { invalidInput, notFound } from '../core/errors.js';

export type Method = 'GET' | 'HEAD';

export interface RouteMatch {
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
}

export type Handler<T> = (match: RouteMatch, context: T) => unknown;

export interface Route<T> {
  readonly method: Method;
  readonly pattern: string;
  readonly segments: readonly string[];
  readonly handler: Handler<T>;
  readonly description: string;
}

export class Router<T> {
  private readonly routes: Route<T>[] = [];

  get(pattern: string, description: string, handler: Handler<T>): this {
    if (!pattern.startsWith('/')) {
      throw invalidInput('http.route', `a route pattern starts with a slash, got ${pattern}`);
    }
    const segments = pattern.split('/').filter((part) => part.length > 0);
    if (this.routes.some((route) => route.pattern === pattern)) {
      throw invalidInput('http.route', `${pattern} is registered twice`);
    }
    this.routes.push({ method: 'GET', pattern, segments, handler, description });
    return this;
  }

  /** Every route, for the index the service serves at the root. */
  list(): { method: Method; pattern: string; description: string }[] {
    return this.routes.map((route) => ({
      method: route.method,
      pattern: route.pattern,
      description: route.description,
    }));
  }

  match(path: string): { route: Route<T>; params: Record<string, string> } | undefined {
    const parts = path.split('/').filter((part) => part.length > 0);
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let matched = true;
      for (const [index, segment] of route.segments.entries()) {
        const actual = parts[index] ?? '';
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(actual);
          continue;
        }
        if (segment !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return { route, params };
      }
    }
    return undefined;
  }

  dispatch(method: string, url: string, context: T): unknown {
    if (method !== 'GET' && method !== 'HEAD') {
      throw invalidInput('http.method', `${method} is not a method this service answers`);
    }
    const parsed = new URL(url, 'http://covercount.invalid');
    const found = this.match(parsed.pathname);
    if (found === undefined) {
      throw notFound('http.route', parsed.pathname, `nothing is served at ${parsed.pathname}`);
    }
    return found.route.handler({ params: found.params, query: parsed.searchParams }, context);
  }
}

export function requireParam(match: RouteMatch, name: string): string {
  const value = match.params[name];
  if (value === undefined || value.length === 0) {
    throw invalidInput('http.param', `this route needs a ${name}`);
  }
  return value;
}

export function requireQuery(match: RouteMatch, name: string): string {
  const value = match.query.get(name);
  if (value === null || value.length === 0) {
    throw invalidInput('http.query', `this route needs a ${name} in the query string`);
  }
  return value;
}
