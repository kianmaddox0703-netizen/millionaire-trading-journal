// End-to-end flows against a running server: register → add trade with screenshot → view → edit → review → export → delete.
import { chromium } from "playwright";
import sharp from "sharp";
import assert from "node:assert/strict";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const step = (s) => console.log("•", s);
// pages stream in behind a loading skeleton, so wait for content instead of checking once
const visible = (sel, msg) => page.locator(sel).first().waitFor({ timeout: 15000 }).catch(() => assert.fail(msg ?? `not visible: ${sel}`));

const email = `e2e-${Date.now()}@test.local`;
step("register");
await page.goto(`${BASE}/register`);
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "correct-horse-battery");
await Promise.all([page.waitForURL("**/dashboard"), page.click("button:has-text('Create account')")]);
await visible("text=No closed trades yet");

step("quick-add a trade with a screenshot");
await page.goto(`${BASE}/trades/new`);
await page.fill('input[placeholder="EURUSD"]', "eurusd");
await page.fill('input[placeholder="1.08250"]', "1.08250");
await page.fill('input[placeholder="1.08150"]', "1.08150");
await page.fill('input[placeholder="1.08450"]', "1.08450");
await page.locator("label:has-text('Exit price') input").fill("1.08450");
await page.locator("label:has-text('Net P&L') input").fill("193");
await page.locator("label:has-text('Risk $') input").fill("100");
await visible("text=1:2.00", "planned R:R preview");
await visible("text=+1.93R", "R preview");
const png = await sharp({ create: { width: 1200, height: 700, channels: 3, background: "#222" } }).png().toBuffer();
await page.setInputFiles('input[type="file"]', { name: "entry.png", mimeType: "image/png", buffer: png });
await page.locator("button:has-text('Save trade')").click();
await page.waitForURL(/\/trades\/[0-9A-Z]{26}$/);
const tradeUrl = page.url();
await visible("h1:has-text('EURUSD Long')");
await visible("text=+1.93R");
await page.waitForSelector('img[src*="/api/files/"]');
await page.waitForFunction(() => { const i = document.querySelector('img[src*="/api/files/"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });

step("unauthenticated image access is refused");
const anon = await browser.newContext();
const src = await page.locator('img[src*="/api/files/"]').first().getAttribute("src");
assert.equal((await anon.request.get(BASE + src)).status(), 401);
await anon.close();

step("edit the trade");
await page.goto(tradeUrl + "/edit");
await page.locator("label:has-text('Net P&L') input").fill("-107");
await page.locator("label:has-text('Exit price') input").fill("1.08150");
await page.locator("button:has-text('Save changes')").click();
await page.waitForURL(tradeUrl);
await visible("text=−1.07R");

step("trade appears in the log and dashboard");
await page.goto(`${BASE}/trades`);
assert.equal(await page.locator("tbody tr").count(), 1);
await page.goto(`${BASE}/dashboard`);
await visible("text=How am I trading?");

step("weekly review saves");
await page.goto(`${BASE}/reviews/week/2026-03-02`);
await page.locator("label:has-text('one focus for next week') textarea").fill("Only A setups");
await page.locator("button:has-text('Complete review')").click();
await page.waitForSelector("text=Saved");

step("export CSV");
const dl = await page.request.get(`${BASE}/api/export/trades?format=csv`);
assert.equal(dl.status(), 200);
assert.match(await dl.text(), /EURUSD/);

step("delete the trade");
await page.goto(tradeUrl);
page.once("dialog", (d) => d.accept());
await page.locator("button:has-text('Delete')").click();
await page.waitForURL(`${BASE}/trades`);
await visible("text=No trades yet");

step("mobile layout");
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/trades/new`);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
assert.equal(overflow, false, "no horizontal scroll on phone");
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/mobile_new.png`, fullPage: false });

await browser.close();
if (errors.length) { console.error(errors); process.exit(1); }
console.log("e2e passed");
