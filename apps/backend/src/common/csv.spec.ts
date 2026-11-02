import { describe, expect, it } from 'vitest';
import { csvRecords, parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('handles quotes, escaped quotes, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });
  it('keeps file line numbers across blank rows and multi-line fields', () => {
    const { records } = csvRecords('name,price\n\nAtta,62\n"Two\nlines",5\nRice,72\n');
    expect(records.map((r) => [r.line, r.values.name])).toEqual([
      [3, 'Atta'],
      [4, 'Two\nlines'],
      [6, 'Rice'],
    ]);
  });
  it('round-trips through toCsv', () => {
    const rows = [['a', 'b, c', 'd "e"']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
