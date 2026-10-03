// Reads an uploaded file (CSV, .xlsx, .xls or text-based PDF) into a simple table: rows[0] is the header row.
// Used by lead import and plot import. Spreadsheets go through SheetJS, PDFs through pdf.js (text only — no OCR).
const XLSX = require('xlsx');
const { bad, parseCsv } = require('./lib');

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const NAME_RE = /\b(name|customer|client|lead)\b/i;
const PHONE_RE = /\b(phone|mobile|contact|whatsapp|cell|number|mob)\b/i;
const MOBILE_IN_TEXT = /(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g;
const EMAIL_IN_TEXT = /[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/;

function sniff(buf, filename = '') {
  if (buf.length < 8) return 'csv';
  const head = buf.subarray(0, 8);
  if (head.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx'; // zip container
  if (head.readUInt32BE(0) === 0xd0cf11e0) return 'xls'; // OLE2 compound file
  const ext = (/\.(\w+)$/.exec(filename) || [])[1]?.toLowerCase();
  if (['pdf', 'xlsx', 'xls'].includes(ext)) throw bad(`This file is not a valid .${ext} file`);
  return 'csv'; // csv, tsv, txt, or anything else that is plain text
}
/** Plain text in whatever encoding Excel/Notepad/phones produced: UTF-8, UTF-8 with BOM, UTF-16, or Windows-1252. */
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^﻿/, '');
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le');
  const t = buf.toString('utf8');
  return t.includes('�') ? buf.toString('latin1') : t;
}
/** comma, semicolon, tab or pipe — whichever appears most consistently in the first lines. */
function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 8);
  let best = ',', bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const min = Math.min(...counts);
    if (min > 0 && min * 1000 + counts.reduce((a, b) => a + b, 0) > bestScore) { best = d; bestScore = min * 1000 + counts.reduce((a, b) => a + b, 0); }
  }
  return best;
}
const clean = (rows) => rows.map((r) => r.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim())); // blank rows are kept so row numbers match the file
const filled = (rows) => rows.filter((r) => r.some(Boolean)).length;
const HEADER_WORD = /(name|phone|mobile|mob\b|contact|whats?app|cell|tel\b|e-?mail|source|channel|budget|location|city|project|layout|notes?|remarks?|comments?|requirement|size|facing|purpose|address|rep\b|assigned|owner|status|enquiry|inquiry|lead|customer|client|s\.?\s?no|sr\.?\s?no|date)/i;
const hasMobile = (c) => /(^|[^\d])(?:\+?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}(?!\d)/.test(String(c).replace(/(\d)\.0+(?!\d)/g, '$1'));
/**
 * Finds where the real table starts. Handles: title rows above the header, a header whose words we do not know,
 * and files with no header at all (the first row is already a lead → a "Column 1…" header is added).
 * `offset` = rows removed above the header, so reported row numbers still match the file.
 */
function fromHeader(rows) {
  const first = rows.findIndex((r) => r.some(Boolean));
  if (first < 0) return { rows: [], offset: 0, headerless: false };
  const score = (r) => r.filter((c) => c && c.length <= 40 && HEADER_WORD.test(c) && !hasMobile(c)).length;
  const dataAt = rows.findIndex((r) => r.some(hasMobile));          // first row that already holds a lead
  const upTo = dataAt < 0 ? Math.min(rows.length, 25) : dataAt;
  const before = rows.slice(0, upTo).map((r, i) => [i, score(r)]).filter(([, sc]) => sc > 0);
  const strong = before.filter(([, sc]) => sc >= 2), pickFrom = strong.length ? strong : before;
  if (pickFrom.length) { const h = pickFrom[pickFrom.length - 1][0]; return { rows: rows.slice(h), offset: h, headerless: false }; }   // header closest to the data
  if (dataAt === first) { // no header at all — the first row is already a lead
    const width = Math.max(...rows.slice(first, first + 50).map((r) => r.length));
    return { rows: [Array.from({ length: width }, (_, i) => `Column ${i + 1}`), ...rows.slice(first)], offset: first - 1, headerless: true };
  }
  const h = dataAt > 0 ? rows.slice(0, dataAt).map((r, i) => [i, r.some(Boolean)]).filter(([, f]) => f).pop()?.[0] ?? first : first;   // unknown header words: the row just above the data
  return { rows: rows.slice(h), offset: h, headerless: false };
}

/** Every sheet that has data and the same header as the first one is stacked together (e.g. one sheet per month). */
function sheetRows(buf) {
  let wb;
  try { wb = XLSX.read(buf, { type: 'buffer', cellDates: true }); } catch { throw bad('Could not read this spreadsheet. Re-save it as .xlsx or .csv and try again.'); }
  const sheets = wb.SheetNames.map((name) => ({ name, rows: clean(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: true })) })).filter((s) => filled(s.rows) > 1);
  if (!sheets.length) return { rows: [], note: '' };
  const head = (rows) => { const t = fromHeader(rows); return { ...t, key: t.headerless ? '' : t.rows[0].join('|').toLowerCase() }; };
  const base = head(sheets[0].rows);
  let rows = sheets[0].rows, used = [sheets[0].name], skipped = [];
  for (const sh of sheets.slice(1)) {
    const h = head(sh.rows);
    if (base.key && h.key === base.key) { rows = [...rows, ...sh.rows.slice(h.offset + 1)]; used.push(sh.name); } else skipped.push(sh.name);
  }
  const note = (used.length > 1 ? `Combined sheets: ${used.join(', ')}. ` : sheets.length > 1 ? `Read sheet "${used[0]}". ` : '') + (skipped.length ? `Sheets with different columns were not read: ${skipped.join(', ')}.` : '');
  return { rows, note: note.trim() };
}

