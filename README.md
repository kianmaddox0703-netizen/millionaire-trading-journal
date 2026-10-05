# Millionaire Trading Journal

A trading journal and personal performance coach: log executions, attach real chart screenshots, and let your own history tell you which setups make money, which mistakes cost you, and whether you're following your plan.

“Millionaire” means disciplined compounding and professional execution. The app never places trades, never generates signals, and never claims a trade will win.

## Quick start

```bash
npm install
cp .env.example .env          # adjust DATA_DIR, APP_URL, etc.
npm run db:seed               # optional: demo user demo@mtj.local / demo-password-123
npm run dev                   # http://localhost:3000
```

Requires Node 22+. The SQLite database and uploaded images live in `DATA_DIR` (default `./data`), outside the web root. Back up that folder to back up everything.

Production: `npm run build && npm start` behind HTTPS, with `COOKIE_SECURE=true` and `ALLOW_REGISTRATION=false` once your account exists.

## What's in the MVP (phase 3)

- **Dashboard**: balance, P&L (today/week/month), win rate, avg R, profit factor, expectancy, avg winner/loser, max drawdown, streaks; trading-quality counts (A+/A/B/C, rule violations, revenge, FOMO, early exits, oversizing…); equity curve ($ / % / R with high-water mark and drawdown); P&L by day, week, strategy, pair, session, weekday, setup quality; R distribution; #1 mistake this month; strongest/weakest conditions.
- **Trade log**: every field from the spec (prices, size, risk, P&L, R, costs, context, psychology, journal); filters (date, symbol, strategy, setup, session, direction, timeframe, emotion, quality, mistake, weekday, outcome); free-text search (“EURUSD”, “London”, “FOMO”, “A+ trades”, “biggest losses”, “trades from March”, “trades where I moved my stop”); CSV/JSON export.
- **Quick entry**: symbol, direction, entry, SL, TP, strategy/setup and save; live R:R / R preview; everything else in collapsible sections; Ctrl/⌘+Enter to save.
- **Screenshots**: drag-and-drop, paste from clipboard, multi-upload; tagged before/entry/during/exit/TradingView/MT5; originals stored untouched, WebP thumbnails, zoomable viewer; served only to the owner.
- **Strategies**: rules, confirmations, invalidations, checklist, setups, preferred conditions; per-strategy stats and a “does it work for me?” verdict based on the 95% interval of average R (never below 20 trades); best/weak conditions; per-setup table.
- **FXAlexG knowledge base**: every concept with category, confidence and sources (see `docs/01-research.md` for what could and couldn't be accessed). A “FXAlexG Set & Forget” strategy template built only from source-backed concepts.
- **Personal edge finder**: every condition and pair of conditions (symbol, session, timeframe, strategy, setup, quality, trend alignment, target size, weekday, emotion, setup score) with sample size, win rate, avg R, expectancy and an evidence-strength label; small samples are shrunk toward your average so lucky 5-trade groups don't top the list.
- **Mistakes**: user-tagged plus rule-detected (oversizing, R:R below minimum, restricted days/hours, daily/weekly loss limits, consecutive losses, overtrading, countertrend, no strategy, C setups, possible revenge); ranking with realised R and estimated opportunity cost, “most common on” breakdown.
- **Psychology**: confidence, discipline, emotions before/during, plan adherence, self-reported flags vs outcomes, with sample sizes and 95% ranges.
- **Reviews**: weekly workflow (all questions from the spec) with an auto-generated data summary; monthly review with best/worst strategy/pair/session, biggest mistake/improvement and month-over-month comparison.
- **Calendar**: daily P&L, trades, win rate, R, mistakes, dominant emotion; click through to the day's trades; weekly totals link to the weekly review.
- **Settings**: multiple accounts (combined or individual views), risk rules, configurable setup-score weights (with a table showing which factors actually correlate with your results), profile/timezone, password, exports.

## Formulas

All metric math is in `src/domain/metrics.ts`, written out explicitly and unit-tested:

- Risk per unit: long `entry − stop`, short `stop − entry`
- Net P&L = gross + commission + swap + fees (costs signed negative, as brokers report them)
- R = net P&L ÷ initial risk $; if risk $ isn't entered it is derived from the trade's own P&L-per-price-unit; if money is unknown, price-based R is used and labelled
- Win rate = wins ÷ (wins + losses), breakevens excluded; profit factor = gross profit ÷ |gross loss|; expectancy = mean net P&L (and mean R)
- Max drawdown from the high-water mark of the closed-trade equity curve, in $, % and R

## Tests

```bash
npm test                      # unit + integration (metrics, mistakes, isolation, storage, search, CSV)
npm run dev & npm run db:seed
node scripts/smoke.mjs        # loads every page as the seed user
node scripts/e2e.mjs          # register → add trade + screenshot → edit → review → export → delete → mobile
```

## Security

bcrypt passwords; random session tokens stored only as SHA-256 hashes in httpOnly SameSite cookies; every query scoped by `user_id`; uploads type-sniffed from bytes and served through an authorized route; secrets only from environment variables; security headers; CSV exports guarded against formula injection.

## Roadmap

| Phase | Scope | Needs from you |
|---|---|---|
| 4 Integrations | CSV + MT5 report import with column mapping and duplicate detection (merge / ignore / create anyway); MT5 local bridge (read-only Python script on your Windows PC); TradingView webhook endpoint; automatic TradingView↔MT5 matching with manual link/unlink; market-data provider | For live MT5/TradingView: a deployed HTTPS URL; TradingView plan with webhooks + 2FA; market-data API key (OANDA practice token recommended) |
| 5 AI | Screenshot analysis (observed / inferred / unknown), AI trade review, AI weekly/monthly summaries, AI coach grounded in your data + the knowledge base | `ANTHROPIC_API_KEY` |
| 6 Polish | Accessibility pass, loading/empty states, performance, PDF export | — |

See `docs/01-research.md` and `docs/02-architecture.md`.
