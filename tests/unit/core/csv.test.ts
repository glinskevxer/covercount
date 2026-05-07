import { describe, expect, it } from 'vitest';
import { csvCell, fromCsv, toCsv } from '../../../src/core/csv.js';

describe('one cell', () => {
  it('leaves a plain value alone', () => {
    expect(csvCell('GRAND-A')).toBe('GRAND-A');
    expect(csvCell(180)).toBe('180');
    expect(csvCell(0)).toBe('0');
  });

  it('writes nothing for nothing', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell('')).toBe('');
  });

  it('spells a flag out', () => {
    expect(csvCell(true)).toBe('yes');
    expect(csvCell(false)).toBe('no');
  });

  it('quotes a comma, a quote and a newline', () => {
    expect(csvCell('Fenwick, Halvorsen')).toBe('"Fenwick, Halvorsen"');
    expect(csvCell('the "grand" ballroom')).toBe('"the ""grand"" ballroom"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('stops a spreadsheet reading a value as a formula', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('-ANNEX')).toBe("'-ANNEX");
    expect(csvCell('+1 303 555 0134')).toBe("'+1 303 555 0134");
    expect(csvCell('@here')).toBe("'@here");
  });

  it('keeps the value it guarded rather than editing it', () => {
    expect(csvCell('=1+1')).toContain('=1+1');
  });

  it('does not guard a minus in the middle of a value', () => {
    expect(csvCell('GRAND-A')).toBe('GRAND-A');
    expect(csvCell(-1)).toBe("'-1");
  });
});

describe('a whole block', () => {
  const rows = [
    { room: 'GRAND-A', covers: 180, held: true },
    { room: 'ASPEN', covers: 40, held: false },
  ];

  it('writes a header and one line per row', () => {
    expect(toCsv(rows)).toBe('room,covers,held\nGRAND-A,180,yes\nASPEN,40,no');
  });

  it('takes the columns it is given, in that order', () => {
    expect(toCsv(rows, { columns: ['covers', 'room'] })).toBe('covers,room\n180,GRAND-A\n40,ASPEN');
  });

  it('writes an empty cell for a column a row does not carry', () => {
    expect(toCsv(rows, { columns: ['room', 'missing'] })).toBe('room,missing\nGRAND-A,\nASPEN,');
  });

  it('leaves the header off when asked', () => {
    expect(toCsv(rows, { header: false })).toBe('GRAND-A,180,yes\nASPEN,40,no');
  });

  it('writes the pair of characters Excel wants when asked', () => {
    expect(toCsv(rows, { newline: '\r\n' })).toContain('\r\n');
  });

  it('hands back nothing for nothing', () => {
    expect(toCsv([])).toBe('');
    expect(toCsv([], { columns: [] })).toBe('');
  });
});

describe('reading it back', () => {
  it('round trips a value with a comma, a quote and a newline in it', () => {
    const rows = [
      { name: 'Fenwick, Halvorsen', note: 'the "grand" ballroom', body: 'two\nlines' },
      { name: 'Okada', note: '', body: 'one line' },
    ];
    expect(fromCsv(toCsv(rows))).toEqual(rows);
  });

  it('round trips across either line ending', () => {
    const rows = [{ room: 'GRAND-A', covers: '180' }];
    expect(fromCsv(toCsv(rows, { newline: '\r\n' }))).toEqual(rows);
    expect(fromCsv(toCsv(rows, { newline: '\n' }))).toEqual(rows);
  });

  it('reads nothing from nothing', () => {
    expect(fromCsv('')).toEqual([]);
  });

  it('refuses a quote that never closes and one that opens mid cell', () => {
    expect(() => fromCsv('a,b\n"unterminated,2')).toThrow(/never closes/);
    expect(() => fromCsv('a,b\nfoo"bar",2')).toThrow(/only open at the start/);
  });

  it('reads a short row as empty cells rather than missing keys', () => {
    expect(fromCsv('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
  });
});
