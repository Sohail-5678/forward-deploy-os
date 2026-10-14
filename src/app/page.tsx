import { SiteFooter, SiteNav } from "@/components/landing/SiteChrome";
import { ClosingCta, Hero, HowItWorks, Playbook, Problem, Proof, SecurityStory, UseIt } from "@/components/landing/sections";

export default function Home() {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg">
      <SiteNav current="home" />
      <main>
        <Hero />
        <div className="relative">
          <div className="pointer-events-none absolute inset-0 blueprint opacity-60 [mask-image:linear-gradient(180deg,transparent,#000_8%,#000_92%,transparent)]" aria-hidden="true" />
          <Problem />
          <UseIt />
          <HowItWorks />
          <Proof />
          <SecurityStory />
          <Playbook />
          <ClosingCta />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
