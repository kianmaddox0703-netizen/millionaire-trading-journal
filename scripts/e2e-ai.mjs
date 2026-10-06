// End-to-end checks for the AI and market-data features against a running server, signed in as the seed user.
//
// MODE=unconfigured  server started without ANTHROPIC_API_KEY or MARKET_DATA_PROVIDER: every feature shows its
//                    "not configured" state, nothing is simulated, the AI endpoints refuse.
// MODE=rejected      server started with a deliberately invalid ANTHROPIC_API_KEY and MARKET_DATA_PROVIDER=oanda with a
//                    dummy OANDA_API_TOKEN (pass the same values in E2E_ANTHROPIC_KEY / E2E_OANDA_TOKEN). The AI requests
//                    really go to api.anthropic.com and are rejected there; OANDA is unreachable from this sandbox. The
//                    script checks every feature reports that failure plainly and that neither credential leaks.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MODE = process.env.MODE ?? "unconfigured";
const ROOT = path.resolve(import.meta.dirname, "..");
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
const step = (s) => console.log("•", s);
const visible = (sel, msg, timeout = 15000) => page.locator(sel).first().waitFor({ timeout }).catch(() => assert.fail(msg ?? `not visible: ${sel}`));
const secrets = [process.env.E2E_ANTHROPIC_KEY, process.env.E2E_OANDA_TOKEN].filter(Boolean);
const noLeak = async (where) => { const html = await page.content(); for (const s of secrets) assert.ok(!html.includes(s), `credential leaked on ${where}`); };

const anon = await browser.newContext();
step("AI endpoints require sign-in");
assert.equal((await anon.request.post(`${BASE}/api/ai/coach`, { data: { message: "hi" } })).status(), 401);
assert.equal((await anon.request.post(`${BASE}/api/ai/screenshot/analyze`, { data: { imageId: "x" } })).status(), 401);
await anon.close();

step("sign in as the seed user");
await page.goto(`${BASE}/login`);
await page.fill('input[name="email"]', process.env.SEED_EMAIL ?? "demo@mtj.local");
await page.fill('input[name="password"]', process.env.SEED_PASSWORD ?? "demo-password-123");
await Promise.all([page.waitForURL("**/dashboard"), page.click("button:has-text('Sign in')")]);
// a closed trade of the seed user that has a screenshot (read-only look into the server's database)
const Database = (await import("better-sqlite3")).default;
const sdb = new Database(process.env.E2E_DB ?? path.join(ROOT, "data", "journal.db"), { readonly: true });
const tradeRow = sdb.prepare(`select t.id, (select count(*) from trade_images i where i.trade_id = t.id) as imgs from trades t join users u on u.id = t.user_id
  where u.email = ? and t.status = 'closed' order by imgs > 0 desc, t.opened_at desc limit 1`).get(process.env.SEED_EMAIL ?? "demo@mtj.local");
sdb.close();
assert.ok(tradeRow, "seed data has a closed trade");
const withImage = { id: tradeRow.id, images: Array(tradeRow.imgs).fill(0) };
const tradeUrl = `${BASE}/trades/${withImage.id}`;

