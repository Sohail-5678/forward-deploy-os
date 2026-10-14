"use client";

/** Save text as a file through a temporary object URL. */
export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Spreadsheet formula guard for downloaded CSVs: a cell that starts with
 * = + @ (or a dash not followed by a number) is prefixed with an apostrophe
 * so Excel and Sheets show it as text instead of evaluating it.
 */
export function spreadsheetSafe(value: string | number): string | number {
  if (typeof value !== "string") return value;
  return /^[=+@\t\r]/.test(value) || /^-(?![\d.])/.test(value) ? `'${value}` : value;
}
