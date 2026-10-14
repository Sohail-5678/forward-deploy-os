import type { Metadata, Viewport } from "next";
import { Instrument_Serif, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const instrument = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: { default: "ForwardDeploy OS: heal messy data, drive the legacy portal, prove every step", template: "%s · ForwardDeploy OS" },
  description:
    "Messy enterprise data in, clean records into a 2009 portal out, nothing moves money without proof. A self-healing ETL and browser agent with human-in-the-loop checkpoints, running at $0.",
  applicationName: "ForwardDeploy OS",
  authors: [{ name: "Ameer Sohail Shaik", url: "https://ameer-shaik.vercel.app/" }],
  openGraph: {
    type: "website",
    title: "ForwardDeploy OS",
    description: "Heal drifted vendor exports, stop for a human when money is at stake, and drive a 2009 portal through a compact text map of the page.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "ForwardDeploy OS console mid-run" }],
  },
  twitter: { card: "summary_large_image", title: "ForwardDeploy OS", images: ["/og.png"] },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#050505",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

/** Applies the saved theme before first paint (static string, nonce'd for the CSP). */
const THEME_INIT = `try{var t=localStorage.getItem('fdos-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" data-theme="dark" className={`${instrument.variable} ${jakarta.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
