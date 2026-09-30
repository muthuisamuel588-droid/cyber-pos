'use strict';

// Small shared helpers used by every route module.

/** Round to 2 decimals, avoiding float dust like 0.30000000000000004. */
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function num(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

function int(value, fallback = 0) {
  const v = parseInt(value, 10);
  return Number.isFinite(v) ? v : fallback;
}

function str(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** ISO-ish local timestamp 'YYYY-MM-DD HH:MM:SS' matching SQLite datetime('now','localtime'). */
function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function today() {
  return now().slice(0, 10);
}

/** Accepts YYYY-MM-DD, returns a SQL-safe datetime start/end bound. */
function dayStart(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str(value)) ? `${value} 00:00:00` : null;
}
function dayEnd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str(value)) ? `${value} 23:59:59` : null;
}

/** Wrap an async route so rejections reach the error middleware. */
function wrap(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || null;
  }
}

const bad = (message, code) => new HttpError(400, message, code);
const notFound = (message = 'Not found') => new HttpError(404, message);
const forbidden = (message = 'Not allowed') => new HttpError(403, message);

/** Escape a value for CSV and convert an array of row objects to CSV text. */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.label ?? c.key)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => csvCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(',')
  );
  return [head, ...body].join('\r\n');
}

/** Parse CSV text into an array of objects keyed by the header row. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const cleaned = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!cleaned.length) return [];
  const header = cleaned[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return cleaned.slice(1).map((r) => {
    const obj = {};
    header.forEach((key, idx) => {
      obj[key] = (r[idx] ?? '').trim();
    });
    return obj;
  });
}

module.exports = {
  money,
  num,
  int,
  str,
  bool,
  now,
  today,
  dayStart,
  dayEnd,
  wrap,
  HttpError,
  bad,
  notFound,
  forbidden,
  csvCell,
  toCsv,
  parseCsv,
};