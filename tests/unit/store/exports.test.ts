import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

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
