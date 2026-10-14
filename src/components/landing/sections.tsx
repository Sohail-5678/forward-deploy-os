import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Ban, BadgeCheck, Binary, Clapperboard, Eye, FileWarning, FlaskConical, Lock, Play, ScanSearch, ShieldCheck, Sparkles, Wand2 } from "lucide-react";
import { SCENARIOS, ERP_PURCHASE_ORDERS, renderCsv } from "@/engine/data/scenarios";
import { parseCsv } from "@/engine/etl/csv";
import { CONTRACT_V1 } from "@/engine/etl/contract";
import { NODE_BLURBS, NODE_NAMES } from "@/engine/agent/runtime";
import { formatUsd } from "@/engine/format";
import type { NodeId } from "@/engine/types";
import { headline, pct, RESULTS } from "@/lib/results";
import { headlineTiles } from "@/lib/tiles";
import { StatTile } from "@/components/bench/BenchTiles";
import { SCENES } from "@/components/director/scenes";
import { DirectorPlayer, PlayDemoButton } from "./DirectorPlayer";
import { HeroShader } from "./HeroShader";
import { cn } from "@/lib/cn";

const CONTRACT_KEYS = new Set(CONTRACT_V1.fields.map((f) => f.key));

/** The drifted Apex export, rendered by the same generator that wrote the sample file. */
function driftedExport(rows = 3) {
  const t = parseCsv(renderCsv(SCENARIOS[1].csv[0]), "apex");
  const drifted = t.headers.filter((h) => !CONTRACT_KEYS.has(h));
  // Contract fields that no longer appear by name were renamed; any other unknown header is new.
  const renamed = CONTRACT_V1.fields.filter((f) => !t.headers.includes(f.key)).length;
  return { name: SCENARIOS[1].csv[0].name, headers: t.headers, rows: t.rows.slice(0, rows), drifted, renamed, added: drifted.length - renamed, contractSize: CONTRACT_V1.fields.length };
}

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("eyebrow flex items-center gap-2", className)}>{children}</p>;
}

