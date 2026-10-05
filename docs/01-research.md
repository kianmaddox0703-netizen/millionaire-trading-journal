# Phase 1 Research

Date: 2026-10-05. Scope: FXAlexG methodology, TradingView integration, MetaTrader 5 integration, market data APIs, chart screenshot analysis.

---

## 1. FXAlexG (Alex Gonzalez)

### 1.1 What could and could not be accessed

Be clear about this first, because everything below depends on it.

| Source | Access | Notes |
|---|---|---|
| `youtube.com/@fxalexg` | Reached, **but it is not his channel** | The `@fxalexg` handle currently belongs to an unrelated channel ("damn cod", channel id `UC66DIl4-Jcc8A_pWvPzzbHg`, description "dm to buy name"). |
| His actual channel: `youtube.com/@fxalexg__` (id `UCgPeeHdxYRal0HTNeAkjqLg`) | Channel metadata only | Name "fxalexg", description promotes his swing trading program. The video list is rendered client-side and was not readable. |
| Channel RSS feed (full video list) | **Blocked** (robots.txt) | |
| Individual YouTube video pages, captions, transcripts | **Blocked** | YouTube is blocked by this environment's network policy for direct requests, and returned HTTP 429 (rate limited) to the page fetcher. **No video was watched, transcribed, or read.** |
| His public Telegram channel `t.me/s/alexsetandforget` ("Swingtradinglab") | **Partially read** | Six pages of public posts across ~2022–2025 (posts ≈ 290–300, 477–496, 979–999, 1285–1299, 1430–1449, 1559–1579, latest). This is the best primary source available and is his own words. |
| `fxalexg.com` (his site) | Read | Origin story and philosophy of "set and forget"; no technical rules. |
| "SET AND FORGET" podcast (Apple Podcasts, his show) | Episode titles/descriptions only | Psychology and mindset themes; no audio was transcribed. |
| Third-party secondary sources | Read | forex.in.rs article, Photon Trading review, coinspot.io review, TradingView community scripts ("Set & Forget – AlexG Club – Checklist" by AnthonyToday, "Snake of fxalexg" by mygoldxau). None are official. |
| Leaked/resold copies of his paid course (Scribd PDFs, Gumroad resellers, "free download" course sites) | **Deliberately not used** | These are redistributions of paid copyrighted material. |

Videos identified by title only (not watched): "Live Forex Session With 965 Traders – Full Strategy Reveal", "3 Things That Could've Saved My Forex Account", "Making $50,000 Trading forex on Vacation", "How To Trade Forex For Beginners in 2025 | Full Tutorial", "PART 1 TURNING $100 INTO $1,000,000 TRADING FOREX - LIVE". Third-party analysis videos also exist ("I Coded fxalexg's Trading Strategy. Does It Work?", "I Tried to Improve fxalexg's Trading Strategy") but could not be opened.

