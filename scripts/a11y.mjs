// Accessibility audit (axe-core, WCAG 2.1 A/AA) of every page as the seed user.
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
const anon = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
await page.fill('input[name="email"]', process.env.SEED_EMAIL ?? "demo@mtj.local");
await page.fill('input[name="password"]', process.env.SEED_PASSWORD ?? "demo-password-123");
await Promise.all([page.waitForURL("**/dashboard"), page.click("button:has-text('Sign in')")]);
const firstTrade = await page.evaluate(async () => (await (await fetch("/api/export/trades?format=json")).json()).trades[0].id);
const pages = (process.env.PAGES ?? `/dashboard,/trades,/trades/new,/trades/${firstTrade},/trades/${firstTrade}/edit,/trades/import,/strategies,/strategies/knowledge,/strategies/new,/market,/calendar,/reviews,/mistakes,/psychology,/performance,/settings,/settings/integrations`).split(",");
let total = 0;
const report = (url, res) => {
  const v = res.violations.filter((x) => ["serious", "critical"].includes(x.impact) || process.env.ALL);
  total += v.length;
  console.log(`${v.length ? "✗" : "ok"} ${url}${v.length ? "" : ""}`);
  for (const x of v) console.log(`   [${x.impact}] ${x.id}: ${x.help} (${x.nodes.length}) e.g. ${x.nodes.slice(0, 2).map((n) => n.target.join(" ") + (process.env.DETAIL ? " :: " + n.failureSummary.replace(/\s+/g, " ").slice(0, 160) : "")).join(" | ")}`);
};
report("/login", anon);
for (const url of pages) {
  await page.goto(BASE + url);
  await page.waitForLoadState("networkidle");
  report(url, await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze());
}
await browser.close();
console.log(total ? `${total} serious/critical issue types` : "no serious or critical issues");
process.exit(total ? 1 : 0);
