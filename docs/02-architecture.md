# Phase 2 Architecture

## Overview

```text
Browser (Next.js React UI, dark-first)
   │  server components + server actions + /api routes
   ▼
Next.js server (Node)
   ├── auth (sessions, bcrypt)               ── every query scoped by user_id
   ├── domain/ (pure TS, unit tested)
   │     metrics.ts   R, P&L, PF, expectancy, drawdown, streaks
   │     edge.ts      condition grouping + sample-size strength
   │     mistakes.ts  rule-based mistake detection
   │     matching.ts  TradingView ↔ MT5 ↔ journal matching
   │     risk.ts      user risk-rule violations
   ├── services/
   │     storage      local disk (swappable to S3)
   │     marketdata   provider interface (oanda | twelvedata | none)
   │     ai           Anthropic client (screenshot, trade review, coach)
   │     importers    csv, mt5-report, mt5-bridge payload
   └── db (Drizzle ORM, SQLite file; Postgres-portable)

Local Windows PC                                   TradingView
   MT5 terminal ← mt5_bridge.py ──HTTPS──► /api/ingest/mt5      alerts ──► /api/webhooks/tradingview/{token}
```

## Key decisions

1. **Single Next.js app**: UI and API in one deployable; no separate backend to keep in sync.
2. **SQLite + Drizzle**: relational, typed, migrations, one-file backups. Portable to Postgres.
3. **Numbers**: FX prices need 5 decimals and P&L is broker-reported in account currency, so prices and money are stored as `real` (double) and rounded only for display. All metric math lives in `domain/metrics.ts` with explicit formulas and unit tests.
4. **Derived metrics are computed, not stored**, except cached `performance_snapshots` for speed later. Trade-level `r_multiple`, `pnl` etc. are recomputed on every save from the trade's own fields so they can never drift.
5. **Psychology and mistakes are relational** (`psychology_entries`, `trade_mistakes`), not JSON blobs, so they can be filtered and correlated.
6. **AI is optional and labelled.** Everything works without an API key; AI features show "not configured."

## Metric formulas (explicit, from the spec)

```text
initial_risk_per_unit = |entry − initial_stop|          (long: entry − stop, short: stop − entry; must be > 0)
gross_pnl             = broker profit if imported, else (exit − entry) × units × dir × pip_value_conversion
net_pnl               = gross_pnl + commission + swap    (commission/swap are signed as the broker reports: costs negative)
risk_$                = user-entered, or initial_risk_per_unit × units × value_per_unit
R multiple            = net_pnl / risk_$
win                   = net_pnl > 0 ; loss = net_pnl < 0 ; breakeven = 0
win rate              = wins / (wins + losses)            (breakevens excluded, shown separately)
profit factor         = Σ winning net_pnl / |Σ losing net_pnl|
expectancy (R)        = mean(R)  ;  expectancy ($) = mean(net_pnl)
avg winner / loser    = mean(net_pnl | win), mean(net_pnl | loss)
max drawdown          = max over t of (peak_equity_to_t − equity_t), also as % of peak
```

Spread is already inside the fill price on MT5; when a spread cost is known separately it is stored in `fees` and included in net P&L.

## Statistical strength (no edges from 3 trades)

For any condition group: n, win rate, avg R, expectancy, and a strength label:
- n < 10: **Insufficient sample**
- 10 ≤ n < 30: **Weak evidence**
- 30 ≤ n < 100: **Moderate evidence**, if the 95% Wilson interval for win rate and a bootstrap-free t-interval for mean R don't cross the baseline
- n ≥ 100 and interval excludes baseline: **Strong historical pattern**

Each finding shows the interval so you can see the uncertainty.

## Database schema

All tables have `id` (text, ulid), `created_at`, `updated_at`. Every user-owned table has `user_id` (FK → users, cascade) and is always queried with it.

