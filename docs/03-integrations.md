# Phase 4 Integrations

What is automated, what isn't and why, and how each piece was verified. Nothing here places, modifies or closes trades.

## 1. File import (CSV, Excel, MT5 report)

**Where:** Trades → Import (`/trades/import`), API `POST /api/import` (`action=preview|commit`).

**Flow:** drop a file → the server parses it and guesses the column mapping → you adjust the mapping, timezone and number conventions → preview shows every row as *new*, *possible duplicate* or *error* → you choose per duplicate → commit. The server re-parses the file on commit, so nothing the browser sends back about trades is trusted.

| Input | How it's read |
|---|---|
| CSV / TXT | papaparse with delimiter detection (`,` `;` tab). European decimals (`1,0825`) and thousands separators are handled. |
| Excel `.xlsx` | `read-excel-file`, first sheet with data. |
| MT5 Trade History Report (`.html`, UTF-16) | Built-in table reader (no HTML is rendered or executed). Finds the **Positions** section; reads initial stops from the **Orders** section. |
| MT5 report saved as Open XML (`.xlsx`) | Same section detection on the sheet's rows. |

**Timezones.** MT5 prints trade-server time. Most forex brokers run their server on "New York close" time (New York + 7h: UTC+2 in winter, UTC+3 in US summer time); that is the default for MT5 reports. Other files default to the timezone in your profile. You can switch to UTC, Europe/Athens (EU daylight saving dates) or others, and the preview shows the resulting times in your timezone.

**Initial stop and R.** R needs the stop you planned, but MT5's Positions table shows the stop as it was when the position closed. So:
1. the opening order's S/L from the Orders section is used when it exists (in MT5 the position ID equals the ticket of the order that opened it);
2. otherwise the position's final S/L is used, with a warning on the row;
3. a stop at or beyond entry (moved to breakeven or into profit) can't be the initial risk, so it is left empty with a warning rather than producing a wrong R.

**Duplicates** (per account): same broker ticket/position ID, *or* (when the IDs don't conflict) same symbol and direction, open time within ±2 minutes, entry within 0.05% and equal size. Rows repeated inside one file are caught too.

| Choice | Effect |
|---|---|
| Ignore (default) | Row skipped. |
| Merge | Broker data (times, entry/exit, size, P&L, commission, swap, fees) overwrites the journaled trade; your notes, psychology, emotions, mistakes, checklist, screenshots, strategy, stop, target and risk amount are kept. The broker ID is attached so the next import or sync matches by ID. |
| Create anyway | A new trade; it doesn't take the broker ID if another trade already has it. |

Imported trades get the same derived fields as manual ones (session, net P&L, R, planned R:R, risk %, rule-based mistakes). An imported trade without a strategy is not flagged "trading outside plan", because the broker simply doesn't know the strategy.

**Verified by:** `tests/importing.test.ts` (parsing, mapping, timezones incl. the March weeks when US and EU daylight saving differ, report detection, duplicates), `tests/server.test.ts` (preview → commit, merge keeps the journal, re-import skips, create-anyway, data isolation, MT5 report end to end), `scripts/e2e-integrations.mjs` (browser upload of a semicolon CSV and a UTF-16 report).
**Limitation:** the MT5 report fixture is synthetic, laid out like the real report. I could not test against a report exported from a real terminal; the column mapping step is the fallback if a broker's layout differs.

## 2. MT5 live sync (read-only bridge)

**Why a bridge.** MetaTrader 5 has no web API for retail accounts. The official `MetaTrader5` Python package only runs on Windows, next to a running, logged-in terminal. So a small script runs on your PC and posts your history to the journal. Hosted services that log in to MT5 for you need your broker password, which the spec rules out.

**Files:** `bridge/mt5_bridge.py` (also downloadable from Settings → Integrations), endpoint `POST /api/ingest/mt5`.

- Calls only `initialize`, `account_info`, `history_deals_get`, `history_orders_get`, `shutdown`. No `order_send`. It never sees your broker password.
- Auth: one API key per journal account (`Authorization: Bearer mtj_…`), shown once, stored as a SHA-256 hash, revocable. A key can only add deals to its own account.
- Deals are stored once per ticket (`mt5_deals`), grouped by position ID into trades: volume-weighted entry and exit, Σ profit, Σ commission (+ fee), Σ swap; closed when exit volume ≥ entry volume. Initial SL/TP come from the opening order.
- A position already journaled by hand (no ticket yet) is matched with the duplicate rules above and merged, so your notes stay. Open positions are created as open trades and updated when they close. Re-sending the same deals changes nothing.
- Server time → UTC uses `--server-tz` (default New York close).
- Positions opened before the first synced day are skipped (their entry deal isn't in the window); run `--days 365` once for older history.

**Verified by:** server tests (open → close → resend, merge into a hand-journaled trade, R from the opening order's stop, key isolation) and the e2e script, which runs the real bridge script against `tests/bridge/MetaTrader5.py`, a clearly labelled test double with the documented field layout. **Not verified:** a run against a real MT5 terminal (not possible in this environment: Windows-only and needs your account).

## 3. TradingView alerts

**Where:** Settings → Integrations; endpoint `POST /api/webhooks/tradingview/<token>`.

TradingView cannot send custom auth headers, so the URL contains a random 256-bit token (stored hashed; replace or turn off at any time). From TradingView's "About webhooks" help page: alerts come from 52.89.214.238, 34.212.75.30, 54.218.53.128 and 52.32.178.7, only to ports 80/443 (so the app must be on a public HTTPS address; `localhost` can't receive them), must be answered within 3 seconds, and need 2-factor authentication on the TradingView account. JSON messages arrive as `application/json`, anything else as `text/plain`; both are stored. `TRADINGVIEW_IP_ALLOWLIST=true` optionally enforces the IP list behind a trusted proxy. Bodies over 10 KB are refused; 30 alerts/minute per user.

Paste this into the alert's Message box:

```json
{"symbol":"{{ticker}}","exchange":"{{exchange}}","timeframe":"{{interval}}","price":{{close}},"side":"long","setup":"Pullback to AOI","time":"{{timenow}}","message":"4H trend up, retest of the AOI"}
```

**Matching** (`src/domain/matching.ts`): an alert can belong to a trade with the same normalised symbol (OANDA:EURUSD = EURUSD.r), the same direction if the alert has a side, opened between 10 minutes before and 4 hours after the alert.
`score = 0.6 × time + 0.4 × price`, where `time = 1 − Δ/4h` and `price = 1 − |entry − alert price| / entry ÷ 0.3%`; without a price, `0.8 × time`. ≥ 0.85 links automatically, 0.5–0.85 is shown as a suggestion. On the trade page you can confirm, unlink ("not this trade", remembered so it isn't re-linked) or link another alert from the same day by hand. Matching re-runs when alerts arrive and after imports and MT5 syncs, so trades from MT5 get linked to the TradingView alerts that preceded them.

**Not automated:** TradingView has no public API for chart images or drawings, so chart screenshots still come from you (paste/drag on the trade). Alerts only exist if you create them in TradingView.

## 4. Market data

Not connected. A provider needs an account and key (OANDA practice token or Twelve Data). The client will be built and tested against the provider you choose once a key is available; until then the Market Analysis page uses only your own notes and trades.
