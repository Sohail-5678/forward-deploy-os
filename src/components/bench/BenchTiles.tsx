import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Tile } from "@/lib/tiles";
import { cn } from "@/lib/cn";

export { headlineTiles, type Tile } from "@/lib/tiles";

export function StatTile({ tile, compact }: { tile: Tile; compact?: boolean }) {
  return (
    <div className={cn("group relative overflow-hidden rounded-2xl border border-line bg-[var(--surface-1)]/80 p-4 transition-[transform,border-color] duration-200 hover:border-line-strong", compact && "p-3")}>
      <div className={cn("pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-2xl", tile.tone === "cyan" ? "bg-[var(--cyan)]/15" : tile.tone === "ok" ? "bg-[var(--ok)]/12" : "bg-[var(--amethyst-500)]/25")} aria-hidden="true" />
      <div className={cn("display tabular leading-none text-ink", compact ? "text-[34px]" : "text-[46px]")}>{tile.value}</div>
      <div className="mt-1 text-[13px] font-semibold text-ink">{tile.label}</div>
      <p className="mt-1.5 text-[12px] leading-snug text-ink-2">{tile.detail}</p>
      <div className="mt-3 flex items-center justify-between font-mono text-[10.5px] text-ink-3">
        <span>
          {tile.cases ?? "?"} cases · seed {tile.seed ?? "?"}
        </span>
        <Link href={`/benchmarks#${tile.id}`} className="inline-flex items-center gap-0.5 text-agent hover:underline">
          verify <ArrowUpRight size={11} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
