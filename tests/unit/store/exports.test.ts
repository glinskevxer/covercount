import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { entityTag, tagMatches } from '../../../src/http/service.js';

/**
 * The sweep is a script rather than a lint rule, so nothing else would notice
 * if it stopped working. Running it here means a change that breaks the check
 * itself fails the suite rather than quietly passing everything.
 */
describe('the unused export sweep', () => {
  it('runs clean against the tree it ships with', () => {
    const out = execFileSync(process.execPath, ['scripts/check-exports.mjs'], {
      encoding: 'utf8',
    });
    expect(out).toContain('no unused exports');
  });
});

describe('the entity tag', () => {
  it('is stable for one body and different for another', () => {
    expect(entityTag('{"ok":true}')).toBe(entityTag('{"ok":true}'));
    expect(entityTag('{"ok":true}')).not.toBe(entityTag('{"ok":false}'));
    expect(entityTag('')).toMatch(/^W\/"[0-9a-f]{16}"$/);
  });

  it('matches a bare tag, a list and an asterisk', () => {
    const tag = entityTag('{"ok":true}');
    expect(tagMatches(tag, tag)).toBe(true);
    expect(tagMatches(`  ${tag}  `, tag)).toBe(true);
    expect(tagMatches(`W/"0000000000000000", ${tag}`, tag)).toBe(true);
    expect(tagMatches('*', tag)).toBe(true);
    expect(tagMatches('W/"0000000000000000"', tag)).toBe(false);
    expect(tagMatches(undefined, tag)).toBe(false);
    expect(tagMatches('', tag)).toBe(false);
  });
});
