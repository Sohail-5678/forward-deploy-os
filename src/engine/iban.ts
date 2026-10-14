/** IBAN helpers: normalization, ISO 13616 mod-97 check, display grouping. */

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function isIbanShape(value: string): boolean {
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normalizeIban(value));
}

/** mod-97 over the rearranged IBAN, computed in chunks to stay within safe integers. */
export function ibanMod97(value: string): number {
  const iban = normalizeIban(value);
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const d of digits) {
      remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
    }
  }
  return remainder;
}

export function isValidIban(value: string): boolean {
  return isIbanShape(value) && ibanMod97(value) === 1;
}

export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, "$1 ").trim();
}

/** Mask the middle of an IBAN for logs and Slack previews. */
export function maskIban(value: string): string {
  const iban = normalizeIban(value);
  if (iban.length < 10) return iban;
  return `${iban.slice(0, 4)} •••• ${iban.slice(-4)}`;
}