function SectionHead({ eyebrow, title, children }: { eyebrow: string; title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="max-w-[760px]">
      <Eyebrow>
        <span className="h-px w-8 bg-gradient-to-r from-transparent to-agent" aria-hidden="true" />
        {eyebrow}
      </Eyebrow>
      <h2 className="display mt-4 text-[clamp(36px,4.6vw,62px)] leading-[0.98] text-ink">{title}</h2>
      {children && <p className="mt-4 text-[16.5px] leading-relaxed text-ink-2">{children}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ hero

function Poster() {
  const csv = driftedExport(4);
  const cols = csv.headers.slice(0, 6);
  return (
    <div className="grid min-h-[300px] grid-cols-1 gap-3 bg-[#07060b]/85 p-4 sm:grid-cols-[170px_minmax(0,1fr)] sm:min-h-[360px]">
      <ol className="hidden flex-col gap-1.5 sm:flex" aria-label="Pipeline preview">
        {([1, 2, 3, 4, 5, 6, 7, 8] as NodeId[]).map((n) => (
          <li key={n} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5 text-[11px]", n === 2 ? "border-agent/60 text-ink shadow-[0_0_24px_-8px_var(--agent)]" : n === 1 ? "border-ok/40 text-ink-2" : "border-line text-ink-3")}>
            <span className="font-mono text-[10px]">{String(n).padStart(2, "0")}</span>
            <span className="truncate">{NODE_NAMES[n]}</span>
          </li>
        ))}
      </ol>
      <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-black/30">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="truncate font-mono text-[11px] text-ink-2">{csv.name}</span>
          <span className="chip chip-danger">{csv.renamed} COLUMNS RENAMED</span>
        </div>
        <div className="overflow-hidden">
          <table className="w-full text-left font-mono text-[11px]">
            <thead>
              <tr>
                {cols.map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                    {h}
                    {!CONTRACT_KEYS.has(h) && <span className="ml-1.5 rounded bg-[color-mix(in_oklab,var(--danger)_18%,transparent)] px-1 py-px text-[9px] font-bold text-danger">DRIFT</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {csv.rows.map((r, i) => (
                <tr key={i} className="border-t border-white/[0.04]">
                  {cols.map((h) => (
                    <td key={h} className="whitespace-nowrap px-3 py-1.5 text-ink-2">
                      {r[h]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="sm:col-span-2">
        <div className="glass mx-auto flex max-w-[620px] items-center gap-3 rounded-xl px-4 py-2.5">
          <span className="font-mono text-[10.5px] text-agent">01</span>
          <p className="text-[13px] leading-snug text-ink">{SCENES[0].caption([])}</p>
        </div>
      </div>
    </div>
  );
}

const FLOATERS = [
  { Icon: Sparkles, text: "Mapping proved by 5 invariants", tone: "text-lilac", pos: "left-[-2%] top-[8%]", delay: "0s" },
  { Icon: BadgeCheck, text: "Checkpoint signed · HMAC-SHA256", tone: "text-ok", pos: "right-[-6%] top-[42%]", delay: "-2.5s" },
  { Icon: Wand2, text: "Selector healed by meaning", tone: "text-agent", pos: "left-[-4%] bottom-[22%]", delay: "-4s" },
  { Icon: Ban, text: "Unknown payee: blocked", tone: "text-danger", pos: "right-[4%] bottom-[14%]", delay: "-1.2s" },
];

export function Hero() {
  return (
    <section data-theme="dark" className="relative isolate overflow-hidden bg-[#050505]" aria-labelledby="hero-title">
      <div className="nebula" aria-hidden="true" />
      <HeroShader className="absolute inset-0 -z-0 h-full w-full opacity-90" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,#050505)]" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="relative z-10 mx-auto max-w-[1180px] px-5 pt-32 sm:pt-40">
        <Eyebrow className="text-ink-2">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-agent shadow-[0_0_10px_var(--agent)]" aria-hidden="true" />
          Self-healing ETL · browser agent · signed human checkpoints · $0 to run
        </Eyebrow>
        <h1 id="hero-title" className="display mt-6 max-w-[1100px] text-[clamp(42px,7.2vw,104px)] leading-[0.93] text-ink">
          Messy enterprise data in. Clean records into a <span className="italic text-lavender">20-year-old portal</span> out. Nothing moves money <span className="iridescent italic">without proof.</span>
        </h1>
        <p className="mt-7 max-w-[660px] text-[17px] leading-relaxed text-ink-2">
          ForwardDeploy OS heals vendor exports that changed overnight with a declarative mapping it proves safe, stops for a person when money is at stake, and drives a 2009 ERP portal through a compact text map of the page. Every step is signed, hash-chained and replayable, and it all runs in your browser.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <PlayDemoButton className="btn btn-cyan h-12 px-6 text-[15px]">
            <Play size={16} fill="currentColor" aria-hidden="true" /> Play the 90-second demo
          </PlayDemoButton>
          <Link href="/console" className="btn btn-glass h-12 px-6 text-[15px]">
            Open the console <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <ul className="mt-8 flex flex-wrap gap-2 text-[12px]">
          {["Deterministic by default", "LLM optional, Zod-validated", "Engine runs in a Web Worker", "All data synthetic"].map((t) => (
            <li key={t} className="chip">
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative z-10 mx-auto max-w-[1080px] px-5 pb-24 pt-16 sm:pb-32">
        {FLOATERS.map((f) => (
          <div key={f.text} className={cn("glass glass-rim absolute z-20 hidden items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-semibold text-ink lg:flex", "animate-[float_8s_ease-in-out_infinite] motion-reduce:animate-none", f.pos)} style={{ animationDelay: f.delay }} aria-hidden="true">
            <f.Icon size={14} className={f.tone} />
            {f.text}
          </div>
        ))}
        <DirectorPlayer poster={<Poster />} />
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ problem

export function Problem() {
  const csv = driftedExport(6);
  const gf = SCENARIOS[2].pdfs[0];
  const po = ERP_PURCHASE_ORDERS.find((p) => p.po_number === gf.invoice.po_number);
  const delta = po ? gf.invoice.gross_amount_cents - po.authorized_cents : 0;
  const rel = po && po.authorized_cents ? delta / po.authorized_cents : 0;
  return (
    <section className="relative z-10 mx-auto max-w-[1180px] px-5 py-20 sm:py-24" aria-labelledby="problem-title">
      <SectionHead eyebrow="The problem, in three artifacts" title={<span id="problem-title">Every integration breaks in the same three places.</span>}>
        The vendor changes its export, the documents disagree about money, and the system of record is a portal nobody can change. These are the real inputs the engine runs on.
      </SectionHead>
      <div className="mt-12 grid gap-4 lg:grid-cols-12">
        <article className="panel overflow-hidden p-5 lg:col-span-7">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-semibold text-ink">1. The export changed overnight</h3>
            <span className="chip chip-danger">
              <FileWarning size={12} aria-hidden="true" /> {csv.renamed} of {csv.contractSize} renamed{csv.added > 0 ? ` · ${csv.added} new` : ""}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-ink-2">{SCENARIOS[1].story}</p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-[var(--surface-0)] scroll-thin" tabIndex={0} role="region" aria-label="Drifted export, first rows">
            <table className="w-full text-left font-mono text-[11.5px]">
              <thead>
                <tr>
                  {csv.headers.map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 font-medium text-ink">
                      {h}
                      {!CONTRACT_KEYS.has(h) && <span className="ml-1.5 rounded bg-[color-mix(in_oklab,var(--danger)_16%,transparent)] px-1 py-px text-[9px] font-bold text-danger">DRIFT</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csv.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    {csv.headers.map((h) => (
                      <td key={h} className="whitespace-nowrap px-3 py-1.5 text-ink-2">
                        {r[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel relative overflow-hidden p-5 lg:col-span-5">
          <h3 className="text-[15px] font-semibold text-ink">2. Two documents disagree</h3>
          <p className="mt-1 text-[13px] text-ink-2">The PDF bills a surcharge the purchase order never authorized.</p>
          <div className="relative mt-5 h-[270px] [perspective:1200px]">
            <div className="absolute left-0 top-0 w-[72%] rotate-[-3deg] rounded-lg bg-[#fbfaf7] p-4 text-[#1b1b1b] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]">
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#666]">Invoice · PDF</div>
              <div className="mt-1 font-serif text-[15px] font-semibold">{gf.vendorName}</div>
              <div className="font-mono text-[10px] text-[#555]">
                {gf.invoice.invoice_number} · {gf.invoice.po_number}
              </div>
              <ul className="mt-2 space-y-1 text-[10.5px]">
                {gf.lines.map((l) => (
                  <li key={l.description} className={cn("flex justify-between gap-2", l.surcharge && "rounded bg-[#fff1d6] px-1 font-semibold text-[#8a4b00]")}>
                    <span className="min-w-0 truncate">{l.description}</span>
                    <span className="shrink-0 font-mono">{formatUsd(l.cents)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex justify-between border-t border-[#ddd] pt-1.5 text-[11px] font-bold">
                <span>Total</span>
                <span className="font-mono">{formatUsd(gf.invoice.gross_amount_cents)}</span>
              </div>
            </div>
            {po && (
              <div className="absolute bottom-0 right-0 w-[58%] rotate-[2.5deg] rounded-lg border border-[#3c5a8c] bg-[#ece9d8] p-3 text-black shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)]" style={{ fontFamily: "Tahoma, Verdana, sans-serif" }}>
                <div className="bg-gradient-to-r from-[#0a246a] to-[#a6caf0] px-1.5 py-0.5 text-[9px] font-bold text-white">ERP · Purchase Order</div>
                <div className="mt-1.5 text-[11px] font-bold">{po.po_number}</div>
                <div className="text-[10px]">{po.description}</div>
                <div className="mt-1.5 flex justify-between text-[11px]">
                  <span>Authorized</span>
                  <span className="font-mono font-bold">{formatUsd(po.authorized_cents)}</span>
                </div>
              </div>
            )}
            <div className="absolute bottom-3 left-2 z-10 rounded-full border border-warn/60 bg-[color-mix(in_oklab,var(--warn)_18%,var(--surface-1))] px-3 py-1 font-mono text-[12px] font-bold text-warn shadow-[0_0_30px_-6px_var(--warn)]">
              {formatUsd(delta, { sign: true })} · {(rel * 100).toFixed(1)}%
            </div>
          </div>
        </article>

        <article className="panel overflow-hidden p-5 lg:col-span-12">
          <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div>
              <h3 className="text-[15px] font-semibold text-ink">3. The system of record is from 2009</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
                Tables for layout, no API, ids that change with every release, a session modal that appears at random. The agent never sees this page as HTML: it reads a numbered text map of the interactive elements, then heals any selector the release broke, by meaning rather than position.
              </p>
              <Link href="/legacy/omnicorp/index.html" className="btn btn-glass btn-sm mt-4">
                Open the portal yourself <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
            <div className="overflow-hidden rounded-[10px] border border-[#3c5a8c] bg-[#d4d0c8] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]">
              <div className="flex items-center gap-2 bg-gradient-to-r from-[#0a246a] via-[#2a5bb8] to-[#a6caf0] px-2 py-1 text-[11px] font-bold text-white" style={{ fontFamily: "Tahoma, Verdana, sans-serif" }}>
                <span className="truncate">OmniCorp Enterprise Resource Portal — Microsoft Internet Explorer</span>
              </div>
              <Image src="/portal-2009.png" alt="The OmniCorp 2009 portal's invoice entry page, captured with Playwright" width={980} height={400} className="h-auto w-full" />
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ use it

export function UseIt() {
  return (
    <section className="relative z-10 mx-auto max-w-[1180px] px-5 py-20 sm:py-24" aria-labelledby="use-title">
      <SectionHead eyebrow="Use it now" title={<span id="use-title">Watch it, drive it, or point it at your own files.</span>}>
        Nothing to install. The engine runs in a Web Worker in this tab; the server only signs checkpoints and, if you turn it on, proxies an optional model.
      </SectionHead>
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        <div className="glass glass-rim relative flex flex-col overflow-hidden rounded-[24px] p-6">
          <Clapperboard size={22} className="text-agent" aria-hidden="true" />
          <h3 className="display mt-4 text-[30px] text-ink">Watch the demo</h3>
          <p className="mt-2 flex-1 text-[14px] leading-relaxed text-ink-2">Ninety seconds, six scenes, captions. The real engine and the real portal on Scenario 5, with a scripted operator making the human decisions. Take control at any moment.</p>
          <PlayDemoButton className="btn btn-cyan mt-6 self-start">
            <Play size={15} fill="currentColor" aria-hidden="true" /> Play
          </PlayDemoButton>
        </div>
        <div className="panel flex flex-col p-6">
          <Eye size={22} className="text-lilac" aria-hidden="true" />
          <h3 className="display mt-4 text-[30px] text-ink">Run a scenario</h3>
          <ul className="mt-3 flex-1 space-y-1">
            {([1, 2, 3, 4, 5] as const).map((id) => (
              <li key={id}>
                <Link href={`/console?scenario=${id}`} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.05]">
                  <span className="font-mono text-[12px] text-agent">0{id}</span>
                  <span className="flex-1 text-[14px] text-ink">{SCENARIOS[id].title}</span>
                  <ArrowRight size={14} className="text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel flex flex-col p-6">
          <FlaskConical size={22} className="text-ok" aria-hidden="true" />
          <h3 className="display mt-4 text-[30px] text-ink">Bring your own data</h3>
          <p className="mt-2 flex-1 text-[14px] leading-relaxed text-ink-2">Drop a CSV, JSON, PDF or text file, edit the target schema and the policy thresholds, and run it. Download the healed CSV, the transform spec and the audit log. Files stay in your browser unless you switch on LLM assist.</p>
          <Link href="/console?scenario=sandbox" className="btn btn-glass mt-6 self-start">
            Open the sandbox <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ how it works

const LLM_NODES: Partial<Record<NodeId, string>> = { 1: "LLM-assisted extraction optional", 3: "LLM mapping proposals optional", 7: "LLM planner optional" };

export function HowItWorks() {
  return (
    <section className="relative z-10 py-20 sm:py-24" aria-labelledby="how-title">
      <div className="mx-auto max-w-[1180px] px-5">
        <SectionHead eyebrow="How it works" title={<span id="how-title">Eight nodes. Each one can stop the run.</span>}>
          A small state machine with a checkpoint after every node. The deterministic path is the default; a model is only ever an optional helper whose answers are validated before use.
        </SectionHead>
      </div>
      <ol className="mx-auto mt-12 flex max-w-[1180px] snap-x gap-3 overflow-x-auto px-5 pb-4 scroll-thin lg:grid lg:grid-cols-4 lg:overflow-visible">
        {([1, 2, 3, 4, 5, 6, 7, 8] as NodeId[]).map((n) => (
          <li key={n} className="panel relative min-w-[250px] snap-start p-5">
            <div className="flex items-center justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-line-strong font-mono text-[12px] font-semibold text-ink">{String(n).padStart(2, "0")}</span>
              <span className={cn("chip", LLM_NODES[n] ? "chip-violet" : "chip-agent")}>{LLM_NODES[n] ? "Deterministic + optional LLM" : "Deterministic"}</span>
            </div>
            <h3 className="mt-4 text-[16px] font-semibold text-ink">{NODE_NAMES[n]}</h3>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{NODE_BLURBS[n]}</p>
          </li>
        ))}
      </ol>
      <div className="mx-auto max-w-[1180px] px-5">
        <Link href="/how-it-works" className="btn btn-glass mt-6">
          Read the architecture deep dive <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ proof

export function Proof() {
  return (
    <section className="relative z-10 mx-auto max-w-[1180px] px-5 py-20 sm:py-24" aria-labelledby="proof-title">
      <SectionHead eyebrow="Proof" title={<span id="proof-title">Measured, seeded, and re-runnable in your browser.</span>}>
        Every number here is read from <code className="font-mono text-[14px] text-agent">benchmarks/results.json</code>, produced by <code className="font-mono text-[14px]">npm run bench</code> with seed {RESULTS.seed}. Each tile names its case count and links to the suite, including the cases it gets wrong.
      </SectionHead>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {headlineTiles().map((t) => (
          <StatTile key={t.id} tile={t} />
        ))}
      </div>
      <Link href="/benchmarks" className="btn btn-glass mt-8">
        See every suite, and re-run it live <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </section>
  );
}

// ------------------------------------------------------------------ security

export function SecurityStory() {
  const h = headline();
  const steps = [
    {
      Icon: Eye,
      title: "It hides instructions where people can’t see them",
      body: "White 1-point text and invisible Unicode Tag characters tell any model reading the PDF to change the payee and auto-approve.",
      visual: (
        <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
          {["⟨U+E0053⟩", "⟨U+E0059⟩", "⟨U+E0053⟩", "⟨ZWSP⟩", "white text 1pt"].map((t, i) => (
            <span key={i} className="rounded-md border border-danger/40 bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] px-1.5 py-0.5 text-danger">
              {t}
            </span>
          ))}
        </div>
      ),
    },
    {
      Icon: ScanSearch,
      title: "Node 1 reveals it and quarantines the document",
      body: "Text is normalized, hidden characters are decoded and shown, and the scanner matches rules on every channel. The document never reaches reconciliation.",
      visual: (
        <div className="flex flex-wrap gap-1.5">
          {["INJ-002", "ACT-002", "ACT-003", "ACT-004", "OBF-002", "HID-001"].map((r) => (
            <span key={r} className="chip chip-danger">
              {r}
            </span>
          ))}
        </div>
      ),
    },
    {
      Icon: Binary,
      title: "Even a hijacked model can’t type a value",
      body: "Planners may only reference field names. Values are bound from the approved record in code, and a plan carrying a literal value is rejected.",
      visual: <code className="block rounded-lg border border-line bg-[var(--surface-0)] px-3 py-2 font-mono text-[11.5px] text-ink-2">{`{ kind: "fill", valueRef: "payee_iban" }`}</code>,
    },
    {
      Icon: Lock,
      title: "The guard checks every action, and can’t be switched off",
      body: "Before any keystroke reaches the portal, code checks the target, the bound value, and that the payee IBAN belongs to the vendor in the vendor master.",
      visual: (
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="chip chip-danger">
            <Ban size={11} aria-hidden="true" /> BLOCKED
          </span>
          <span className="text-ink-2">payee not in vendor master</span>
        </div>
      ),
    },
  ];
  return (
    <section className="relative z-10 mx-auto max-w-[1180px] px-5 py-20 sm:py-24" aria-labelledby="sec-title">
      <SectionHead eyebrow="Security story" title={<span id="sec-title">The invoice that tries to rob you.</span>}>
        Prompt injection is treated as a when, not an if. Detection is one layer; what actually protects the money is that no model is ever allowed to supply a value or approve anything.
      </SectionHead>
      <ol className="mt-12 grid gap-4 md:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title} className="panel relative overflow-hidden p-6">
            <span className="display absolute right-5 top-3 text-[64px] leading-none text-white/[0.04]" aria-hidden="true">
              {i + 1}
            </span>
            <s.Icon size={20} className="text-agent" aria-hidden="true" />
            <h3 className="mt-3 text-[17px] font-semibold text-ink">{s.title}</h3>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">{s.body}</p>
            <div className="mt-4">{s.visual}</div>
          </li>
        ))}
      </ol>
      <div className="glass glass-rim mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl px-5 py-4 text-[14px]">
        <span className="flex items-center gap-2 font-semibold text-ink">
          <ShieldCheck size={16} className="text-ok" aria-hidden="true" /> Measured
        </span>
        <span className="text-ink-2">
          Guard blocked <strong className="text-ink">{pct(h.guardBlocked)}</strong> of {h.guardPlans ?? "n/a"} malicious plans.
        </span>
        <span className="text-ink-2">
          Scanner alone: <strong className="text-ink">{pct(h.detectionRate)}</strong> detection at <strong className="text-ink">{pct(h.falsePositiveRate)}</strong> false positives, including attack styles it was not tuned on.
        </span>
        <Link href="/benchmarks#guard" className="ml-auto text-agent hover:underline">
          verify
        </Link>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ playbook

export function Playbook() {
  const cols = [
    { when: "Week 1", title: "Discovery", items: ["Shadow the AP team for two days.", "Collect 50 real exports and every failure from the last quarter.", "Map failure modes to the 8 nodes; agree on the contract with finance."] },
    { when: "Week 2", title: "Pilot", items: ["One vendor, one portal flow.", "A human approves every posting; the agent only prepares.", "Measure mapping accuracy, escalations and minutes saved per invoice."] },
    { when: "Weeks 3 to 4", title: "Widen", items: ["Auto-post only above the calibrated threshold, never past a policy rule.", "Add vendors one at a time; replay last month's batches first.", "Weekly review of every escalation with the AP lead."] },
    { when: "Always", title: "Success metrics", items: ["Touchless rate.", "Escalation rate, and how many escalations were right.", "Error rate after posting (target: zero duplicates).", "Hours saved per week."] },
  ];
  return (
    <section className="relative z-10 mx-auto max-w-[1180px] px-5 py-20 sm:py-24" aria-labelledby="fde-title">
      <SectionHead eyebrow="FDE playbook" title={<span id="fde-title">How I’d roll this out at a real customer.</span>}>
        The engine is the easy part. Trust is earned one vendor at a time, with a person approving everything until the numbers say otherwise.
      </SectionHead>
      <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cols.map((c) => (
          <li key={c.title} className="panel p-5">
            <span className="font-mono text-[11px] text-agent">{c.when}</span>
            <h3 className="display mt-2 text-[26px] text-ink">{c.title}</h3>
            <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-2">
              {c.items.map((it) => (
                <li key={it} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-lilac" aria-hidden="true" />
                  {it}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ClosingCta() {
  return (
    <section className="relative z-10 mx-auto max-w-[1180px] px-5 pb-28" aria-label="Get started">
      <div className="glass glass-rim glass-sheen relative overflow-hidden rounded-[32px] px-6 py-14 text-center sm:px-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_0%,rgba(110,43,208,0.35),transparent_70%),radial-gradient(40%_60%_at_80%_100%,rgba(0,229,255,0.14),transparent_70%)]" aria-hidden="true" />
        <h2 className="display relative text-[clamp(34px,4.6vw,58px)] leading-[1] text-ink">
          See it break, heal, <span className="iridescent italic">and prove it.</span>
        </h2>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <PlayDemoButton className="btn btn-cyan h-12 px-6 text-[15px]">
            <Play size={16} fill="currentColor" aria-hidden="true" /> Play the 90-second demo
          </PlayDemoButton>
          <Link href="/console" className="btn btn-glass h-12 px-6 text-[15px]">
            Open the console
          </Link>
        </div>
      </div>
    </section>
  );
}