**Bottom line:** the extensive video study you asked for was not technically possible from this environment. The knowledge base below is built from his own public Telegram posts and website, plus clearly labelled third-party interpretations. Every concept carries a source and a confidence level, and every gap is labelled "Not established from available source material." The knowledge base is stored as data, so it can be extended when transcripts become available (for example, if you paste in transcripts or notes from videos you've watched, they can be added with sources).

### 1.2 Confidence scale

- **High**: stated repeatedly in his own words across different periods.
- **Medium**: stated in his own words, but rarely, or only as a reference in a trade post.
- **Low**: appears only in third-party interpretations, or a single ambiguous mention.
- **Not established**: no source available supports a specific rule.

### 1.3 Findings by topic

**Core methodology**
- "Set and forget": define entry, stop and target in advance, place the trade, then do not interfere. Origin story on fxalexg.com: he kept cutting winners short out of greed until he fell asleep in a trade and woke up to a much larger winner. Telegram: "#setandforget", "set and forget into the next opportunity", "you have to be PATIENT AND JUST #SETANDFORGET" (post 1285). **High.**
- Swing trading, higher-timeframe based (daily chart analysis, waiting for daily closes, e.g. post ~1576 "awaiting daily close for re-entry"). **High** for swing/higher-timeframe; **Medium** for daily as the primary analysis chart.
- Price action / market structure focused ("capitalize off these simple market structures", post 477). **High.**

**Setup types**
- Pullback to an **Area of Interest (AOI)** in the direction of the move ("THIS week I am expecting a pull back to AOI", post 989; "break and retest of minor area of interest", latest posts). **Medium-High.**
- **Break and retest** ("BR") of a level/AOI/structure. Post 1568: "EURAUD – Prediction Wrong… no loss taken because I didn't get the BR I was looking for." **High**: the BR is a precondition, not optional.
- **Break of structure** from a previous high/low (London session setup post, latest page). **Medium.**
- **Head and shoulders** chart pattern (latest page). **Low-Medium** (mentioned, no rule given).

**Entry confirmation**
- Break and retest must occur; "If I didn't get the BR, I don't take it" is the clearest rule in the source material. **High.**
- **Engulfing candle** at the retest: recent post describes skipping a minor-AOI break/retest because there was no engulfing pattern. **Medium.**
- "Strong break" confirmation before entering (post on avoiding a loss by waiting). **Medium.**
- Exact entry timeframe: posts repeatedly mark "1 hour chart time ✅" (posts 1285–1297) and refer to a "4hr EMA" (post range 979–999). Suggests daily analysis with 4H/1H confirmation. **Low-Medium.** Exact EMA length: **Not established** (a community indicator uses a 50 EMA; that is the indicator author's choice, **Low**).

**Risk management**
- Risk per trade %: **Not established from available source material.**
- Minimum R:R: **Not established.** Documented examples: "TP hit for a 1:4.5 RR" (post 1288); "RR tool" used in a lesson (post 490). Large R:R targets are consistent with the style, but no minimum rule is stated.
- Max trades / daily loss limits: **Not established.**

**Trade management and exits**
- Do not manage the trade after entry; let SL or TP hit. **High** (this *is* "set and forget").
- Stop-loss placement rule: **Not established** from his own material.
- Take-profit placement rule: **Not established** from his own material.
- Partial profits / break-even moves: **Not established**, and in tension with set-and-forget (see contradictions).

**Psychology**
- Patience: "PATIENCE!!!!", "PATIENCE PAYS… learn how to sit your hands and only trade when…" (post 983). **High.**
- Selectivity: "Textbook trades only, Less is more" (post 297); "Not 1 single trade this week… Such a lovely week" (post 1573). Zero-trade weeks are acceptable. **High.**
- Greed and fear as the main threats (podcast EP 26 "How to overcome Greed and Fear in trading", origin story). **Medium-High.**
- Learn from losses ("Learning from my L's", post 1570; "learn from my mistakes", post 477). **Medium.**

**Common mistakes he calls out**
- Counter-trend trading: "DONT TAKE COUNTER TREND TRADE SHORTS" (post 490). **Medium.**
- Entering without the break-and-retest / confirmation (post 1568, latest posts). **High.**
- Cutting winners short out of greed (origin story). **High.**
- Overtrading / forcing trades (implied by "less is more", zero-trade weeks). **Medium.**

**Market conditions and pair selection**
- Weekly preparation: picks a short list of "top 3-5 pairs for the week" (Free Sunday Swings, post 1563–1566). **Medium-High.**
- Trades FX majors/crosses and XAUUSD (examples: EURAUD, GBPCAD, GBPUSD, EURUSD, AUDUSD, XAUUSD). **High** (as instruments he trades; not a rule).
- Trend-aligned only (counter-trend discouraged). **Medium.**

**Session timing**
- A "London session setup" is referenced (latest posts); coinspot.io review says "London session focus." **Low-Medium.**
- "Every morning 6:30 am EST" refers to a community live session, not a trading rule (post 292). **Not established** as a trading-time rule.

### 1.4 Contradictions and changes

1. **Set-and-forget vs active management.** His own material says don't touch the trade. The forex.in.rs article (uncited) describes partial profits at 1R–1.5R, moving stops to break-even, session windows of London/NY open ±90 min, 5M/1M precision entries and a "G-Channel" indicator. None of that appears in his own posts. Treated as **third-party interpretation, Low confidence**, and kept separate in the knowledge base.
2. **Timeframes.** His posts reference daily closes, 4H EMA and "1 hour chart time." The third-party article says Weekly/Daily bias with 1H/15M execution. Consistent direction (top-down), but exact entry timeframe is not settled.
3. **Trade-call vs education.** Reviews (coinspot.io, telegramsignalsreviews) note the Telegram trade ideas often omit reasoning and position sizing, and that no audited track record exists; one cites an unverified ~32% strike rate. That is consistent with a low-win-rate / high-R:R style but nothing about performance could be verified.

### 1.5 Structured framework (as established)

```text
FXAlexG Methodology (source-backed only)
├── Market Context
│   ├── Trend direction on higher timeframe ............ Medium (no counter-trend)
│   ├── Weekly pair shortlist (3-5 pairs) .............. Medium-High
│   ├── Areas of Interest (AOI) ........................ Medium-High
│   └── Liquidity ...................................... Not established from his material
├── Setup Identification
│   ├── A: Pullback to AOI with trend .................. Medium-High
│   ├── B: Break of structure → retest ................. Medium
│   └── C: Head & shoulders ............................ Low-Medium
├── Entry Confirmation
│   ├── Break and retest occurred (required) ........... High
│   ├── Engulfing candle at retest ..................... Medium
│   └── Lower-timeframe (4H/1H) confirmation ........... Low-Medium
├── Risk Management
│   ├── Risk % per trade ............................... Not established
│   └── Minimum R:R .................................... Not established (examples ~1:4.5)
├── Trade Management: no interference after entry ...... High
├── Exit Conditions: SL or TP only ..................... High (placement rules not established)
└── Psychology: patience, selectivity, greed/fear ...... High
```

### 1.6 How the app uses this

- The **Strategy Knowledge Base** stores each concept with: definition, source(s) with URL, confidence, category (core rule / optional confirmation / personal preference / psychology / context-dependent / third-party interpretation), related concepts, and exceptions.
- The default **"FXAlexG Set & Forget"** strategy template is built from **High/Medium** items only. Low-confidence items appear as optional confirmations, clearly labelled.
- The app never presents "Not established" items as rules. Where you set your own values (e.g. risk 1%, min R:R 1:3), those are stored as **your** rules, not his.

---

## 2. TradingView integration

What exists:
- **Webhook alerts** (official). TradingView POSTs the alert message to a URL when an alert fires. Requirements: a paid plan that includes webhooks, **2-factor authentication enabled** on the TradingView account, ports 80/443 only, the endpoint must respond within **3 seconds**, body is JSON (`application/json`) if the message is valid JSON, else `text/plain`. Requests come from `52.89.214.238`, `34.212.75.30`, `54.218.53.128`, `52.32.178.7`.
- **Alert message placeholders** such as `{{ticker}}`, `{{interval}}`, `{{close}}`, `{{time}}`, `{{timenow}}`, `{{exchange}}`, and `{{strategy.order.action}}` for strategy alerts let you build a JSON payload.

What does not exist:
- No public API to read your chart drawings, layouts, or trade history.
- No webhook placeholder that attaches a chart **screenshot**. Snapshots (`tradingview.com/x/...`) are created manually from the camera button; the app can store that link.
- No API to pull your TradingView paper-trading account.

Design:
- `POST /api/webhooks/tradingview/{token}`: per-user secret token in the URL (TradingView cannot send custom headers), plus an optional shared secret field in the JSON body and source-IP allowlist. Responds immediately (<3s), stores the raw payload in `tradingview_alerts`, then matching runs asynchronously.
- The app generates a ready-to-paste JSON alert template, e.g.
  `{"secret":"…","symbol":"{{ticker}}","tf":"{{interval}}","price":{{close}},"time":"{{timenow}}","side":"long","setup":"AOI-BR","note":"…"}`
- Manual fallback on every trade: TradingView chart URL / snapshot URL field and screenshot upload.

**Needs from you:** a TradingView plan with webhooks and 2FA, and a public HTTPS URL where the app runs. Until deployed, the endpoint exists and is tested locally, but TradingView cannot reach it.

## 3. MetaTrader 5 integration

What exists:
- **Official `MetaTrader5` Python package** (MetaQuotes). Talks to a running MT5 terminal on the same machine via IPC. Provides `account_info()` (balance, equity), `positions_get()`, `orders_get()`, `history_orders_get()`, `history_deals_get()` (ticket, order, position_id, time, type, entry in/out, volume, price, commission, swap, profit, symbol, magic, comment), `symbol_info()`. **Windows only** and the terminal must be running and logged in.
- MT5 **History export**: Account History → Report → HTML / XLSX (the "Trade History Report" with Positions / Orders / Deals tables).
- Third-party cloud APIs (e.g. MetaApi) that host a terminal for you. These require giving a third party your account login (investor password suffices for read-only) and a paid subscription.
- An MQL5 Expert Advisor could POST deals via `WebRequest()`; the Python bridge is simpler and doesn't need running code inside the terminal.

Why the web app can't connect directly: MT5 has no public broker-agnostic web API. Data lives in the terminal on your PC (or the broker's server, reachable only through the terminal).

Design:
- **Local bridge** (`bridge/mt5_bridge.py`, runs on your Windows PC next to MT5): reads closed deals + open positions + account balance/equity on an interval, groups deals by `position_id` into round-trip trades, and pushes them to `POST /api/ingest/mt5` with a per-account API key (stored hashed server-side). Read-only: it never calls `order_send`. No broker password ever reaches the web app.
- **Import fallback**: MT5 XLSX/HTML report parser + generic CSV with column auto-mapping + manual entry.
- Duplicate detection keyed on `(account_id, mt5_position_id)` plus fuzzy match on symbol/side/time/price for CSV imports.

**Needs from you:** nothing for the import path. For the live bridge: run the script on the Windows PC where MT5 is installed, once the app is deployed somewhere your PC can reach.

## 4. Market data for automatic context

Requirement: provider-swappable, no fake data.

| Provider | FX history | Auth | Notes |
|---|---|---|---|
| **OANDA v20 REST** | Yes, candles M1…M (deep history) | API token from a free practice account | Best free FX candle source; mid/bid/ask. |
| Twelve Data | Yes | API key, free tier with daily limit | Simple REST, many symbols incl. XAU/USD. |
| Polygon.io (Massive) | Yes | API key, paid for meaningful history | Good aggregates API. |
| Alpha Vantage | FX daily/intraday | API key, low free limits | Fine for daily-only context. |
| Dukascopy historical | Tick/candle downloads | None | Bulk files, not a request/response API. |
| **MT5 itself** via bridge (`copy_rates_range`) | Your broker's exact prices | Already have it | Most faithful to your fills. |

Design: a `MarketDataProvider` interface (`getCandles(symbol, timeframe, from, to)`), implementations selected by env var `MARKET_DATA_PROVIDER`. Context computed from candles, transparently: trend (HTF swing-structure + EMA slope, the definition shown in the UI), session from timestamp (deterministic), volatility (ATR percentile), distance to recent swing levels. If no provider is configured, context fields remain manual and are labelled "not computed."

**Needs from you:** pick a provider and supply an API key (recommended: OANDA practice token, free).

## 5. Screenshot / chart analysis

- Claude (Anthropic API) accepts images and can read chart screenshots: visible symbol/timeframe labels, price scale, drawn lines/boxes, position tool (entry/SL/TP), candle structure. It cannot see what is off-screen and price readings off an axis are approximate.
- Design: structured output with three explicit lists, **observed / inferred / unknown**, each item with a confidence; fields extracted (symbol, timeframe, direction, entry, SL, TP) are proposed as suggestions the user accepts, never silently written. The prompt includes your strategy rules and the FXAlexG KB so it can check consistency, and it is forbidden from outcome predictions.
- **Needs from you:** an `ANTHROPIC_API_KEY` (server-side env var only).

## 6. Technical stack decision

- **Next.js 16 (App Router) + TypeScript + React 19**: one deployable app for UI + API routes, server components for fast dashboards.
- **SQLite via Drizzle ORM** (better-sqlite3). A personal journal is single-tenant-scale; SQLite is fast, zero-ops, easy to back up (one file), and Drizzle keeps a fully relational, typed schema. The schema avoids SQLite-only features so moving to Postgres later is a driver swap.
- **Tailwind CSS v4** for a restrained design system, **Recharts** for charts, **sharp** for thumbnails (WebP thumbnails, originals untouched).
- **Auth**: email + password (bcrypt), DB-backed sessions in httpOnly, SameSite=Lax, Secure cookies; every query scoped by `user_id`.
- **Files**: stored outside the web root, served only through an authorized route; storage interface swappable to S3-compatible later.
- **Tests**: Vitest for metric math and API logic; Playwright for UI smoke tests.

## Sources

- His channel: https://www.youtube.com/@fxalexg__ (channel id UCgPeeHdxYRal0HTNeAkjqLg)
- The `@fxalexg` handle (not his): https://www.youtube.com/@fxalexg
- Telegram: https://t.me/s/alexsetandforget
- Website: https://fxalexg.com/
- Podcast: https://podcasts.apple.com/us/podcast/set-and-forget/id1617481269
- Third-party: https://www.forex.in.rs/miami-trader-strategy-4/ , https://www.photontradingfx.com/blog/swing-trading-lab-review , https://coinspot.io/en/reviews/swingtradinglab/ , https://www.tradingview.com/script/2YLynmgt-Set-Forget-AlexG-Club-Checklist/ , https://www.tradingview.com/script/qAMvHkku-Snake-of-fxalexg/
- TradingView webhooks: https://www.tradingview.com/support/solutions/43000529348-how-to-configure-webhook-alerts/
- MT5 Python: https://www.mql5.com/en/docs/python_metatrader5 , https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py
