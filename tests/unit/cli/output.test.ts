import { describe, expect, it } from 'vitest';
import {
  columns,
  isOutputFormat,
  render,
  renderCell,
  renderJson,
  renderPlain,
  renderRecord,
  renderTable,
} from '../../../src/cli/output.js';

const rows = [
  { code: 'GRAND-A', name: 'Grand Ballroom A', capacity: 200, active: true },
  { code: 'ASPEN', name: 'Aspen Room', capacity: 60, active: false },
];

describe('rendering a cell', () => {
  it('prints a boolean as yes or no and a blank for nothing', () => {
    expect(renderCell(true)).toBe('yes');
    expect(renderCell(false)).toBe('no');
    expect(renderCell(null)).toBe('');
    expect(renderCell(undefined)).toBe('');
    expect(renderCell(0)).toBe('0');
    expect(renderCell('')).toBe('');
  });
});

describe('the table', () => {
  it('sizes each column to its widest value', () => {
    const table = renderTable(rows);
    const lines = table.split('\n');
    expect(lines[0]).toBe('code     name              capacity  active');
    expect(lines[1]).toBe('-------  ----------------  --------  ------');
    expect(lines[2]).toBe('GRAND-A  Grand Ballroom A  200       yes');
    expect(lines[3]).toBe('ASPEN    Aspen Room        60        no');
  });

  it('right aligns a column when it is asked to', () => {
    const table = renderTable(rows, [{ key: 'code' }, { key: 'capacity', align: 'right' }]);
    expect(table.split('\n')[2]).toBe('GRAND-A       200');
  });

  it('uses the label it is given', () => {
    const table = renderTable(rows, [{ key: 'code', label: 'room' }]);
    expect(table.split('\n')[0]).toBe('room');
  });

  it('takes the union of keys when no columns are named', () => {
    const table = renderTable([{ a: 1 }, { b: 2 }]);
    expect(table.split('\n')[0]).toBe('a  b');
  });

  it('is empty for no columns at all', () => {
    expect(renderTable([])).toBe('');
  });
});

describe('the other renderings', () => {
  it('separates plain output with tabs', () => {
    expect(renderPlain(rows, [{ key: 'code' }, { key: 'capacity' }])).toBe(
      'GRAND-A\t200\nASPEN\t60',
    );
  });

  it('prints JSON with two space indentation', () => {
    expect(renderJson({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('prints one record as a label and value list', () => {
    expect(renderRecord({ code: 'GRAND-A', capacity: 200 }, { format: 'table' })).toBe(
      'code      GRAND-A\ncapacity  200',
    );
    expect(renderRecord({ a: 1 }, { format: 'json' })).toBe('{\n  "a": 1\n}');
  });
});

describe('choosing a rendering', () => {
  it('prints an empty message for a table and an empty array for JSON', () => {
    expect(render([], { format: 'table', empty: 'no rooms' })).toBe('no rooms');
    expect(render([], { format: 'table' })).toBe('nothing to show');
    expect(render([], { format: 'json' })).toBe('[]');
  });

  it('recognises the formats it takes', () => {
    expect(isOutputFormat('table')).toBe(true);
    expect(isOutputFormat('plain')).toBe(true);
    expect(isOutputFormat('json')).toBe(true);
    expect(isOutputFormat('csv')).toBe(false);
  });

  it('routes to each rendering', () => {
    expect(render(rows, { format: 'json' })).toContain('"code": "GRAND-A"');
    expect(render(rows, { format: 'plain' })).toContain('\t');
    expect(render(rows, { format: 'table' })).toContain('---');
  });
});

describe('the column spec', () => {
  it('reads a bare key as a left aligned column', () => {
    expect(columns('store')).toEqual([{ key: 'store' }]);
    expect(columns('store', 'item')).toEqual([{ key: 'store' }, { key: 'item' }]);
  });

  it('right aligns anything with a trailing arrow', () => {
    expect(columns('packs>')).toEqual([{ key: 'packs', align: 'right' }]);
    expect(columns('item', 'packs>', 'cost>')).toEqual([
      { key: 'item' },
      { key: 'packs', align: 'right' },
      { key: 'cost', align: 'right' },
    ]);
  });

  it('takes a heading that differs from the key', () => {
    expect(columns('spaceCode:room')).toEqual([{ key: 'spaceCode', label: 'room' }]);
    expect(columns('unitMinor:each>')).toEqual([
      { key: 'unitMinor', label: 'each', align: 'right' },
    ]);
  });

  it('hands back nothing for an empty spec', () => {
    expect(columns()).toEqual([]);
  });

  it('drives the table the same way a written out list did', () => {
    const rows = [
      { store: 'BUTCHER', packs: 3 },
      { store: 'PRODUCE', packs: 11 },
    ];
    expect(renderTable(rows, columns('store', 'packs>'))).toBe(
      renderTable(rows, [{ key: 'store' }, { key: 'packs', align: 'right' }]),
    );
  });
});
