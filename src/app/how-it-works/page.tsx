import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter, SiteNav } from "@/components/landing/SiteChrome";
import { NODE_BLURBS, NODE_NAMES } from "@/engine/agent/runtime";
import { MATCH_WEIGHTS, MAPPING_THRESHOLD } from "@/engine/etl/matcher";
import { SIMILARITY_WEIGHTS } from "@/engine/browser/selector-healer";
import { FEATURE_NAMES } from "@/engine/agent/calibrator";
import { DEFAULT_HEALING, DEFAULT_POLICY } from "@/engine/config";
import { formatUsd } from "@/engine/format";
import type { NodeId } from "@/engine/types";

export const metadata: Metadata = {
  title: "How it works",
  description: "Architecture of ForwardDeploy OS: an 8-node state machine in a Web Worker, declarative schema healing, calibrated reconciliation, signed human checkpoints, a distilled-DOM browser agent with self-healing selectors, and layered prompt-injection defenses.",
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="display scroll-mt-28 text-[clamp(32px,4vw,52px)] leading-[1] text-ink">
      {children}
    </h2>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5">
      <h3 className="text-[15.5px] font-semibold text-ink">{title}</h3>
      <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => <code className="rounded bg-white/[0.06] px-1 py-px font-mono text-[12.5px] text-ink">{children}</code>;

/** System diagram: who runs where, and what crosses each boundary. */
function Architecture() {
  const box = "fill-[var(--surface-1)] stroke-[var(--border-strong)]";
  return (
    <figure className="panel overflow-x-auto p-4 scroll-thin">
      <svg viewBox="0 0 1000 420" className="min-w-[760px]" role="img" aria-label="Architecture: the console and the 2009 portal iframe on the main thread, the engine in a Web Worker, and stateless API routes on the server">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--text-3)" />
          </marker>
        </defs>
        <rect x="10" y="10" width="610" height="400" rx="18" className="fill-transparent stroke-[var(--border)]" strokeDasharray="5 5" />
        <text x="30" y="38" className="fill-[var(--text-2)] text-[13px] font-semibold">Your browser tab</text>

        <rect x="30" y="60" width="270" height="150" rx="14" className={box} />
        <text x="48" y="88" className="fill-[var(--text-1)] text-[15px] font-semibold">Console UI (main thread)</text>
        <text x="48" y="112" className="fill-[var(--text-2)] text-[12px]">Replays real engine events at</text>
        <text x="48" y="130" className="fill-[var(--text-2)] text-[12px]">presentation speed; HITL card;</text>
        <text x="48" y="148" className="fill-[var(--text-2)] text-[12px]">Director Mode; flight recorder</text>

        <rect x="330" y="60" width="270" height="150" rx="14" className="fill-[color-mix(in_oklab,var(--amethyst-500)_14%,var(--surface-1))] stroke-[var(--amethyst-300)]" strokeOpacity="0.5" />
        <text x="348" y="88" className="fill-[var(--text-1)] text-[15px] font-semibold">Engine (Web Worker)</text>
        <text x="348" y="112" className="fill-[var(--text-2)] text-[12px]">8-node state machine, framework-free</text>
        <text x="348" y="130" className="fill-[var(--text-2)] text-[12px]">TypeScript; checkpoints after</text>
        <text x="348" y="148" className="fill-[var(--text-2)] text-[12px]">every node; hash-chained audit</text>

        <rect x="30" y="240" width="570" height="150" rx="14" className="fill-[#d4d0c8] stroke-[#3c5a8c]" />
        <rect x="30" y="240" width="570" height="26" rx="12" className="fill-[#0a246a]" />
        <text x="46" y="258" className="fill-white text-[12px] font-bold">OmniCorp portal, 2009 (same-origin iframe, plain HTML + JS)</text>
        <text x="46" y="292" className="fill-[#111] text-[12.5px]">The agent reads it through the distiller and acts through a narrow driver:</text>
        <text x="46" y="312" className="fill-[#111] text-[12.5px] font-mono">goto · distill · probe · fill · select · click · waitFor · readLedger</text>
        <text x="46" y="336" className="fill-[#333] text-[12px]">Driver calls cross from the worker to the main thread by message, against an allowlist.</text>

        <line x1="300" y1="135" x2="330" y2="135" stroke="var(--text-3)" markerEnd="url(#arr)" markerStart="url(#arr)" />
        <line x1="465" y1="210" x2="465" y2="240" stroke="var(--text-3)" markerEnd="url(#arr)" markerStart="url(#arr)" />

        <rect x="660" y="10" width="330" height="400" rx="18" className="fill-transparent stroke-[var(--border)]" strokeDasharray="5 5" />
        <text x="680" y="38" className="fill-[var(--text-2)] text-[13px] font-semibold">Server (Vercel functions, stateless)</text>
        {[
          ["/api/checkpoint/sign · /verify", "HMAC-SHA256 over the canonical state"],
          ["/api/llm/* (optional)", "Groq, spotlighted input, Zod output, cap"],
          ["/api/notify/slack (optional)", "Block Kit preview of an escalation"],
          ["/api/pipeline", "the same engine, headless, server-side"],
          ["/api/health · /api/benchmark", "mode badge; committed results"],
        ].map(([t, d], i) => (
          <g key={t}>
            <rect x="680" y={60 + i * 68} width="290" height="56" rx="12" className={box} />
            <text x="696" y={84 + i * 68} className="fill-[var(--text-1)] font-mono text-[12.5px]">
              {t}
            </text>
            <text x="696" y={102 + i * 68} className="fill-[var(--text-2)] text-[11.5px]">
              {d}
            </text>
          </g>
        ))}
        <line x1="600" y1="110" x2="680" y2="90" stroke="var(--agent)" strokeDasharray="4 4" markerEnd="url(#arr)" />
        <text x="604" y="84" className="fill-[var(--agent)] text-[10.5px]">sign at pause</text>
      </svg>
      <figcaption className="mt-3 text-[13px] text-ink-2">
        The same engine also runs headless in a Playwright runner and as an MCP server, so the browser demo, CI and an AI assistant all drive identical code.
      </figcaption>
    </figure>
  );
}

