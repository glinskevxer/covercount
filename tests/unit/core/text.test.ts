import { describe, expect, it } from 'vitest';
import {
  BOARD_LINE,
  LINE,
  NAME,
  NOTE,
  REFERENCE,
  boundedText,
  singleLine,
} from '../../../src/core/text.js';

describe('bounded text', () => {
  it('trims before it measures', () => {
    expect(boundedText('a name', '  Fenwick  ', 7)).toBe('Fenwick');
    expect(boundedText('a name', `${'a'.repeat(10)}${' '.repeat(50)}`, 10)).toHaveLength(10);
  });

  it('takes a value exactly on the limit', () => {
    expect(boundedText('a name', 'a'.repeat(60), 60)).toHaveLength(60);
    expect(() => boundedText('a name', 'a'.repeat(61), 60)).toThrow(
      /takes 60 characters and this is 61/,
    );
  });

  it('allows blank unless it is told not to', () => {
    expect(boundedText('a note', '   ', 100)).toBe('');
    expect(() => boundedText('a note', '   ', 100, { required: true })).toThrow(/cannot be blank/);
  });

  it('carries the code it is given, so a caller can branch on the field', () => {
    try {
      boundedText('a name', '', 10, { required: true, code: 'booking.post-as' });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as { code: string }).code).toBe('booking.post-as');
    }
  });

  it('falls back to a code of its own', () => {
    try {
      boundedText('a name', 'a'.repeat(20), 10);
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as { code: string }).code).toBe('text.long');
    }
  });
});

describe('text bound for one line', () => {
  it('refuses a newline rather than stripping it', () => {
    expect(() => singleLine('a name', 'Fenwick\nSymposium', 60)).toThrow(/goes on one line/);
    expect(() => singleLine('a name', 'Fenwick\r\nSymposium', 60)).toThrow(/goes on one line/);
  });

  it('is otherwise the same rule', () => {
    expect(singleLine('a name', '  Fenwick  ', 60)).toBe('Fenwick');
    expect(() => singleLine('a name', 'a'.repeat(61), 60)).toThrow(/takes 60 characters/);
  });
});

describe('the limits', () => {
  it('are the shape of the thing rather than one number for everything', () => {
    expect(BOARD_LINE).toBe(60);
    expect(REFERENCE).toBeGreaterThan(BOARD_LINE);
    expect(NAME).toBeGreaterThan(REFERENCE);
    expect(LINE).toBeGreaterThan(NAME);
    expect(NOTE).toBeGreaterThan(LINE);
  });
});
