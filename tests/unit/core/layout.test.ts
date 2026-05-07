import { describe, expect, it } from 'vitest';
import { padLeft, padRight, row, sheet, subRow } from '../../../src/core/layout.js';

describe('a row', () => {
  it('indents and joins the parts', () => {
    expect(row('one', ' two')).toBe('  one two');
    expect(subRow('detail')).toBe('      detail');
  });

  it('takes the trailing space off, so nothing pads out to the margin', () => {
    expect(row(padRight('short', 20))).toBe('  short');
    expect(row('')).toBe('');
  });

  it('pads either way', () => {
    expect(padRight('a', 4)).toBe('a   ');
    expect(padLeft(12, 5)).toBe('   12');
    expect(padRight('too long', 3)).toBe('too long');
  });
});

describe('a sheet', () => {
  it('prints the heading and the summary with nothing else', () => {
    expect(sheet({ heading: 'CANYON', summary: ['two functions'] })).toBe('CANYON\ntwo functions');
  });

  it('puts a blank line before each section it prints', () => {
    const text = sheet({
      heading: 'CANYON',
      sections: [
        { title: 'first', rows: [row('a')] },
        { title: 'second', rows: [row('b')] },
      ],
    });
    expect(text).toBe('CANYON\n\nfirst\n  a\n\nsecond\n  b');
  });

  it('leaves an empty section out entirely, heading included', () => {
    const text = sheet({
      heading: 'CANYON',
      sections: [
        { title: 'nothing here', rows: [] },
        { title: 'something', rows: [row('a')] },
      ],
    });
    expect(text).not.toContain('nothing here');
    expect(text).toContain('something');
  });

  it('keeps an empty section that says what it means', () => {
    const text = sheet({
      heading: 'CANYON',
      sections: [{ title: 'short of kit', rows: [], whenEmpty: 'the cupboard covers it' }],
    });
    expect(text).toBe('CANYON\n\nshort of kit\n  the cupboard covers it');
  });

  it('drops a section heading that is blank', () => {
    expect(sheet({ heading: 'CANYON', sections: [{ title: '', rows: [row('a')] }] })).toBe(
      'CANYON\n\n  a',
    );
  });

  it('says the sheet is bare only when it printed nothing at all', () => {
    expect(
      sheet({
        heading: 'CANYON',
        sections: [{ title: 'x', rows: [] }],
        whenBare: 'nothing on the books',
      }),
    ).toBe('CANYON\n\nnothing on the books');

    expect(
      sheet({
        heading: 'CANYON',
        sections: [
          { title: 'x', rows: [] },
          { title: 'y', rows: [row('a')] },
        ],
        whenBare: 'nothing on the books',
      }),
    ).not.toContain('nothing on the books');
  });

  it('says nothing extra when there is no bare message', () => {
    expect(sheet({ heading: 'CANYON', sections: [{ title: 'x', rows: [] }] })).toBe('CANYON');
  });
});
