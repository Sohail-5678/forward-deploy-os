/**
 * Generates the two images the site uses, from the running app (no stock images):
 *   public/portal-2009.png  the OmniCorp portal's invoice entry page (980x400)
 *   public/og.png           Open Graph card: the console mid-run, title and pitch (1200x630)
 *
 * Usage: start the app (npm run dev or npm start), then
 *   npm run screenshots -- http://localhost:3000
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import { PORTAL_DEMO_LOGIN } from "../src/engine/config";

const BASE = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const OUT = join(process.cwd(), "public");

async function main() {
  const browser = await chromium.launch();
  try {
    // 1) The 2009 portal, logged on, on the invoice entry page.
    const portal = await browser.newPage({ viewport: { width: 980, height: 660 }, deviceScaleFactor: 1 });
    await portal.goto(`${BASE}/legacy/omnicorp/index.html?chaos=off`);
    await portal.fill("#username", PORTAL_DEMO_LOGIN.username);
    await portal.fill("#password", PORTAL_DEMO_LOGIN.password);
    await portal.click("#btn_logon");
    await portal.waitForLoadState("load");
    await portal.goto(`${BASE}/legacy/omnicorp/invoice-entry.html`);
    await portal.waitForLoadState("load");
    // The page content ends around 400px; crop the empty canvas below it.
    await writeFile(join(OUT, "portal-2009.png"), await portal.screenshot({ type: "png", clip: { x: 0, y: 0, width: 980, height: 400 } }));
    console.log("wrote public/portal-2009.png");

    // 2) The console mid-run: Scenario 2 deep-linked to its HITL pause.
    const consolePage = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
    await consolePage.goto(`${BASE}/console?scenario=2&step=5`);
    await consolePage.getByText("Human decision", { exact: false }).first().waitFor({ timeout: 60_000 });
    await consolePage.waitForTimeout(600);
    const shot = await consolePage.screenshot({ type: "png" });

    // Compose the card: the real screenshot, the title and the one-line pitch.
    const card = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    const img = `data:image/png;base64,${shot.toString("base64")}`;
    await card.setContent(`<!doctype html><html><head><style>
      body{margin:0;width:1200px;height:630px;overflow:hidden;background:#050505;font-family:Georgia,'Times New Roman',serif;color:#eeeaf6}
      .shot{position:absolute;right:-180px;top:70px;width:900px;border-radius:18px;transform:perspective(1600px) rotateY(-14deg) rotateX(6deg);box-shadow:0 40px 120px -20px rgba(0,229,255,.35),0 0 0 1px rgba(255,255,255,.14)}
      .glow{position:absolute;inset:0;background:radial-gradient(600px 400px at 15% 20%,rgba(59,10,107,.75),transparent 70%),radial-gradient(500px 360px at 80% 90%,rgba(0,229,255,.18),transparent 70%)}
      .t{position:absolute;left:64px;top:96px;width:520px}
      .k{font:600 14px/1 system-ui,sans-serif;letter-spacing:.28em;text-transform:uppercase;color:#00e5ff}
      h1{font-weight:400;font-size:64px;line-height:1;margin:22px 0 0;letter-spacing:-.02em}
      em{background:linear-gradient(100deg,#b88bff,#00e5ff);-webkit-background-clip:text;background-clip:text;color:transparent}
      p{font:400 21px/1.45 system-ui,sans-serif;color:#a9a1bc;margin:26px 0 0}
    </style></head><body><div class="glow"></div><img class="shot" src="${img}"/><div class="t"><div class="k">ForwardDeploy OS</div><h1>Nothing moves money <em>without proof.</em></h1><p>Heal drifted vendor exports, stop for a human when money is at stake, and drive a 2009 portal. Runs at $0.</p></div></body></html>`);
    await writeFile(join(OUT, "og.png"), await card.screenshot({ type: "png" }));
    console.log("wrote public/og.png");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
