/**
 * Name tokenization shared by the schema matcher and the selector healer:
 * split snake / camel / kebab case, lowercase, expand a small synonym table.
 */

/** Synonym table (spec 8.1). Values are canonical concept tokens. */
export const SYNONYMS: Readonly<Record<string, string>> = {
  // identifiers
  id: "identifier",
  ref: "identifier",
  reference: "identifier",
  no: "identifier",
  num: "identifier",
  nr: "identifier",
  nbr: "identifier",
  number: "identifier",
  code: "identifier",
  key: "identifier",
  // customers
  cust: "customer",
  customer: "customer",
  client: "customer",
  buyer: "customer",
  // money
  amt: "amount",
  amount: "amount",
  val: "amount",
  value: "amount",
  total: "amount",
  gross: "amount",
  sum: "amount",
  price: "amount",
  // dates
  dt: "date",
  date: "date",
  issued: "date",
  day: "date",
  // invoices
  inv: "invoice",
  invoice: "invoice",
  bill: "invoice",
  billing: "invoice",
  // purchase orders
  po: "purchase_order",
  procurement: "purchase_order",
  purchase: "purchase_order",
  order: "purchase_order",
  // accounts
  acct: "account",
  account: "account",
  iban: "account",
  bank: "account",
  // payee
  payee: "payee",
  beneficiary: "payee",
  remit: "payee",
  remittance: "payee",
  // vendors
  vendor: "vendor",
  supplier: "vendor",
  seller: "vendor",
  merchant: "vendor",
  // tax
  tax: "tax",
  vat: "tax",
  gst: "tax",
  rate: "rate",
  pct: "rate",
  percent: "rate",
  perc: "rate",
  // lines
  line: "line",
  lines: "line",
  ln: "line",
  item: "item",
  items: "item",
  itm: "item",
  count: "count",
  cnt: "count",
  qty: "count",
  quantity: "count",
  // documents
  doc: "document",
  document: "document",
  // currencies
  usd: "currency",
  eur: "currency",
  gbp: "currency",
  // portal-specific words seen on legacy forms
  amt_: "amount",
  centre: "center",
  center: "center",
  ctr: "center",
  cost: "cost",
  gl: "ledger",
  ledger: "ledger",
  submit: "post",
  post: "post",
  save: "post",
  send: "post",
  continue: "continue",
  ok: "continue",
  search: "search",
  find: "search",
  lookup: "search",
  override: "override",
  supervisor: "override",
  user: "user",
  username: "user",
  userid: "user",
  pwd: "password",
  pass: "password",
  log: "log",
  logon: "logon",
  login: "logon",
  signin: "logon",
  password: "password",
  passcode: "password",
};

const STOPWORDS = new Set(["the", "of", "for", "to", "in", "on", "at", "a", "an", "and", "or", "field", "fld", "col", "column", "enter", "please", "your", "s", "btn", "txt", "inp", "lbl", "cbo", "ddl"]);

/** Split an identifier or label into lowercase word tokens. */
export function splitIdentifier(name: string): string[] {
  return name
    .normalize("NFKC")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-zA-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9#%]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function canonicalToken(token: string): string {
  if (token === "#") return "identifier";
  if (token === "%") return "rate";
  return SYNONYMS[token] ?? token;
}

/**
 * Tokens after synonym expansion, stopwords removed, order-preserving and
 * unique. Adjacent words that form a known compound are joined first
 * ("User name" -> username -> user, "Log On" -> logon, "Look up" -> lookup).
 * Single letters and bare numbers (noise from generated ids) are dropped.
 */
export function expandTokens(tokens: string[]): string[] {
  const out: string[] = [];
  const push = (t: string) => {
    const c = canonicalToken(t);
    if (!out.includes(c)) out.push(c);
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (next !== undefined && SYNONYMS[t + next] !== undefined) {
      push(t + next);
      i++;
      continue;
    }
    if (STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (t.length === 1 && t !== "#" && t !== "%") continue;
    push(t);
  }
  return out;
}

export function conceptTokens(name: string): string[] {
  return expandTokens(splitIdentifier(name));
}

export function jaccard<T>(a: Iterable<T>, b: Iterable<T>): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function intersection<T>(a: Iterable<T>, b: Iterable<T>): T[] {
  const B = new Set(b);
  return [...new Set(a)].filter((x) => B.has(x));
}

export function charNgrams(input: string, n = 3): Set<string> {
  const s = input.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const grams = new Set<string>();
  if (s.length === 0) return grams;
  if (s.length <= n) {
    grams.add(s);
    return grams;
  }
  for (let i = 0; i <= s.length - n; i++) grams.add(s.slice(i, i + n));
  return grams;
}

export interface NameSimilarity {
  score: number;
  char: number;
  token: number;
  overlap: string[];
}

/** max(character 3-gram Jaccard, token Jaccard after synonym expansion). */
export function nameSimilarity(a: string, b: string): NameSimilarity {
  const char = jaccard(charNgrams(a), charNgrams(b));
  const ta = conceptTokens(a);
  const tb = conceptTokens(b);
  const token = jaccard(ta, tb);
  return { score: Math.max(char, token), char, token, overlap: intersection(ta, tb) };
}