const DECISIONS: [string, string, string, string][] = [
  ["Where the engine runs", "Browser Web Worker, same code on server", "Server only", "$0, no timeouts, every visitor gets a real run"],
  ["Legacy portal", "Static HTML in a same-origin iframe", "React component; remote browser cloud", "Behaves like a separate app; same page for Playwright; free"],
  ["Page understanding", "Distilled accessibility tree", "Screenshots + vision model", "Faster, cheaper, deterministic, measurable"],
  ["Healing output", "Declarative TransformSpec", "LLM-generated code", "No code execution risk; auditable; testable"],
  ["Who supplies typed values", "Code, from the approved record (value binding)", "LLM fills values", "Removes the main prompt-injection impact path"],
  ["Escalation", "Hard policy rules first, calibrated confidence second", "Confidence only", "Money rules must not depend on a model score"],
  ["Checkpoint integrity", "HMAC-signed state hash", "Trust the client; database", "Stateless, $0, tamper-evident"],
  ["Audit", "Hash-chained log", "Plain log", "Tamper-evident and cheap to verify"],
  ["LLM", "Optional, server-side, capped", "Required LLM", "Demo always works; cost cannot run away"],
  ["Proof", "Seeded suites with baselines, results committed, CI drift check", "Hand-written numbers", "Every claim is reproducible"],
];

