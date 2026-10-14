"use client";
import { useState, type DragEvent } from "react";
import { Download, FileJson, FileSpreadsheet, FileText, KeyRound, Lock, Play, Plus, RotateCcw, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useConsole, useConsoleState } from "./context";
import { Drawer, Segmented, StatusChip } from "@/components/ui/primitives";
import { CONTRACT_V1, FIELD_LABELS, PORTAL_REQUIRED, cloneContract, validateContract } from "@/engine/etl/contract";
import { contractSchema } from "@/engine/schemas";
import { DEFAULT_HEALING, DEFAULT_POLICY } from "@/engine/config";
import type { ContractDef, ContractField, FieldKind } from "@/engine/types";
import { MAX_UPLOADS, sniffUpload } from "@/lib/sniff";
import type { SandboxUpload } from "@/lib/worker-protocol";
import { downloadAudit, downloadHealed } from "@/lib/exports";
import { downloadText } from "@/lib/download";
import { cn } from "@/lib/cn";

type Tab = "files" | "contract" | "policy" | "model";

const KIND_LABEL: Record<FieldKind, string> = {
  vendorId: "Vendor ID (V-1234)",
  customerId: "Customer ID (C-1234)",
  poNumber: "PO number (PO-12345)",
  invoiceNumber: "Invoice number",
  date: "Date",
  money: "Money",
  rate: "Rate / percent",
  int: "Whole number",
  iban: "IBAN",
  text: "Free text",
};

const SAMPLE = { path: "/samples/sandbox/cobalt_ridge_export_drifted.csv", name: "cobalt_ridge_export_drifted.csv" };

function kindIcon(kind: SandboxUpload["kind"]) {
  if (kind === "pdf") return <FileText size={14} aria-hidden="true" />;
  if (kind === "json") return <FileJson size={14} aria-hidden="true" />;
  if (kind === "csv") return <FileSpreadsheet size={14} aria-hidden="true" />;
  return <FileText size={14} aria-hidden="true" />;
}

function sizeOf(u: SandboxUpload): string {
  const n = u.bytes?.byteLength ?? new TextEncoder().encode(u.text ?? "").byteLength;
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

export function SandboxDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("files");
  return (
    <Drawer open={open} onClose={onClose} title="Use your own data" width="max-w-[680px]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Sandbox section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "files", label: "Files" },
            { value: "contract", label: "Contract" },
            { value: "policy", label: "Policy" },
            { value: "model", label: "Model & privacy" },
          ]}
        />
        <StatusChip status="info" word="Synthetic or your own test data only" />
      </div>
      {tab === "files" && <FilesTab onClose={onClose} />}
      {tab === "contract" && <ContractTab />}
      {tab === "policy" && <PolicyTab />}
      {tab === "model" && <ModelTab />}
    </Drawer>
  );
}

