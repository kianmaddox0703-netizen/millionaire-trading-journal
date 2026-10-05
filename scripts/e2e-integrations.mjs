// End-to-end integration flows against a running server:
// CSV import with duplicates → MT5 report import → TradingView webhook → MT5 bridge (with the test double) → links on the trade page.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ROOT = path.resolve(import.meta.dirname, "..");
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && errors.push(m.text()));
const step = (s) => console.log("•", s);
const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

step("register a fresh user");
await page.goto(`${BASE}/register`);
await page.fill('input[name="email"]', `int-${Date.now()}@test.local`);
await page.fill('input[name="password"]', "correct-horse-battery");
await Promise.all([page.waitForURL("**/dashboard"), page.click("button:has-text('Create account')")]);

step("CSV import: preview, column mapping, import");
const csv = [
  "Ticket;Open Time;Close Time;Symbol;Side;Lots;Entry Price;Exit Price;Stop Loss;Take Profit;Profit;Commission;Swap",
  "1001;2026-04-06 08:30;2026-04-06 12:00;EURUSD;buy;1;1,0825;1,0845;1,0815;1,0855;200;-7;0",
  "1002;2026-04-07 14:00;2026-04-07 15:00;GBPJPY;sell;0,5;190,50;190,80;190,80;189,90;-100;-3,5;0",
  "1003;2026-04-08 09:00;2026-04-08 11:00;XAUUSD;buy;0,1;2350,5;2360,5;2345,5;;100;-1;0",
].join("\n");
await page.goto(`${BASE}/trades/import`);
await page.setInputFiles('input[type="file"]', { name: "journal.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await page.waitForSelector("text=3 new");
assert.equal(await page.locator("label:has-text('Ticket / position ID') select").inputValue(), "0", "ticket auto-mapped");
assert.ok(await page.locator("text=1.0825").first().isVisible(), "European decimals parsed");
await shot("import-preview");
await page.click("button:has-text('Import 3 new')");
await page.waitForSelector("text=Import finished: 3 created");

step("re-importing the same file finds duplicates; merge one");
await page.setInputFiles('input[type="file"]', { name: "journal.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await page.waitForSelector("text=3 possible duplicates");
await page.selectOption('select[aria-label="Action for row 1"]', "merge");
await page.click("button:has-text('merge 1')");
await page.waitForSelector("text=0 created, 1 merged into existing trades, 2 skipped");

step("MT5 HTML report (UTF-16) import");
const html = fs.readFileSync(path.join(ROOT, "tests/fixtures/mt5-report.html"), "utf8");
await page.setInputFiles('input[type="file"]', { name: "ReportHistory-12345678.html", mimeType: "text/html", buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, "utf16le")]) });
await page.waitForSelector("text=MT5 trade history report detected: 3 positions.");
assert.equal(await page.locator("label:has-text('Times in the file are in') select").inputValue(), "BROKER_NY7");
await page.click("button:has-text('Import 3 new')");
await page.waitForSelector("text=Import finished: 3 created");
await page.goto(`${BASE}/trades`);
assert.equal(await page.locator("tbody tr").count(), 6);

step("TradingView: create webhook URL and receive an alert");
await page.goto(`${BASE}/settings/integrations`);
await page.click("button:has-text('Create webhook URL')");
const hookUrl = (await page.locator("pre code").filter({ hasText: "/api/webhooks/tradingview/" }).textContent()).trim();
assert.match(hookUrl, /\/api\/webhooks\/tradingview\/[A-Za-z0-9_-]{40,}$/);
const hookPath = new URL(hookUrl).pathname;
const post = (body, type = "application/json") => fetch(BASE + hookPath, { method: "POST", headers: { "Content-Type": type }, body });
assert.equal((await post(JSON.stringify({ symbol: "OANDA:EURUSD", timeframe: "240", price: 1.0824, side: "long", setup: "Pullback to AOI", time: "2026-04-06T08:20:00Z", message: "4H trend up, AOI retest" }))).status, 200);
assert.equal((await post("GBPJPY crossing 190.5", "text/plain")).status, 200);
assert.equal((await fetch(BASE + "/api/webhooks/tradingview/" + "x".repeat(43), { method: "POST", body: "{}" })).status, 404, "unknown token");
assert.equal((await post("x".repeat(20_000))).status, 413, "oversized body");
await page.reload();
await page.waitForSelector("text=4H trend up, AOI retest");
assert.ok(await page.locator("td:has-text('Pullback to AOI') ~ td a").first().isVisible(), "alert auto-linked to the EURUSD trade");
await shot("integrations");

step("alert shows on the trade; unlink and relink");
await page.locator("td:has-text('Pullback to AOI') ~ td a").first().click();
await page.waitForSelector("text=Auto-linked");
await page.click("button:has-text('Unlink')");
await page.waitForSelector("text=No TradingView alert is linked to this trade.");
await page.selectOption('select[aria-label="Alert to link"]', { index: 1 });
await page.click("button:has-text('Link'):not(:has-text('another'))");
await page.waitForSelector("text=Linked by you");
await shot("trade-alerts");

step("MT5 bridge: create key, run the bridge script against the test double");
await page.goto(`${BASE}/settings/integrations`);
await page.fill("label:has-text('Label') input", "Test PC");
await page.click("button:has-text('Create API key')");
const cmds = await page.locator("pre code").filter({ hasText: "MTJ_KEY=" }).textContent();
const key = /MTJ_KEY=(mtj_[A-Za-z0-9_-]+)/.exec(cmds)[1];
assert.equal((await fetch(`${BASE}/api/ingest/mt5`, { method: "POST", headers: { Authorization: "Bearer mtj_wrong" }, body: "{}" })).status, 401);
assert.equal((await fetch(`${BASE}/api/ingest/mt5`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: '{"deals":"nope"}' })).status, 400);
const env = { ...process.env, PYTHONPATH: path.join(ROOT, "tests/bridge"), MTJ_URL: BASE, MTJ_KEY: key };
const check = execFileSync("python3", [path.join(ROOT, "bridge/mt5_bridge.py"), "--check"], { env, encoding: "utf8" });
assert.match(check, /Journal reachable/);
assert.ok(!check.includes(key), "bridge never prints the key");
const out = execFileSync("python3", [path.join(ROOT, "bridge/mt5_bridge.py"), "--days", "3650"], { env, encoding: "utf8" });
assert.match(out, /sent 2 deals: 1 new trades/);
const again = execFileSync("python3", [path.join(ROOT, "bridge/mt5_bridge.py"), "--days", "3650"], { env, encoding: "utf8" });
assert.match(again, /0 new trades, 0 updated, 1 unchanged/);
await page.goto(`${BASE}/trades`);
assert.equal(await page.locator("tbody tr").count(), 7);

step("bridge trade has R from the opening order's stop");
const res = await page.request.get(`${BASE}/api/export/trades?format=json`);
const { trades } = await res.json();
const bridged = trades.find((t) => t.symbol === "EURUSD" && new Date(t.openedAt).toISOString() === "2026-03-03T08:30:00.000Z");
assert.ok(bridged, "bridge trade exported");
assert.equal(bridged.initialStop, 1.0815);
assert.equal(Math.round(bridged.rMultiple * 100) / 100, 1.93);
assert.equal(new Date(bridged.closedAt).toISOString(), "2026-03-03T10:30:00.000Z");

step("mobile layout of the import page has no horizontal scroll");
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
const mp = await mobile.newPage();
for (const url of ["/trades/import", "/settings/integrations"]) {
  await mp.goto(BASE + url);
  assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no horizontal scroll on ${url}`);
}
await mobile.close();

assert.deepEqual(errors, [], "no browser errors");
await browser.close();
console.log("integration e2e passed");