export default function HowItWorksPage() {
  return (
    <div className="relative min-h-dvh bg-bg">
      <div className="nebula" aria-hidden="true" />
      <SiteNav current="how" />
      <main className="relative z-10 mx-auto max-w-[1100px] px-5 pb-24 pt-32">
        <p className="eyebrow">How it works</p>
        <h1 className="display mt-4 text-[clamp(42px,6vw,84px)] leading-[0.95] text-ink">
          A flight recorder <span className="iridescent italic">for integrations.</span>
        </h1>
        <p className="mt-5 max-w-[760px] text-[16.5px] leading-relaxed text-ink-2">
          ForwardDeploy OS is an 8-node state machine. Each node reads the run state, writes its output and emits events; a checkpoint is taken after every node, and any node can stop the run. The interface replays those events, so every animation on this site is a real step the engine took.
        </p>
        <nav aria-label="On this page" className="mt-8 flex flex-wrap gap-2 text-[13px]">
          {[
            ["architecture", "Architecture"],
            ["nodes", "The 8 nodes"],
            ["healing", "Schema healing"],
            ["reconcile", "Reconciliation"],
            ["agent", "Browser agent"],
            ["security", "Security layers"],
            ["decisions", "Design decisions"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="chip hover:text-ink">
              {label}
            </a>
          ))}
        </nav>

        <section className="mt-14 space-y-5" aria-labelledby="architecture">
          <H2 id="architecture">Architecture</H2>
          <Architecture />
        </section>

        <section className="mt-16 space-y-5" aria-labelledby="nodes">
          <H2 id="nodes">The 8 nodes</H2>
          <ol className="grid gap-3 md:grid-cols-2">
            {([1, 2, 3, 4, 5, 6, 7, 8] as NodeId[]).map((n) => (
              <li key={n} className="panel flex gap-4 p-5">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line-strong font-mono text-[13px] font-semibold text-ink">{String(n).padStart(2, "0")}</span>
                <div>
                  <h3 className="text-[15.5px] font-semibold text-ink">{NODE_NAMES[n]}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{NODE_BLURBS[n]}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-16 space-y-5" aria-labelledby="healing">
          <H2 id="healing">Schema healing without generated code</H2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Match columns by name and by values">
              <p>
                Every source column is profiled: tokens from its header (with synonyms and compound words joined), and value fingerprints such as money with a currency suffix, dotted dates, or IBAN shapes. Each source and target pair gets a score of {MATCH_WEIGHTS.name} × name + {MATCH_WEIGHTS.value} × values + {MATCH_WEIGHTS.distribution} × distribution.
              </p>
              <p>
                The Hungarian algorithm picks the best one-to-one assignment. Pairs below {MAPPING_THRESHOLD} stay unmapped and are shown, never forced.
              </p>
            </Card>
            <Card title="A declarative TransformSpec">
              <p>
                The output is data, not code: which source column feeds which field, through which fixed normalizer (money, rate, date format, IBAN, ids). Nothing is evaluated, so there is nothing to inject into (rule S1).
              </p>
              <p>Dates whose day and month are both 12 or less are never guessed: the file waits for a person to choose day-first, month-first, or to ask the vendor.</p>
            </Card>
            <Card title="Five invariants before any row is used">
              <p>
                <Mono>ROW_COUNT_CONSERVED</Mono> <Mono>MONEY_SUM_CONSERVED</Mono> <Mono>PRIMARY_KEY_VALID</Mono> <Mono>DATES_IN_WINDOW</Mono> <Mono>IDEMPOTENT</Mono>. They run on the whole batch; rows only leave quarantine when all five pass.
              </p>
            </Card>
            <Card title="Property tests in your browser">
              <p>“Fuzz this transform” generates 300 random records with fast-check, renders them in the drifted formats the spec claims to read, heals them back, and requires an exact round trip with every invariant passing. A failure is shrunk to the smallest counterexample.</p>
            </Card>
          </div>
        </section>

        <section className="mt-16 space-y-5" aria-labelledby="reconcile">
          <H2 id="reconcile">Reconciliation, policy, and the human checkpoint</H2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Three documents, one verdict">
              <p>Each invoice is compared field by field across the PDF, the healed CSV row and the ERP purchase order. Disagreements are shown with their deltas.</p>
              <p>
                A logistic model over {FEATURE_NAMES.length} features ({FEATURE_NAMES.slice(0, 4).join(", ")}, …) turns the evidence into a calibrated probability. It is fitted on a seeded, labeled set and judged by Brier score and expected calibration error on held-out cases.
              </p>
            </Card>
            <Card title="Policy beats confidence (rule S3)">
              <p>
                Hard rules decide first: amount differs by more than {formatUsd(DEFAULT_POLICY.absToleranceCents)} or {(DEFAULT_POLICY.relTolerance * 100).toFixed(0)}%, payee not in the vendor master, unknown vendor, a security finding. Only then can confidence below {DEFAULT_POLICY.confidenceThreshold} add a reason to ask.
              </p>
              <p>
                When a person must decide, the run pauses. The server signs the canonical state with HMAC-SHA256; resuming requires the signature to verify against the state as it is now, so an edited checkpoint is rejected (try “Tamper with this checkpoint” in the console).
              </p>
            </Card>
          </div>
        </section>

        <section className="mt-16 space-y-5" aria-labelledby="agent">
          <H2 id="agent">The browser agent</H2>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="A distilled tree instead of HTML">
              <p>The distiller walks the live DOM and keeps only what a person could act on: one numbered line per field, button, tab or link, with its role, label, value and state. Hidden tab panels are kept and labeled, so the agent knows to open the tab.</p>
            </Card>
            <Card title="Selectors that heal by meaning">
              <p>
                Each target has a fingerprint recorded before the release. When its selector breaks, candidates are scored with weights label {SIMILARITY_WEIGHTS.label}, neighbors {SIMILARITY_WEIGHTS.neighbor}, role {SIMILARITY_WEIGHTS.role}, name {SIMILARITY_WEIGHTS.name}, input type {SIMILARITY_WEIGHTS.inputType}, position {SIMILARITY_WEIGHTS.ordinal}.
              </p>
              <p>
                At {DEFAULT_HEALING.healThreshold} or above, with a {DEFAULT_HEALING.minMargin} lead over the runner-up, it heals. Between {DEFAULT_HEALING.askThreshold} and {DEFAULT_HEALING.healThreshold} it asks a person. A label-only change must also be confirmed by a second signal. It never clicks a guess.
              </p>
            </Card>
            <Card title="Value binding">
              <p>
                Planners, deterministic or LLM, emit actions that reference fields by name, like <Mono>{`{ kind: "fill", valueRef: "payee_iban" }`}</Mono>. The executor binds the value from the approved record. A plan that carries a literal value is rejected by schema.
              </p>
            </Card>
            <Card title="Read before write">
              <p>Before posting, the agent reads the portal ledger for the invoice’s idempotency key. A replayed batch therefore prevents duplicates instead of posting them twice.</p>
            </Card>
          </div>
        </section>

        <section className="mt-16 space-y-5" aria-labelledby="security">
          <H2 id="security">Security layers</H2>
          <div className="overflow-x-auto rounded-2xl border border-line scroll-thin">
            <table className="w-full text-left text-[13.5px]">
              <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-2.5">Layer</th>
                  <th className="px-4 py-2.5">What it does</th>
                  <th className="px-4 py-2.5">Can be switched off?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink-2">
                {[
                  ["Normalization", "NFKC, reveal invisible characters, decode Unicode Tags, map look-alike letters, decode base64 and hex payloads", "In the playground"],
                  ["Injection scanner", "Rules on every text channel (INJ, ACT, OBF, HID families); hostile documents are quarantined at node 1", "In the playground"],
                  ["Spotlighting", "Untrusted text is fenced with a per-request nonce and datamarked before any model reads it", "In the playground"],
                  ["Value binding", "Models reference fields; code supplies values; literal values are rejected", "No"],
                  ["Policy gate", "Payee, vendor, amount and security rules send records to a person", "No"],
                  ["Tool boundary guard", "Checks every action's target, purpose, bound value and the payee IBAN against the vendor master", "Never: it is code, not a model"],
                  ["Canary + output validation", "A canary token in the system prompt and Zod schemas on every model answer", "No"],
                ].map(([a, b, c]) => (
                  <tr key={a}>
                    <td className="px-4 py-2.5 font-semibold text-ink">{a}</td>
                    <td className="px-4 py-2.5">{b}</td>
                    <td className="px-4 py-2.5">{c}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-16 space-y-5" aria-labelledby="decisions">
          <H2 id="decisions">Design decisions</H2>
          <div className="overflow-x-auto rounded-2xl border border-line scroll-thin">
            <table className="w-full min-w-[760px] text-left text-[13.5px]">
              <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-2.5">Decision</th>
                  <th className="px-4 py-2.5">Chosen</th>
                  <th className="px-4 py-2.5">Alternatives</th>
                  <th className="px-4 py-2.5">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink-2">
                {DECISIONS.map(([d, c, a, w]) => (
                  <tr key={d}>
                    <td className="px-4 py-2.5 font-semibold text-ink">{d}</td>
                    <td className="px-4 py-2.5 text-ink">{c}</td>
                    <td className="px-4 py-2.5">{a}</td>
                    <td className="px-4 py-2.5">{w}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-14 flex flex-wrap gap-3">
          <Link href="/console" className="btn btn-cyan">
            Open the console <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <Link href="/benchmarks" className="btn btn-glass">
            See the benchmarks
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
