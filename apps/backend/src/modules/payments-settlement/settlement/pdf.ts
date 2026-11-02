/**
 * Minimal text PDF writer for statements and invoices (no dependency): A4 pages, Helvetica, one line per
 * entry, 58 lines per page. Text is limited to WinAnsi, so amounts use "Rs." (the apps show ₹).
 */
export function textPdf(title: string, lines: readonly string[]): Buffer {
  const perPage = 58;
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(1, lines.length); i += perPage) pages.push(lines.slice(i, i + perPage));
  const esc = (s: string) =>
    s
      .replace(/₹/g, 'Rs.')
      .replace(/[^\x20-\x7e]/g, '?')
      .replace(/([\\()])/g, '\\$1');

  const objects: string[] = [];
  const add = (body: string) => objects.push(body) - 1 + 1; // 1-based object number
  const catalog = add('');
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const kids: number[] = [];
  pages.forEach((pageLines, p) => {
    const ops = ['BT', `/F2 13 Tf 40 800 Td (${esc(title)}) Tj`, `/F1 8 Tf 0 -14 Td (Page ${p + 1} of ${pages.length}) Tj`, '/F1 9 Tf'];
    for (const l of pageLines) ops.push(`0 -12.6 Td (${esc(l)}) Tj`);
    ops.push('ET');
    const stream = ops.join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** "Rs.1,234.50" with Indian grouping. */
export function rs(paise: number): string {
  const neg = paise < 0;
  const v = Math.abs(paise);
  const whole = Math.floor(v / 100).toString();
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}Rs.${rest ? `${rest},` : ''}${last3}.${String(v % 100).padStart(2, '0')}`;
}
