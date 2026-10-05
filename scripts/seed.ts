/**
 * Demo data so every screen can be exercised. Creates a separate demo user;
 * it never touches other users. Deterministic (seeded PRNG).
 *
 *   npm run db:seed                 → demo@mtj.local / demo-password-123
 *   SEED_EMAIL=… SEED_PASSWORD=… npm run db:seed
 *
 * The data is synthetic with patterns planted on purpose (so the edge finder,
 * mistake ranking and psychology views have something to find). It is labelled
 * as demo data and is not market data.
 */
process.env.DATA_DIR ??= "./data";

const EMAIL = process.env.SEED_EMAIL ?? "demo@mtj.local";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-123";

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { db, schema } = await import("../src/server/db");
  const { eq } = await import("drizzle-orm");
  const bcrypt = (await import("bcryptjs")).default;
  const { newId } = await import("../src/server/ids");
  const { bootstrapUser, saveTrade } = await import("../src/server/trades");
  const { tradeInput } = await import("../src/domain/validation");
  const { sessionOf } = await import("../src/domain/sessions");
  const { storeImage } = await import("../src/server/storage");
  const sharp = (await import("sharp")).default;

  const existing = db.select().from(schema.users).where(eq(schema.users.email, EMAIL)).get();
  if (existing) {
    db.delete(schema.users).where(eq(schema.users.id, existing.id)).run();
    console.log("Removed previous demo user");
  }
  const userId = newId();
  db.insert(schema.users).values({ id: userId, email: EMAIL, name: "Demo Trader", passwordHash: bcrypt.hashSync(PASSWORD, 12), timezone: "America/New_York" }).run();
  bootstrapUser(userId);

  const main = db.select().from(schema.accounts).where(eq(schema.accounts.userId, userId)).get()!;
  const propId = newId();
  db.insert(schema.accounts).values({ id: propId, userId, name: "Prop Firm Account", kind: "prop", startingBalance: 100_000, broker: "Demo prop" }).run();
  db.update(schema.riskRules).set({ maxRiskPct: 1, maxDailyLossPct: 3, maxWeeklyLossPct: 6, maxTradesPerDay: 3, maxConsecutiveLosses: 3, minRr: 2, tradingHoursStart: "02:00", tradingHoursEnd: "12:00", restrictedDays: "0,6" }).where(eq(schema.riskRules.userId, userId)).run();

  const strat = db.query.strategies.findFirst({ where: eq(schema.strategies.userId, userId), with: { setups: true } }).sync()!;
  const lbId = newId();
  db.insert(schema.strategies).values({ id: lbId, userId, name: "London Breakout", description: "Asian range breakout during the first London hours.", preferredSessions: "London", preferredPairs: "EURUSD, GBPUSD" }).run();
  const lbSetup = newId();
  db.insert(schema.setups).values({ id: lbSetup, userId, strategyId: lbId, name: "Asian range break" }).run();
  db.insert(schema.strategyRules).values([
    { id: newId(), strategyId: lbId, kind: "rule", text: "Mark the Asian session range", sort: 0 },
    { id: newId(), strategyId: lbId, kind: "confirmation", text: "Candle closes outside the range", sort: 1 },
    { id: newId(), strategyId: lbId, kind: "invalidation", text: "Price back inside range within 2 candles", sort: 2 },
  ]).run();

  const r = rng(42);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const SYMBOLS = [
    { s: "EURUSD", p: 1.085, pip: 0.0001, w: 5 }, { s: "GBPUSD", p: 1.27, pip: 0.0001, w: 3 }, { s: "USDJPY", p: 151.2, pip: 0.01, w: 2 },
    { s: "GBPJPY", p: 191.5, pip: 0.01, w: 2 }, { s: "XAUUSD", p: 2350, pip: 0.1, w: 2 }, { s: "AUDUSD", p: 0.66, pip: 0.0001, w: 1 }, { s: "EURAUD", p: 1.64, pip: 0.0001, w: 1 },
  ];
  const weighted = SYMBOLS.flatMap((x) => Array(x.w).fill(x));
  const sf = strat.setups;
  const emotionsGood = ["calm", "confident"], emotionsBad = ["fomo", "frustration", "revenge", "anxiety", "boredom", "greed"];

  const start = new Date("2026-01-05T00:00:00Z").getTime();
  const end = new Date("2026-10-02T00:00:00Z").getTime();
  const balances: Record<string, number> = { [main.id]: main.startingBalance, [propId]: 100_000 };
  let n = 0;
  const imageTargets: string[] = [];

  for (let day = start; day < end; day += 86400_000) {
    const dow = new Date(day).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const tradesToday = r() < 0.2 ? 0 : r() < 0.6 ? 1 : r() < 0.88 ? 2 : 4;
    for (let k = 0; k < tradesToday; k++) {
      const sym = pick(weighted);
      const account = r() < 0.7 ? main.id : propId;
      // entry time: London-heavy, some NY, a few off-hours
      const hourUtc = r() < 0.55 ? 7 + Math.floor(r() * 4) : r() < 0.85 ? 13 + Math.floor(r() * 4) : 19 + Math.floor(r() * 3);
      const opened = new Date(day + hourUtc * 3600_000 + Math.floor(r() * 60) * 60_000 + k * 25 * 60_000);
      const session = sessionOf(opened);
      const useAlex = r() < 0.65;
      const strategyId = r() < 0.08 ? null : useAlex ? strat.id : lbId;
      const setupId = strategyId === strat.id ? pick(sf).id : strategyId === lbId ? lbSetup : null;
      const direction = r() < 0.5 ? "long" : "short";
      const htf = r() < 0.75 ? direction === "long" ? "bullish" : "bearish" : direction === "long" ? "bearish" : "bullish";
      const aligned = (htf === "bullish") === (direction === "long");
      const quality = aligned ? pick(["A+", "A", "A", "B", "B"] as const) : pick(["B", "C", "C"] as const);
      const confirmed = r() < (aligned ? 0.8 : 0.4);
      const fomo = r() < (confirmed ? 0.05 : 0.3);
      const revenge = k > 0 && r() < 0.25;
      const rr = useAlex ? pick([2, 2.5, 3, 3.5, 4, 4.5]) : pick([1.5, 2, 2, 2.5]);

      // Planted edge: aligned + confirmed + London + EURUSD do better; GBPJPY/countertrend/FOMO/revenge do worse.
      let pWin = 0.38;
      if (aligned) pWin += 0.1; else pWin -= 0.12;
      if (confirmed) pWin += 0.07;
      if (session === "London" || session === "London/NY overlap") pWin += 0.05;
      if (session === "Off-hours") pWin -= 0.1;
      if (sym.s === "EURUSD") pWin += 0.05;
      if (sym.s === "GBPJPY") pWin -= 0.1;
      if (fomo) pWin -= 0.15;
      if (revenge) pWin -= 0.15;
      pWin = Math.max(0.08, Math.min(0.8, pWin / Math.max(1, rr / 2.5)));

      const win = r() < pWin;
      const early = win && r() < 0.28;
      const be = !win && r() < 0.06;
      let R = win ? (early ? rr * (0.3 + r() * 0.4) : rr) : be ? 0 : -(r() < 0.85 ? 1 : 0.5 + r() * 0.4);
      const movedStop = !win && !be && r() < 0.07;
      if (movedStop) R = -(1.3 + r() * 0.6);

      const bal = balances[account];
      const riskPct = revenge ? 1.6 + r() * 0.8 : 0.5 + r() * 0.6;
      const riskAmount = Math.round(bal * riskPct) / 100;
      const stopPips = sym.s === "XAUUSD" ? 80 + Math.floor(r() * 120) : 15 + Math.floor(r() * 40);
      const stopDist = stopPips * sym.pip;
      const entry = +(sym.p * (1 + (r() - 0.5) * 0.04)).toFixed(sym.pip < 0.001 ? 5 : sym.pip < 0.05 ? 3 : 2);
      const s = direction === "long" ? 1 : -1;
      const dp = sym.pip < 0.001 ? 5 : sym.pip < 0.05 ? 3 : 2;
      const sl = +(entry - s * stopDist).toFixed(dp);
      const tp = +(entry + s * stopDist * rr).toFixed(dp);
      const exit = +(entry + s * stopDist * R).toFixed(dp);
      const lots = +(riskAmount / (stopPips * 10)).toFixed(2) || 0.01;
      const gross = +(((exit - entry) * s / stopDist) * riskAmount).toFixed(2);
      const commission = -+(lots * 7).toFixed(2);
      const swap = r() < 0.2 ? -+(r() * 6).toFixed(2) : 0;
      const holdMin = win && !early ? 120 + Math.floor(r() * 2000) : 20 + Math.floor(r() * 600);
      const closed = new Date(opened.getTime() + holdMin * 60_000);

      const conf = Math.max(1, Math.min(10, Math.round((aligned ? 7 : 4.5) + (confirmed ? 1 : -1) + (fomo ? -2 : 0) + (r() - 0.5) * 3)));
      const before = fomo ? "fomo" : revenge ? "revenge" : aligned && confirmed ? pick(emotionsGood) : pick([...emotionsGood, ...emotionsBad]);
      const after = R > 0 ? pick(["calm", "confident", "excitement"]) : pick(["frustration", "calm", "anxiety"]);

      const input = tradeInput.parse({
        accountId: account, strategyId, setupId, symbol: sym.s, direction, status: "closed",
        openedAt: opened, closedAt: closed, entryPrice: entry, initialStop: sl, takeProfit: tp, exitPrice: exit, sizeLots: lots,
        riskAmount, grossPnl: gross, commission, swap,
        timeframe: useAlex ? pick(["4H", "1H", "D"]) : pick(["15m", "5m"]), marketCondition: aligned ? "Trending" : pick(["Ranging", "Trending", "Volatile"]),
        trend: htf, htfBias: htf, setupQuality: quality, entryConfirmation: confirmed ? (useAlex ? "Break & retest + engulfing" : "Close outside range") : "",
        confluences: [aligned && "Trend aligned", confirmed && "Confirmation", r() < 0.4 && "AOI", r() < 0.3 && "Liquidity sweep"].filter(Boolean).join(", "),
        psych: { confidence: conf, discipline: Math.max(1, Math.min(10, conf + (fomo || revenge ? -3 : 1))), followedPlan: !(fomo || revenge || movedStop || early) ? "yes" : "no", fomo, revenge, movedStop, exitedEarly: early },
        emotions: { before, during: R < 0 ? pick(["anxiety", "fear", "calm"]) : pick(["calm", "confident", "greed"]), after },
        factors: { market_context: aligned ? 2 : 1, htf_bias: aligned ? 2 : 0, structure: r() < 0.7 ? 2 : 1, liquidity: r() < 0.4 ? 2 : r() < 0.5 ? 1 : 0, confirmation: confirmed ? 2 : 0, risk_reward: rr >= 2.5 ? 2 : 1, psychology: fomo || revenge ? 0 : 2 },
        notes: r() < 0.3 ? {
          why: aligned ? "Higher-timeframe trend intact and price pulled back into my area." : "Thought the move was overextended.",
          thesis: `${direction === "long" ? "Continuation higher" : "Continuation lower"} toward the next swing level.`,
          whatHappened: R > 0 ? (early ? "Moved in my favour; I closed before target." : "Ran cleanly to target.") : "Reversed through my stop.",
          lesson: early ? "Let the trade hit the planned target." : fomo ? "Wait for the retest; don't chase." : R > 0 ? "Patience at the level paid." : "Accept the loss; it was within plan.",
        } : {},
        mistakes: [],
        checklist: [],
      });
      const id = saveTrade(userId, input, undefined, { refreshLater: false });
      balances[account] += gross + commission + swap;
      n++;
      if (imageTargets.length < 8 && r() < 0.05) imageTargets.push(id);
    }
  }

  // Weekly reviews for a few recent weeks
  for (const w of ["2026-09-07", "2026-09-14", "2026-09-21"]) {
    db.insert(schema.weeklyReviews).values({
      id: newId(), userId, weekStart: w, followedRules: "Mostly. One impulsive trade on Thursday.", overtraded: "No", forcedSetups: "One B setup I shouldn't have taken.",
      respectedRisk: "Yes, all under 1%.", followedPlan: "Yes", emotions: "Calm early in the week, impatient Thursday.", lostDiscipline: "After a loss on Thursday NY session.",
      triggers: "Watching lower timeframes after a loss.", keepDoing: "Waiting for the retest.", stopDoing: "Trading after 12:00 NY time.", change: "Close charts after two losses.",
      focusNextWeek: "Only A setups, London session.", completedAt: new Date(new Date(w).getTime() + 6 * 86400_000),
    }).run();
  }

  // Demo screenshots: rendered synthetic chart images (clearly labelled demo data), to exercise image handling.
  for (const [i, tradeId] of imageTargets.entries()) {
    const t = db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).get()!;
    const W = 1600, H = 900, candles = 60;
    let price = 100, rects = "";
    const rr2 = rng(1000 + i);
    for (let c = 0; c < candles; c++) {
      const o = price, cl = price + (rr2() - 0.48) * 3, hi = Math.max(o, cl) + rr2() * 1.5, lo = Math.min(o, cl) - rr2() * 1.5;
      price = cl;
      const x = 60 + c * 24, y = (v: number) => 450 - (v - 100) * 12;
      const col = cl >= o ? "#2fbf71" : "#ef5350";
      rects += `<line x1="${x + 8}" x2="${x + 8}" y1="${y(hi)}" y2="${y(lo)}" stroke="${col}"/><rect x="${x}" y="${Math.min(y(o), y(cl))}" width="16" height="${Math.max(1, Math.abs(y(o) - y(cl)))}" fill="${col}"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#131722"/>${rects}
      <text x="24" y="40" fill="#d1d4dc" font-family="sans-serif" font-size="26">${t.symbol} · ${t.timeframe ?? ""} · DEMO IMAGE (synthetic, not market data)</text></svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const stored = await storeImage(userId, png);
    db.insert(schema.tradeImages).values({ id: newId(), tradeId, userId, kind: i % 2 ? "exit" : "entry", caption: "Demo image", sort: 0, ...stored }).run();
  }

  console.log(`Seeded ${n} trades, ${imageTargets.length} demo images for ${EMAIL} (password: ${PASSWORD})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