```text
users                (email unique, password_hash, name, timezone, base_currency)
sessions             (user_id, token_hash unique, expires_at)
accounts             (user_id, name, kind[live|prop|demo|backtest], broker, currency, starting_balance, is_archived)
risk_rules           (user_id, account_id?, max_risk_pct, max_daily_loss_pct, max_weekly_loss_pct,
                      max_trades_per_day, max_consecutive_losses, min_rr, trading_hours_start/end, restricted_days)
strategies           (user_id, name, description, source[user|fxalexg_template], preferred_sessions, preferred_pairs,
                      preferred_conditions, is_active)
strategy_rules       (strategy_id, kind[rule|confirmation|invalidation|checklist], text, is_required, sort, kb_concept_id?)
setups               (strategy_id, user_id, name, description)
score_factors        (user_id, key, label, weight)             configurable setup-score weights
trades               (user_id, account_id, strategy_id?, setup_id?, external_ref,
                      symbol, direction[long|short], status[open|closed],
                      opened_at, closed_at, entry_price, initial_stop, take_profit, exit_price,
                      size_units, size_lots, risk_amount, risk_pct,
                      gross_pnl, commission, swap, fees, net_pnl, pnl_pct, r_multiple,
                      session, timeframe, market_condition, trend, htf_bias, setup_quality[A+|A|B|C],
                      confluences, setup_score, followed_plan, chart_url, source[manual|csv|mt5|mt5_bridge])
trade_notes          (trade_id, user_id, why, observed, thesis, what_happened, did_well, did_poorly,
                      would_change, lesson)
trade_images         (trade_id, user_id, kind[before|entry|during|exit|tradingview|mt5|other], storage_key,
                      thumb_key, mime, width, height, bytes, caption, sort)
psychology_entries   (trade_id, user_id, phase[before|during|after], emotion, intensity 1-10)
trade_psychology     (trade_id, confidence 1-10, discipline 1-10, fomo, revenge, moved_stop, exited_early,
                      overtraded, emotional_impact)
mistake_types        (user_id?, key, label, description)            system + user-defined
trade_mistakes       (trade_id, user_id, mistake_type_id, source[user|rule|ai], cost_r?, note)
checklist_responses  (trade_id, phase[pre|post], item, checked, answer)
market_context       (trade_id, provider, trend, htf_bias, session, volatility, atr, near_key_level,
                      computed_at, raw)                              raw = provider response metadata only
weekly_reviews       (user_id, account_id?, week_start, answers (per-question columns), focus_next_week, ai_summary)
monthly_reviews      (user_id, account_id?, month, answers, ai_summary)
performance_snapshots(user_id, account_id, as_of, balance, equity, net_pnl, trades)
broker_connections   (user_id, account_id, kind[mt5_bridge], api_key_hash, last_seen_at, label)
mt5_deals            (user_id, account_id, connection_id, ticket unique/account, position_id, order_id, time,
                      type, entry, symbol, volume, price, sl, tp, commission, swap, profit, magic, comment)
tradingview_alerts   (user_id, received_at, symbol, timeframe, price, side, setup, message, raw, matched_trade_id)
trade_links          (trade_id, kind[tv_alert|mt5_position], ref_id, score, status[suggested|confirmed|rejected])
kb_concepts          (slug, name, category, definition, confidence, status, related, exceptions)
kb_sources           (concept_id, url, title, kind[primary|secondary|third_party], locator, quote_summary)
ai_analysis          (user_id, trade_id?, image_id?, kind[screenshot|trade_review|weekly|coach], model,
                      observed, inferred, unknown, output, created_at)
```

## API surface (route handlers + server actions)

- Auth: `/api/auth/{register,login,logout}`
- Trades: CRUD via server actions; `/api/trades/[id]/images` (multipart upload, paste), `/api/files/[key]` (authorized image serving)
- Import: `/api/import` (multipart; `action=preview` returns mapping + per-row new/duplicate/error, `action=commit` applies per-row decisions). CSV, Excel and MT5 reports share one endpoint.
- Ingest: `/api/ingest/mt5` (Bearer API key), `/api/webhooks/tradingview/[token]`, bridge download `/api/bridge/mt5`. Details in `03-integrations.md`.
- Analytics: computed server-side in pages from `domain/*` with a shared `TradeFilter`
- Export: `/api/export/{trades,journal,reviews}.{csv,json}`
- AI: `/api/ai/{screenshot,trade-review,coach}` (disabled without key)

## Frontend structure

```text
src/app/(auth)/login, register
src/app/(app)/layout.tsx         sidebar + top bar (account switcher, search, + Add Trade)
  dashboard, trades, trades/[id], trades/new, strategies, strategies/[id], market, calendar,
  reviews, reviews/week/[date], mistakes, psychology, performance, settings
src/components/ui/*              Card, Stat, Badge, Table, Button, Input, Select, Tabs, Empty
src/components/charts/*          EquityCurve, BarPnl, Distribution
src/domain/*                     pure logic (tested)
src/server/*                     db, auth, queries, storage, services
```

## Security

- Passwords: bcrypt (cost 12). Sessions: random 32-byte token, only SHA-256 hash stored, httpOnly/Secure/SameSite=Lax cookie, 30-day expiry.
- Authorization: `requireUser()` on every page/action/route; every query filters on `user_id`; file keys are random and checked against the owner.
- Webhook/ingest secrets: random 256-bit tokens, shown once, stored and looked up only as SHA-256 hashes; never logged.
- Uploads: MIME sniffed from bytes (jpeg/png/webp only), size cap, re-encoded thumbnails, originals stored outside the web root.
- Secrets only from env (`.env.example` committed, `.env` gitignored).

## Phase plan

| Phase | Scope | Status |
|---|---|---|
| 1 Research | this + 01-research.md | done |
| 2 Architecture | this doc | done |
| 3 MVP | auth, accounts, dashboard, trade log, manual/quick entry, screenshots, analytics + filters, strategies, weekly review, calendar, mistakes/psychology basics, seed data, tests | done |
| 4 Integrations | CSV/Excel/MT5 report import, duplicates, MT5 bridge, TradingView webhook, matching (see 03-integrations.md) | done; market data waits on a provider key |
| 5 AI | screenshot analysis, trade review, coach, KB-grounded checks | needs ANTHROPIC_API_KEY |
| 6 Polish | a11y, perf, empty/loading states, mobile passes | |