// ---------- PDF ----------
async function pdfLines(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  let doc;
  try { doc = await task.promise; }
  catch { throw bad('Could not open this PDF. It may be damaged or password-protected.'); }
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim())
      .map((i) => ({ s: i.str.replace(/\s+/g, ' ').trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: i.height || Math.abs(i.transform[3]) || 10 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    let cur = null;
    for (const it of items) {
      if (cur && Math.abs(cur.y - it.y) <= Math.max(2, it.h * 0.45)) cur.items.push(it);
      else { cur = { y: it.y, items: [it] }; lines.push(cur); }
    }
  }
  await task.destroy();
  // merge neighbouring text runs into cells: a gap wider than ~1 character height starts a new cell
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    const cells = [];
    for (const it of l.items) {
      const prev = cells[cells.length - 1];
      const gap = prev ? it.x - (prev.x + prev.w) : Infinity;
      if (prev && gap < prev.h * 1.0) { prev.s += (gap > prev.h * 0.15 ? ' ' : '') + it.s; prev.w = it.x + it.w - prev.x; }
      else cells.push({ ...it });
    }
    return cells;
  });
}
function pdfTable(lines) {
  const hi = lines.findIndex((c) => c.length >= 2 && c.some((x) => NAME_RE.test(x.s)) && c.some((x) => PHONE_RE.test(x.s)));
  if (hi >= 0) {
    // Table with a header: every later cell goes to the column whose band it overlaps most.
    const head = lines[hi];
    const edges = head.map((h, k) => (k === 0 ? -Infinity : (head[k - 1].x + head[k - 1].w + h.x) / 2));
    const band = (k) => [edges[k], k + 1 < head.length ? edges[k + 1] : Infinity];
    const headText = head.map((h) => h.s).join('|');
    const rows = [head.map((h) => h.s)];
    for (const cells of lines.slice(hi + 1)) {
      if (cells.map((c) => c.s).join('|') === headText) continue; // header repeated on the next page
      if (cells.length === 1 && /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(cells[0].s)) continue; // page numbers
      const row = head.map(() => '');
      for (const c of cells) {
        let best = 0, bestOv = -1;
        head.forEach((_, k) => { const [a, b] = band(k); const ov = Math.min(c.x + c.w, b) - Math.max(c.x, a); if (ov > bestOv) { bestOv = ov; best = k; } });
        row[best] = row[best] ? `${row[best]} ${c.s}` : c.s;
      }
      const hasDigits = row.some((v) => v.replace(/\D/g, '').length >= 10);
      const last = rows[rows.length - 1];
      // a wrapped cell (no number of its own, mostly empty) belongs to the row above
      if (!hasDigits && rows.length > 1 && row.filter(Boolean).length <= Math.max(1, head.length - 2)) row.forEach((v, k) => { if (v) last[k] = last[k] ? `${last[k]} ${v}` : v; });
      else rows.push(row);
    }
    return { rows, mode: 'table' };
  }
  // No header: treat every line that contains a mobile number as one lead.
  const rows = [['Name', 'Phone', 'Email', 'Notes']];
  for (const cells of lines) {
    const text = cells.map((c) => c.s).join('  ');
    const phones = text.match(MOBILE_IN_TEXT);
    if (!phones) continue;
    const email = (text.match(EMAIL_IN_TEXT) || [''])[0];
    const at = text.indexOf(phones[0]);
    const strip = (s) => s.replace(email, '').replace(MOBILE_IN_TEXT, '').replace(/\s+/g, ' ').replace(/^[\s\-–:|,.]+|[\s\-–:|,.]+$/g, '');
    const name = strip(text.slice(0, at)).replace(/^\d+[.)]?\s+/, '');
    rows.push([name, phones[0], email, strip(text.slice(at))]);
  }
  return { rows, mode: 'lines' };
}

/** → { kind: 'csv'|'xlsx'|'xls'|'pdf', rows: string[][], offset, note } — rows[0] is the header; offset = rows skipped above it. */
async function readTable(buf, filename) {
  if (!buf || !buf.length) throw bad('The file is empty');
  if (buf.length > MAX_FILE_BYTES) throw bad('File is too large (max 15 MB)');
  const kind = sniff(buf, filename);
  if (kind === 'pdf') {
    const lines = await pdfLines(buf);
    if (lines.reduce((n, l) => n + l.reduce((m, c) => m + c.s.length, 0), 0) < 20) throw bad('This PDF has no selectable text (it looks scanned). Scanned PDFs are not supported — export the list as Excel or CSV, or use a text-based PDF.');
    const { rows, mode } = pdfTable(lines);
    if (rows.length < 2) throw bad('No leads were found in this PDF. It needs a table with name and phone columns, or one lead with a mobile number per line.');
    return { kind, rows, offset: 0, note: mode === 'lines' ? 'No table header was found in the PDF, so each line with a mobile number was read as one lead. Check the preview carefully.' : 'Read from a PDF table. Check that the columns line up before importing.' };
  }
  let raw, note = '';
  if (kind === 'csv') { const text = decodeText(buf); raw = clean(parseCsv(text, sniffDelimiter(text))); }
  else { const sh = sheetRows(buf); raw = sh.rows; note = sh.note; }
  const { rows, offset, headerless } = fromHeader(raw);
  if (filled(rows) < 2) throw bad('The file has no data rows');
  return { kind, rows, offset, note: [note, headerless ? 'The file has no header row, so columns were detected from their contents.' : ''].filter(Boolean).join(' ') };
}

module.exports = { readTable };
