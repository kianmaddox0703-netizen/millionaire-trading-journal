// UI smoke test: signs in as the seed user and loads every page, failing on errors.
import { chromium } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.SHOTS ?? "";
const pages = (process.env.PAGES ?? "/dashboard,/trades,/trades/new,/strategies,/market,/calendar,/reviews,/mistakes,/psychology,/performance,/settings").split(",");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
page.on("response", (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.url()}`));
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', process.env.SEED_EMAIL ?? "demo@mtj.local");
await page.fill('input[name="password"]', process.env.SEED_PASSWORD ?? "demo-password-123");
await Promise.all([page.waitForURL("**/dashboard"), page.click("button:has-text('Sign in')")]);
let failed = 0;
for (const p of pages) {
  const res = await page.goto(BASE + p, { waitUntil: "networkidle" });
  const status = res?.status();
  const bad = status !== 200 || (await page.locator("text=/Unhandled Runtime Error|Application error/").count()) > 0;
  console.log(`${bad ? "FAIL" : "ok  "} ${status} ${p}`);
  if (bad) failed++;
  if (OUT) await page.screenshot({ path: `${OUT}/${p.replace(/\//g, "_") || "root"}.png`, fullPage: true });
}
if (errors.length) console.log(errors.slice(0, 20).join("\n"));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
