"""
Millionaire Trading Journal: read-only MetaTrader 5 bridge.

Runs on the Windows PC where the MT5 desktop terminal is installed and logged in to your
account. It reads your deal history with the official MetaTrader5 Python package and sends it
to the journal, which turns deals into trades (entry, exit, size, P&L, commission, swap).

Read-only by design. The only MetaTrader5 functions this script calls are:
    initialize, account_info, history_deals_get, history_orders_get, shutdown
It never calls order_send, order_check or anything else that could open, change or close a trade.
It never asks for or sends your broker password: it uses the terminal you are already logged in to.

Setup (Command Prompt):
    pip install MetaTrader5
    set MTJ_URL=https://your-journal.example.com     (or http://localhost:3000 on the same PC)
    set MTJ_KEY=mtj_...                               (Settings → Integrations → MT5 live sync)
    python mt5_bridge.py --check                      (test the connection)
    python mt5_bridge.py --days 90                    (one-off sync of the last 90 days)
    python mt5_bridge.py --watch                      (keep syncing every 60 seconds)

The key is read from the MTJ_KEY environment variable so it doesn't end up in shell history.
The script never prints it.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

try:
    import MetaTrader5 as mt5
except ImportError:  # pragma: no cover
    sys.exit("The MetaTrader5 package is missing. Run: pip install MetaTrader5  (Windows only)")

VERSION = "1.0"
# deal fields sent to the journal; sl/tp exist only on newer terminal builds
DEAL_FIELDS = ("ticket", "order", "position_id", "time", "time_msc", "type", "entry", "symbol", "volume",
               "price", "commission", "swap", "profit", "fee", "magic", "comment", "sl", "tp")


def connect(terminal_path):
    ok = mt5.initialize(terminal_path) if terminal_path else mt5.initialize()
    if not ok:
        sys.exit(f"Could not connect to the MT5 terminal: {mt5.last_error()}. Is MT5 open and logged in?")
    info = mt5.account_info()
    if info is None:
        sys.exit("MT5 is running but not logged in to an account.")
    return info


def collect(days):
    # Deal times are trade-server times, which can be ahead of this PC's clock, so the window is padded.
    to = datetime.now() + timedelta(days=2)
    frm = to - timedelta(days=days + 2)
    deals = mt5.history_deals_get(frm, to) or ()
    orders = mt5.history_orders_get(frm, to) or ()
    out_deals = []
    for d in deals:
        row = d._asdict()
        if row.get("type") not in (0, 1):  # only buy/sell deals; skip balance, credit, etc.
            continue
        out_deals.append({k: row.get(k) for k in DEAL_FIELDS if row.get(k) is not None})
    # the order that opened a position has ticket == position_id; its SL/TP are the initial stops
    out_orders = [
        {"ticket": o.ticket, "position_id": o.position_id, "sl": o.sl or None, "tp": o.tp or None}
        for o in orders if o.ticket == o.position_id
    ]
    return out_deals, out_orders


def post(url, key, payload):
    req = urllib.request.Request(
        url.rstrip("/") + "/api/ingest/mt5",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}", "User-Agent": f"mtj-mt5-bridge/{VERSION}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"Journal answered {e.code}: {detail}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Could not reach the journal at {url}: {e.reason}") from None


def sync(url, key, days, server_tz):
    deals, orders = collect(days)
    # send in chunks the server accepts
    total = {"deals": 0, "created": 0, "updated": 0, "unchanged": 0}
    for i in range(0, max(len(deals), 1), 4000):
        res = post(url, key, {"server_time_zone": server_tz, "deals": deals[i:i + 4000], "orders": orders})
        for k in total:
            total[k] += res.get(k, 0)
    return total


def main():
    p = argparse.ArgumentParser(description="Read-only MT5 → journal sync")
    p.add_argument("--url", default=os.environ.get("MTJ_URL", "http://localhost:3000"))
    p.add_argument("--days", type=int, default=30, help="how many days of history to send (default 30)")
    p.add_argument("--watch", action="store_true", help="keep running and sync every --interval seconds")
    p.add_argument("--interval", type=int, default=60)
    p.add_argument("--check", action="store_true", help="test the MT5 and journal connections, send nothing")
    p.add_argument("--server-tz", default=os.environ.get("MTJ_SERVER_TZ", "BROKER_NY7"),
                   help="timezone of the broker's server clock: BROKER_NY7 (UTC+2/+3, most brokers), UTC, or an IANA name such as Europe/Athens")
    p.add_argument("--terminal", default=os.environ.get("MTJ_TERMINAL"), help="path to terminal64.exe if you run several terminals")
    a = p.parse_args()

    key = os.environ.get("MTJ_KEY", "")
    if not key.startswith("mtj_"):
        sys.exit("Set MTJ_KEY to the API key from Settings → Integrations → MT5 live sync.")

    info = connect(a.terminal)
    print(f"Connected to MT5 account {info.login} on {info.server} ({info.currency}).")
    try:
        if a.check:
            res = post(a.url, key, {"server_time_zone": a.server_tz, "deals": [], "orders": []})
            print(f"Journal reachable at {a.url}. Nothing was sent. ({res})")
            return
        while True:
            try:
                r = sync(a.url, key, a.days, a.server_tz)
                print(f"{datetime.now():%H:%M:%S} sent {r['deals']} deals: {r['created']} new trades, {r['updated']} updated, {r['unchanged']} unchanged")
            except RuntimeError as e:
                print(f"{datetime.now():%H:%M:%S} {e}", file=sys.stderr)
                if not a.watch:
                    sys.exit(1)
            if not a.watch:
                break
            time.sleep(max(15, a.interval))
            a.days = min(a.days, 7)  # after the first pass only recent history can change
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
