/**
 * RFC 4180 CSV parser and serializer: quoted fields, escaped quotes, embedded
 * delimiters and newlines, UTF-8 BOM, CRLF / LF / CR line endings, and
 * delimiter detection (comma, semicolon, tab, pipe) for European exports.
 */

export interface ParsedTable {
  fileId: string;
  headers: string[];
  rows: Record<string, string>[];
  delimiter: string;
  bom: boolean;
  lineEnding: "\r\n" | "\n" | "\r" | "none";
  warnings: string[];
}

export interface CsvParseOptions {
  delimiter?: string;
  maxRows?: number;
  maxFieldLength?: number;
}

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"];

export const CSV_LIMITS = { maxRows: 20000, maxFieldLength: 10000, maxColumns: 200 } as const;

export function detectDelimiter(text: string): string {
  const firstLine = firstRecordLine(text);
  let best = ",";
  let bestCount = 0;
  for (const d of CANDIDATE_DELIMITERS) {
    const count = countOutsideQuotes(firstLine, d);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function firstRecordLine(text: string): string {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) return text.slice(0, i);
  }
  return text;
}

function countOutsideQuotes(line: string, d: string): number {
  let inQuotes = false;
  let n = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === d) n++;
  }
  return n;
}

function detectLineEnding(text: string): ParsedTable["lineEnding"] {
  const crlf = text.indexOf("\r\n");
  const lf = text.indexOf("\n");
  const cr = text.indexOf("\r");
  if (crlf !== -1 && crlf <= lf) return "\r\n";
  if (lf !== -1 && (cr === -1 || lf < cr)) return "\n";
  if (cr !== -1) return "\r";
  return "none";
}

/** Parse CSV text into raw records (arrays of fields). */
export function parseRecords(text: string, delimiter: string, opts: CsvParseOptions = {}): { records: string[][]; warnings: string[] } {
  const maxRows = opts.maxRows ?? CSV_LIMITS.maxRows;
  const maxField = opts.maxFieldLength ?? CSV_LIMITS.maxFieldLength;
  const records: string[][] = [];
  const warnings: string[] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    if (field.length > maxField) {
      warnings.push(`Field longer than ${maxField} characters was truncated (record ${records.length + 1}).`);
      field = field.slice(0, maxField);
    }
    record.push(field);
    field = "";
    fieldWasQuoted = false;
  };
  const pushRecord = () => {
    pushField();
    // Skip records that are a single empty field (blank lines).
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        // Lenient: characters after a closing quote are kept literally.
        if (i < n && text[i] !== delimiter && text[i] !== "\n" && text[i] !== "\r") {
          warnings.push(`Unexpected character after closing quote in record ${records.length + 1}.`);
        }
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.length === 0 && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      pushRecord();
      if (ch === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
      if (records.length > maxRows) {
        warnings.push(`File has more than ${maxRows} rows; extra rows were ignored.`);
        break;
      }
      continue;
    }
    field += ch;
    i++;
  }
  if (inQuotes) warnings.push("File ended inside a quoted field.");
  if (field.length > 0 || record.length > 0 || fieldWasQuoted) pushRecord();
  return { records, warnings };
}

export function parseCsv(text: string, fileId: string, opts: CsvParseOptions = {}): ParsedTable {
  let bom = false;
  if (text.charCodeAt(0) === 0xfeff) {
    bom = true;
    text = text.slice(1);
  }
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const lineEnding = detectLineEnding(text);
  const { records, warnings } = parseRecords(text, delimiter, opts);
  if (records.length === 0) {
    return { fileId, headers: [], rows: [], delimiter, bom, lineEnding, warnings: [...warnings, "File is empty."] };
  }
  const headers = dedupeHeaders(records[0].map((h) => h.trim()));
  if (headers.length > CSV_LIMITS.maxColumns) warnings.push(`File has more than ${CSV_LIMITS.maxColumns} columns.`);
  const rows: Record<string, string>[] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length !== headers.length) {
      warnings.push(`Row ${r} has ${rec.length} fields, expected ${headers.length}.`);
    }
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = rec[idx] ?? "";
    });
    rows.push(row);
  }
  return { fileId, headers, rows, delimiter, bom, lineEnding, warnings };
}

export function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((h, idx) => {
    const base = h === "" ? `column_${idx + 1}` : h;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function needsQuoting(value: string, delimiter: string): boolean {
  return (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value.startsWith(" ") ||
    value.endsWith(" ")
  );
}

export function quoteField(value: string, delimiter = ","): string {
  return needsQuoting(value, delimiter) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: Record<string, string | number>[], delimiter = ",", lineEnding = "\r\n"): string {
  const lines = [headers.map((h) => quoteField(h, delimiter)).join(delimiter)];
  for (const row of rows) {
    lines.push(headers.map((h) => quoteField(String(row[h] ?? ""), delimiter)).join(delimiter));
  }
  return lines.join(lineEnding) + lineEnding;
}

/** Accept a JSON array of flat objects as a table (Sandbox uploads). */
export function parseJsonTable(text: string, fileId: string): ParsedTable {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { fileId, headers: [], rows: [], delimiter: ",", bom: false, lineEnding: "none", warnings: ["Not valid JSON."] };
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { rows?: unknown }).rows)
      ? (data as { rows: unknown[] }).rows
      : null;
  if (!list) {
    return { fileId, headers: [], rows: [], delimiter: ",", bom: false, lineEnding: "none", warnings: ["Expected a JSON array of objects (or { rows: [...] })."] };
  }
  const headers: string[] = [];
  const rows: Record<string, string>[] = [];
  for (const item of list.slice(0, CSV_LIMITS.maxRows)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      warnings.push("Skipped an entry that is not a flat object.");
      continue;
    }
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
      if (!headers.includes(k)) {
        if (headers.length >= CSV_LIMITS.maxColumns) continue;
        headers.push(k);
      }
      row[k] = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    }
    rows.push(row);
  }
  for (const row of rows) for (const h of headers) if (!(h in row)) row[h] = "";
  return { fileId, headers, rows, delimiter: ",", bom: false, lineEnding: "none", warnings };
}