// ------------------------------------------------------------------ files
function FilesTab({ onClose }: { onClose: () => void }) {
  const c = useConsole();
  const uploads = useConsoleState((s) => s.uploads);
  const scenario = useConsoleState((s) => s.scenario);
  const running = useConsoleState((s) => s.running);
  const graph = useConsoleState((s) => s.graph);
  const [errors, setErrors] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState("");

  const add = async (files: File[]) => {
    const errs: string[] = [];
    const next = [...uploads];
    for (const f of files) {
      if (next.length >= MAX_UPLOADS) {
        errs.push(`${f.name}: at most ${MAX_UPLOADS} files per run.`);
        continue;
      }
      if (f.size > 2 * 1024 * 1024) {
        errs.push(`${f.name} is larger than 2 MB.`);
        continue;
      }
      const r = sniffUpload(f.name, new Uint8Array(await f.arrayBuffer()));
      if (r.ok) next.push(r.upload);
      else errs.push(`${f.name} ${r.reason}.`);
    }
    setErrors(errs);
    if (scenario !== "sandbox") c.selectScenario("sandbox");
    c.setUploads(next);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void add([...e.dataTransfer.files]);
  };

  const addSample = async () => {
    const res = await fetch(SAMPLE.path);
    if (!res.ok) return setErrors(["The sample file could not be loaded."]);
    const r = sniffUpload(SAMPLE.name, new Uint8Array(await res.arrayBuffer()));
    if (!r.ok) return setErrors([`${SAMPLE.name} ${r.reason}.`]);
    if (scenario !== "sandbox") c.selectScenario("sandbox");
    c.setUploads([...uploads.filter((u) => u.name !== SAMPLE.name), r.upload]);
  };

  const addNote = () => {
    const text = note.trim();
    if (!text) return;
    const n = uploads.filter((u) => u.kind === "txt").length + 1;
    if (scenario !== "sandbox") c.selectScenario("sandbox");
    c.setUploads([...uploads, { name: `note-${n}.txt`, kind: "txt", text: text.slice(0, 50_000) }]);
    setNote("");
  };

  const runIt = () => {
    if (scenario !== "sandbox") c.selectScenario("sandbox");
    onClose();
    void c.run();
  };

  const sandboxDone = scenario === "sandbox" && graph?.status === "COMPLETED";

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed px-6 py-8 text-center transition-colors duration-150", drag ? "border-agent bg-agent/5" : "border-line-strong hover:border-lilac/60")}
      >
        <Upload size={22} className="text-agent" aria-hidden="true" />
        <span className="text-[14px] font-semibold text-ink">Drop CSV, JSON, PDF or text files</span>
        <span className="text-[12px] text-ink-3">Up to {MAX_UPLOADS} files, 2 MB each. The type is read from the file’s bytes, not its extension.</span>
        <input
          type="file"
          multiple
          accept=".csv,.json,.pdf,.txt,text/csv,application/json,application/pdf,text/plain"
          className="sr-only"
          onChange={(e) => {
            const el = e.currentTarget;
            void add([...(el.files ?? [])]).then(() => {
              el.value = "";
            });
          }}
        />
      </label>

      {errors.length > 0 && (
        <ul className="space-y-1" role="alert">
          {errors.map((e) => (
            <li key={e} className="text-[12.5px] text-danger">
              {e}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-glass btn-sm" onClick={() => void addSample()}>
          <FileSpreadsheet size={14} aria-hidden="true" /> Load a sample drifted export
        </button>
        <a className="btn btn-ghost btn-sm" href={SAMPLE.path} download>
          <Download size={14} aria-hidden="true" /> Download the sample
        </a>
      </div>

      <div>
        <div className="eyebrow mb-2">Files in this run</div>
        {uploads.length === 0 ? (
          <p className="text-[13px] text-ink-3">No files yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {uploads.map((u, i) => (
              <li key={`${u.name}-${i}`} className="flex items-center gap-3 px-3 py-2">
                <span className="text-lilac">{kindIcon(u.kind)}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink">{u.name}</span>
                <span className="chip">{u.kind.toUpperCase()}</span>
                <span className="w-16 text-right font-mono text-[11px] text-ink-3">{sizeOf(u)}</span>
                <button type="button" className="btn btn-ghost btn-xs" aria-label={`Remove ${u.name}`} disabled={running} onClick={() => c.setUploads(uploads.filter((_, j) => j !== i))}>
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor="sandbox-note" className="eyebrow mb-2 block">
          Add a note or an email body
        </label>
        <textarea
          id="sandbox-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          maxLength={50_000}
          placeholder="Paste text that should travel with the batch. It is scanned for prompt injection like any document."
          className="w-full rounded-xl border border-line-strong bg-white/[0.03] px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-agent"
        />
        <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={addNote} disabled={!note.trim()}>
          <Plus size={14} aria-hidden="true" /> Add as a text file
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button type="button" className="btn btn-cyan" onClick={runIt} disabled={running || uploads.length === 0}>
          <Play size={15} aria-hidden="true" /> Run on my files
        </button>
        {sandboxDone && graph && (
          <>
            {graph.input.files.map((f) => (
              <button key={f.id} type="button" className="btn btn-glass btn-sm" onClick={() => downloadHealed(graph, f.id)}>
                <Download size={14} aria-hidden="true" /> {f.name.replace(/\.(csv|json)$/i, "")}.healed.csv
              </button>
            ))}
            <button type="button" className="btn btn-glass btn-sm" onClick={() => downloadAudit(graph)}>
              <Download size={14} aria-hidden="true" /> Audit log
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const f = c.exportRun();
                if (f) downloadText(`${f.runId}.flight-recorder.json`, JSON.stringify(f, null, 2), "application/json");
              }}
            >
              <Download size={14} aria-hidden="true" /> Flight recorder
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ contract
function ContractTab() {
  const c = useConsole();
  const scenario = useConsoleState((s) => s.scenario);
  const contract = useConsoleState((s) => s.config.contract);
  const running = useConsoleState((s) => s.running);
  // An invalid edit stays local (with its errors) until it is fixed; valid edits go straight to the run config.
  const [local, setLocal] = useState<{ draft: ContractDef; errors: string[] } | null>(null);
  const [aliasText, setAliasText] = useState<Record<number, string>>({});
  const draft = local?.draft ?? contract;
  const errors = local?.errors ?? [];
  const editable = scenario === "sandbox" && !running;

  const apply = (next: ContractDef) => {
    const v = validateContract(next);
    const z = contractSchema.safeParse(next);
    const errs = [...v.errors, ...(z.success ? [] : z.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`))];
    if (errs.length === 0) {
      setLocal(null);
      c.setContract(next);
    } else setLocal({ draft: next, errors: errs });
  };
  const parseAliases = (t: string) =>
    t
      .split(",")
      .map((a) => a.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 12);

  const patch = (i: number, p: Partial<ContractField>) => apply({ ...draft, fields: draft.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const remove = (i: number) => {
    setAliasText({});
    apply({ ...draft, fields: draft.fields.filter((_, j) => j !== i) });
  };
  const addField = () => {
    let n = 1;
    while (draft.fields.some((f) => f.key === `custom_field_${n}`)) n++;
    apply({ ...draft, fields: [...draft.fields, { key: `custom_field_${n}`, kind: "text", required: false, aliases: [], description: "" }] });
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-ink-2">
        The contract is the target schema the healer maps every export into. Rename columns, change kinds, add custom fields or teach it extra words (aliases). Fields the portal posts can be renamed but not removed.
        {scenario !== "sandbox" && " The five scenarios use contract v1; switch to the sandbox to edit it."}
      </p>
      <div className="overflow-x-auto rounded-xl border border-line scroll-thin">
        <table className="w-full min-w-[580px] text-left text-[12.5px]">
          <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-ink-3">
            <tr>
              <th className="px-3 py-2 font-semibold">Column</th>
              <th className="px-3 py-2 font-semibold">Kind</th>
              <th className="px-3 py-2 font-semibold">Aliases</th>
              <th className="px-3 py-2 font-semibold">Required</th>
              <th className="px-2 py-2" aria-label="Remove" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {draft.fields.map((f, i) => {
              const locked = !!f.canonical && PORTAL_REQUIRED.includes(f.canonical);
              return (
                <tr key={i}>
                  <td className="px-3 py-1.5">
                    <input aria-label={`Column name ${i + 1}`} value={f.key} disabled={!editable} onChange={(e) => patch(i, { key: e.target.value })} className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 font-mono text-ink outline-none focus:border-agent disabled:opacity-80" />
                    <div className="px-1.5 text-[10.5px] text-ink-3">{f.canonical ? `binds to ${FIELD_LABELS[f.canonical]}` : "custom field"}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <select aria-label={`Kind of ${f.key}`} value={f.kind} disabled={!editable || !!f.canonical} onChange={(e) => patch(i, { kind: e.target.value as FieldKind })} className="rounded-md border border-line-strong bg-[var(--surface-2)] px-1.5 py-1 text-ink disabled:opacity-70">
                      {(Object.keys(KIND_LABEL) as FieldKind[]).map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      aria-label={`Aliases for ${f.key}`}
                      value={aliasText[i] ?? f.aliases.join(", ")}
                      disabled={!editable}
                      placeholder="supplier, vendor no"
                      onChange={(e) => {
                        setAliasText((t) => ({ ...t, [i]: e.target.value }));
                        patch(i, { aliases: parseAliases(e.target.value) });
                      }}
                      onBlur={() => setAliasText((t) => Object.fromEntries(Object.entries(t).filter(([k]) => Number(k) !== i)))}
                      className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-ink outline-none placeholder:text-ink-3 focus:border-agent"
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" aria-label={`${f.key} required`} checked={f.required} disabled={!editable || locked} onChange={(e) => patch(i, { required: e.target.checked })} className="h-4 w-4 accent-[var(--agent)]" />
                  </td>
                  <td className="px-2 py-1.5">
                    <button type="button" className="btn btn-ghost btn-xs" disabled={!editable || locked} title={locked ? "The portal cannot post without this field" : "Remove field"} aria-label={`Remove ${f.key}`} onClick={() => remove(i)}>
                      {locked ? <Lock size={12} aria-hidden="true" /> : <Trash2 size={12} aria-hidden="true" />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {errors.length > 0 ? (
        <ul className="space-y-1" role="alert">
          {errors.map((e) => (
            <li key={e} className="text-[12.5px] text-danger">
              {e}
            </li>
          ))}
        </ul>
      ) : (
        editable && <p className="text-[12px] text-ok">Contract is valid and applies to the next run.</p>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn btn-glass btn-sm" onClick={addField} disabled={!editable || draft.fields.length >= 40}>
          <Plus size={14} aria-hidden="true" /> Add a custom field
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
            setAliasText({});
            apply(cloneContract(CONTRACT_V1));
          }} disabled={!editable}>
          <RotateCcw size={14} aria-hidden="true" /> Reset to contract v1
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ policy
function NumberRow({ id, label, help, value, onChange, min, max, step, suffix }: { id: string; label: string; help: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix?: string }) {
  // While focused, keep the raw text so "0." or an empty field can be typed through.
  const [text, setText] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line py-3 last:border-b-0">
      <div>
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
        </label>
        <p className="text-[12px] text-ink-3">{help}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text ?? String(value)}
          min={min}
          max={max}
          step={step}
          onFocus={() => setText(String(value))}
          onBlur={() => setText(null)}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className="w-24 rounded-lg border border-line-strong bg-white/[0.03] px-2 py-1.5 text-right font-mono text-[13px] tabular text-ink outline-none focus:border-agent"
        />
        {suffix && <span className="w-6 font-mono text-[12px] text-ink-3">{suffix}</span>}
      </div>
    </div>
  );
}

function PolicyTab() {
  const c = useConsole();
  const policy = useConsoleState((s) => s.config.policy);
  const healing = useConsoleState((s) => s.config.healing);
  const running = useConsoleState((s) => s.running);
  const setPolicy = (p: Partial<typeof policy>) => c.updateConfig((cfg) => ({ ...cfg, policy: { ...cfg.policy, ...p } }));
  const setHealing = (h: Partial<typeof healing>) =>
    c.updateConfig((cfg) => {
      const next = { ...cfg.healing, ...h };
      // Keep the ask band below the auto-heal threshold.
      if (next.askThreshold > next.healThreshold) next.askThreshold = next.healThreshold;
      return { ...cfg, healing: next };
    });
  return (
    <div className={cn(running && "pointer-events-none opacity-60")}>
      <p className="mb-2 text-[13px] text-ink-2">Policy rules decide when a run must stop for a human. They are code, and they win over any confidence score (rule S3). Changes apply to the next run.</p>
      <NumberRow id="abs" label="Absolute amount tolerance" help="AMOUNT_DELTA_ABS fires when the invoice differs from the PO by more than this." value={policy.absToleranceCents / 100} onChange={(v) => setPolicy({ absToleranceCents: Math.round(v * 100) })} min={0} max={1_000_000} step={50} suffix="$" />
      <NumberRow id="rel" label="Relative amount tolerance" help="AMOUNT_DELTA_REL fires above this percentage difference." value={Math.round(policy.relTolerance * 1000) / 10} onChange={(v) => setPolicy({ relTolerance: v / 100 })} min={0} max={100} step={0.5} suffix="%" />
      <NumberRow id="conf" label="Confidence threshold" help="LOW_CONFIDENCE fires below this calibrated probability." value={policy.confidenceThreshold} onChange={(v) => setPolicy({ confidenceThreshold: v })} min={0} max={1} step={0.01} />
      <NumberRow id="heal" label="Selector auto-heal threshold" help="A broken selector heals on its own at or above this similarity." value={healing.healThreshold} onChange={(v) => setHealing({ healThreshold: v })} min={0.5} max={1} step={0.01} />
      <NumberRow id="ask" label="Selector ask threshold" help="Between this and the auto-heal threshold, a person picks the element." value={healing.askThreshold} onChange={(v) => setHealing({ askThreshold: v })} min={0.3} max={1} step={0.01} />
      <button
        type="button"
        className="btn btn-ghost btn-sm mt-3"
        onClick={() =>
          c.updateConfig((cfg) => ({ ...cfg, policy: { ...DEFAULT_POLICY }, healing: { ...DEFAULT_HEALING } }))
        }
      >
        <RotateCcw size={14} aria-hidden="true" /> Reset to defaults
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ model & privacy
function ModelTab() {
  const c = useConsole();
  const health = useConsoleState((s) => s.health);
  const mode = useConsoleState((s) => s.config.mode);
  const byok = useConsoleState((s) => s.byokActive);
  const running = useConsoleState((s) => s.running);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const llmAvailable = !!health?.llm.configured || byok;

  const applyKey = async () => {
    const r = await c.setByok(key.trim());
    setKey("");
    setMsg(r.active ? "Key held in memory for this tab." : "That does not look like a Groq key (gsk_...).");
  };

  return (
    <div className="space-y-5">
      <div>
        <div className="eyebrow mb-2">Engine mode</div>
        <Segmented
          label="Engine mode"
          value={mode}
          onChange={(m) => c.updateConfig((cfg) => ({ ...cfg, mode: m === "llm" && llmAvailable ? "llm" : "deterministic" }))}
          options={[
            { value: "deterministic", label: "Deterministic" },
            { value: "llm", label: "LLM-assisted", title: llmAvailable ? undefined : "Needs a server key or your own Groq key" },
          ]}
        />
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          {health === undefined
            ? "Checking the server…"
            : health === null
              ? "The server could not be reached; the engine runs deterministically."
              : health.llm.configured
                ? `The server has a Groq key (model ${health.model}); ${health.llm.usedToday} of ${health.llm.dailyCap} shared calls used today.`
                : "This deployment has no server-side model key. Every feature works deterministically; add your own Groq key to try LLM-assisted mode."}
          {disabledReason(running)}
        </p>
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center gap-2">
          <KeyRound size={15} className="text-lilac" aria-hidden="true" />
          <h3 className="text-[14px] font-semibold text-ink">Bring your own Groq key (optional)</h3>
          {byok && <StatusChip status="done" word="KEY ACTIVE" />}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
          The key stays in this tab’s memory inside the engine worker. It is sent only with requests to this site’s own <code className="font-mono">/api/llm/*</code> routes, which pass it to Groq and never store or log it. Reloading the page forgets it, and calls made with your key do not count against the shared daily cap.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void applyKey();
          }}
        >
          <label htmlFor="byok" className="sr-only">
            Groq API key
          </label>
          <input id="byok" type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} placeholder="gsk_…" className="min-w-0 flex-1 rounded-lg border border-line-strong bg-white/[0.03] px-3 py-1.5 font-mono text-[13px] text-ink outline-none focus:border-agent" />
          <button type="submit" className="btn btn-glass btn-sm" disabled={!key.trim()}>
            Use key
          </button>
          {byok && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                void c.setByok(null).then(() => {
                  setMsg("Key forgotten.");
                  c.updateConfig((cfg) => ({ ...cfg, mode: health?.llm.configured ? cfg.mode : "deterministic" }));
                })
              }
            >
              Forget
            </button>
          )}
        </form>
        {msg && (
          <p className="mt-2 text-[12px] text-ink-2" role="status">
            {msg}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-line p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-ok" aria-hidden="true" />
          <h3 className="text-[14px] font-semibold text-ink">What leaves your browser</h3>
        </div>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-ink-2">
          <li>The engine runs in a Web Worker in this tab. Parsing, healing, reconciliation, the scanner and the guard never call a server.</li>
          <li>When a run pauses for a human, the paused run state (including the records under review) is sent to this site’s <code className="font-mono">/api/checkpoint/sign</code> and <code className="font-mono">/verify</code> so the server can sign it with HMAC-SHA256. Nothing is stored server-side.</li>
          <li>
            In LLM-assisted mode only, and only for what the deterministic engine could not resolve: the names of columns it could not map, with up to 5 sample values each; up to 12,000 characters of text from a PDF whose fields it could not all find; and, when the LLM planner is on, the distilled portal page. These go to <code className="font-mono">/api/llm/*</code> and on to Groq. Document text is fenced and marked as data, and every answer is validated with Zod before use.
          </li>
          <li>The site has no analytics, no cookies and no user database. The API rate limiter counts requests per hashed IP address for two minutes. Use synthetic data or data you are allowed to share.</li>
        </ul>
      </div>
    </div>
  );
}

function disabledReason(running: boolean): string {
  return running ? " Pause the run to change the mode." : "";
}
