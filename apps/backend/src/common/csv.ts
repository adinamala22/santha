/**
 * Minimal RFC 4180 CSV reader: quoted fields (may span lines), escaped quotes (""), CRLF or LF,
 * BOM. Enough for catalogue imports (merchant bulk upload, master catalogue); not streaming.
 * Blank rows are dropped; each row keeps the 1-based file line it starts on.
 */
export function parseCsvRows(text: string): Array<{ line: number; fields: string[] }> {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: Array<{ line: number; fields: string[] }> = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push({ line: rowLine, fields: row });
    row = [];
    field = '';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else field += c;
  }
  if (field !== '' || row.length) endRow();
  return rows;
}

export const parseCsv = (text: string): string[][] => parseCsvRows(text).map((r) => r.fields);

/** Rows as objects keyed by the (lower-cased, trimmed) header row; `line` is the file line. */
export function csvRecords(text: string): { header: string[]; records: Array<{ line: number; values: Record<string, string> }> } {
  const [head, ...rest] = parseCsvRows(text);
  const header = (head?.fields ?? []).map((h) => h.trim().toLowerCase());
  return {
    header,
    records: rest.map((r) => ({
      line: r.line,
      values: Object.fromEntries(header.map((h, k) => [h, (r.fields[k] ?? '').trim()])),
    })),
  };
}

const needsQuote = /[",\r\n]/;
export const toCsv = (rows: Array<Array<string | number | null>>) =>
  rows.map((r) => r.map((v) => (v == null ? '' : needsQuote.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n') + '\n';