if (MODE === "unconfigured") {
  step("trade page shows calm not-configured states and no AI buttons");
  await page.goto(tradeUrl);
  await visible("text=Not configured: add ANTHROPIC_API_KEY on the server to write AI trade reviews");
  await visible("text=Not configured: add ANTHROPIC_API_KEY on the server to analyze screenshots");
  await visible("text=Not configured: set MARKET_DATA_PROVIDER");
  assert.equal(await page.locator("button:has-text('Generate review')").count(), 0);
  assert.equal(await page.locator("button:has-text('Analyze')").count(), 0);
  assert.equal(await page.locator("a:has-text('Ask coach')").count(), 0, "no coach link without a key");

  step("coach page explains the key and has no input");
  await page.goto(`${BASE}/coach`);
  await visible("text=Not configured: add ANTHROPIC_API_KEY on the server to use the coach");
  assert.equal(await page.locator("#coach-input").count(), 0);
  assert.equal((await page.request.post(`${BASE}/api/ai/coach`, { data: { message: "Why am I losing money?" } })).status(), 503);

  step("weekly and monthly reviews show the AI summary card as not configured");
  await page.goto(`${BASE}/reviews/week/2026-03-02`);
  await visible("text=Not configured: add ANTHROPIC_API_KEY on the server to write AI summaries");
  await page.goto(`${BASE}/reviews/month/2026-03`);
  await visible("text=Not configured: add ANTHROPIC_API_KEY on the server to write AI summaries");

  step("market analysis says no provider is configured and offers no fetch");
  await page.goto(`${BASE}/market`);
  await visible("text=No market-data provider is configured");
  assert.equal(await page.locator("button:has-text('Fetch context for trades without it')").count(), 0);

  step("trade form has no Read screenshot button without a key");
  await page.goto(`${BASE}/trades/new`);
  await page.setInputFiles('input[type="file"]', { name: "chart.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "chart.png")) });
  await visible("img[alt*='chart.png'], img[src^='blob:']", "staged image preview");
  assert.equal(await page.locator("button:has-text('Read screenshot')").count(), 0);

  step("settings show AI and market data as not configured");
  await page.goto(`${BASE}/settings`);
  await visible("text=Not configured. Add ANTHROPIC_API_KEY on the server to enable screenshot analysis");
  await page.goto(`${BASE}/settings/integrations`);
  await visible("text=need ANTHROPIC_API_KEY on the server. Nothing is simulated without it.");
} else {
  const rejected = "text=/API key was rejected/";

  step("AI trade review: the real API rejects the key and the card says so");
  await page.goto(tradeUrl);
  await page.click("button:has-text('Generate review')");
  await visible(rejected, "review error shown", 90000);
  await noLeak("trade page");

  if ((withImage.images?.length ?? 0) > 0) {
    step("screenshot analysis: rejected key is reported on the image");
    await page.goto(tradeUrl);
    await page.locator("button[data-screenshot-analyze]").first().click();
    await visible(rejected, "screenshot error shown", 90000);
  } else console.log("  (no seed trade with images; screenshot analysis skipped)");

  step("market context: OANDA is configured but unreachable here, and the card says so");
  await page.goto(tradeUrl);
  const refresh = page.locator("button:has-text('Fetch context'), button:has-text('Refresh'), button:has-text('Retry'), button:has-text('Fetch now'), button:has-text('Try again')").first();
  await refresh.click();
  await visible("text=/Couldn't reach OANDA|blocked before OANDA answered|OANDA rejected the API token/", "market context error shown", 60000);
  await noLeak("trade page after market refresh");

  step("weekly AI summary reports the rejected key");
  await page.goto(`${BASE}/reviews/week/2026-03-02`);
  await page.click("button:has-text('Generate AI summary')");
  await visible(rejected, "weekly summary error shown", 90000);

  step("coach: the question is sent, the API rejects the key, the chat shows the error");
  await page.goto(`${BASE}/coach`);
  await page.fill("#coach-input", "Why am I losing money?");
  await page.click("button:has-text('Send')");
  await visible("section[aria-label='Coach chat'] p[role=alert]:has-text('API key was rejected')", "coach error shown", 90000);
  await noLeak("coach");

  step("quick entry: Read screenshot reports the rejected key and fills nothing");
  await page.goto(`${BASE}/trades/new`);
  await page.setInputFiles('input[type="file"]', { name: "chart.png", mimeType: "image/png", buffer: fs.readFileSync(path.join(ROOT, "scripts", "fixtures", "chart.png")) });
  await page.click("button:has-text('Read screenshot')");
  await visible(rejected, "quick entry error shown", 90000);
  assert.equal(await page.inputValue('input[placeholder="1.08250"]'), "", "entry stays empty");

  step("market analysis: fetch reports the unreachable provider");
  await page.goto(`${BASE}/market`);
  await visible("text=OANDA (practice)");
  await page.click("button:has-text('Fetch context for trades without it')");
  await visible("text=/Couldn't reach OANDA|blocked before OANDA answered|OANDA rejected the API token/", "fetch error shown", 90000);
  await noLeak("market");
}

assert.deepEqual(errors, [], "no browser errors");
await browser.close();
console.log(`ai e2e (${MODE}) passed`);
