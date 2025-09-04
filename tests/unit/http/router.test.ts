import { describe, expect, it } from 'vitest';
import { Router, requireParam, requireQuery } from '../../../src/http/router.js';
import { DomainError } from '../../../src/core/errors.js';

function build() {
  const router = new Router<{ name: string }>();
  router.get('/', 'index', () => 'index');
  router.get('/things', 'a list', (match) => `things ${match.query.get('filter') ?? 'all'}`);
  router.get('/things/:id', 'one thing', (match) => `thing ${match.params.id}`);
  router.get(
    '/things/:id/parts/:part',
    'a part',
    (match) => `${match.params.id}/${match.params.part}`,
  );
  return router;
}

describe('matching a route', () => {
  it('matches a literal path', () => {
    expect(build().dispatch('GET', '/', { name: 'x' })).toBe('index');
    expect(build().dispatch('GET', '/things', { name: 'x' })).toBe('things all');
  });

  it('pulls a parameter out of the path', () => {
    expect(build().dispatch('GET', '/things/BK-2025-0001', { name: 'x' })).toBe(
      'thing BK-2025-0001',
    );
    expect(build().dispatch('GET', '/things/a/parts/b', { name: 'x' })).toBe('a/b');
  });

  it('decodes a parameter that was escaped', () => {
    expect(build().dispatch('GET', '/things/a%20b', { name: 'x' })).toBe('thing a b');
  });

  it('reads the query string', () => {
    expect(build().dispatch('GET', '/things?filter=live', { name: 'x' })).toBe('things live');
  });

  it('does not match a path of a different length', () => {
    expect(build().match('/things/a/parts')).toBeUndefined();
    expect(build().match('/things/a/b/c/d')).toBeUndefined();
  });

  it('refuses a path nothing is served at', () => {
    expect(() => build().dispatch('GET', '/nowhere', { name: 'x' })).toThrow(
      /nothing is served at \/nowhere/,
    );
  });

  it('refuses a method it does not answer', () => {
    expect(() => build().dispatch('POST', '/', { name: 'x' })).toThrow(
      /POST is not a method this service answers/,
    );
    expect(build().dispatch('HEAD', '/', { name: 'x' })).toBe('index');
  });
});

describe('registering routes', () => {
  it('refuses a pattern without a leading slash and a duplicate', () => {
    const router = new Router<null>();
    expect(() => router.get('things', 'x', () => null)).toThrow(/starts with a slash/);
    router.get('/things', 'x', () => null);
    expect(() => router.get('/things', 'y', () => null)).toThrow(/registered twice/);
  });

  it('lists what it serves', () => {
    const listed = build().list();
    expect(listed).toHaveLength(4);
    expect(listed[0]).toEqual({ method: 'GET', pattern: '/', description: 'index' });
  });
});

describe('reading a request', () => {
  it('refuses a missing parameter or query value', () => {
    const query = new URLSearchParams();
    expect(() => requireParam({ params: {}, query }, 'id')).toThrow(/needs a id/);
    expect(() => requireQuery({ params: {}, query }, 'date')).toThrow(/needs a date in the query/);
    expect(() => requireParam({ params: { id: '' }, query }, 'id')).toThrow(DomainError);
  });

  it('hands back what is there', () => {
    const query = new URLSearchParams('date=2025-04-18');
    expect(requireParam({ params: { id: 'x' }, query }, 'id')).toBe('x');
    expect(requireQuery({ params: {}, query }, 'date')).toBe('2025-04-18');
  });
});
