"use client";
import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { Logo } from "@/components/ui/primitives";
import { useTheme } from "@/lib/theme";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/cn";

function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function SiteNav({ current }: { current?: "home" | "benchmarks" | "how" }) {
  const [theme, toggle] = useTheme();
  const link = (href: string, label: string, active: boolean) => (
    <Link href={href} className={cn("rounded-full px-3 py-1.5 text-[13.5px] font-semibold transition-colors duration-150", active ? "bg-white/[0.08] text-ink" : "text-ink-2 hover:text-ink")} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3">
      <nav aria-label="Main" className="glass glass-rim pointer-events-auto flex w-full max-w-[1180px] items-center gap-1 rounded-full py-1.5 pl-4 pr-1.5">
        <Link href="/" aria-label="ForwardDeploy OS home" className="mr-2 rounded-full">
          <Logo />
        </Link>
        <div className="hidden items-center gap-0.5 md:flex">
          {link("/how-it-works", "How it works", current === "how")}
          {link("/benchmarks", "Benchmarks", current === "benchmarks")}
          {link("/console?scenario=sandbox", "Your data", false)}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <a href={SITE.repo} className="btn btn-ghost btn-sm hidden sm:inline-flex" rel="noopener noreferrer" target="_blank" aria-label="Source code on GitHub">
            <GithubMark />
          </a>
          <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
            {theme === "dark" ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
          <Link href="/console" className="btn btn-cyan btn-sm">
            Open the console
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-line">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-5 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo />
          <p className="mt-2 text-[13px] text-ink-2">
            Built by {SITE.author}. All data on this site is synthetic.
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] font-semibold">
          <li>
            <a className="text-ink-2 hover:text-ink" href={SITE.github} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </li>
          <li>
            <a className="text-ink-2 hover:text-ink" href={SITE.portfolio} target="_blank" rel="noopener noreferrer">
              Portfolio
            </a>
          </li>
          <li>
            <a className="text-ink-2 hover:text-ink" href={SITE.linkedin} target="_blank" rel="noopener noreferrer">
              LinkedIn
            </a>
          </li>
          <li>
            <Link className="text-ink-2 hover:text-ink" href="/how-it-works">
              How it works
            </Link>
          </li>
          <li>
            <Link className="text-ink-2 hover:text-ink" href="/legacy/omnicorp/index.html">
              The 2009 portal
            </Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
