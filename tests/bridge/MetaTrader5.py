"""
TEST DOUBLE for bridge/mt5_bridge.py. Not a real MetaTrader 5 connection.

The real MetaTrader5 package only runs on Windows next to a logged-in terminal, so the
integration test (scripts/e2e-integrations.mjs) puts this module first on PYTHONPATH to check
that the bridge builds the documented payload and that the journal ingests it.
Field names and order follow the MetaTrader5 docs (history_deals_get / history_orders_get).
Any call to a trading function fails loudly, which also proves the bridge never makes one.
"""
import calendar
from collections import namedtuple

TradeDeal = namedtuple("TradeDeal", "ticket order time time_msc type entry magic position_id reason volume price commission swap profit fee symbol comment external_id")
TradeOrder = namedtuple("TradeOrder", "ticket time_setup type state position_id volume_initial price_open sl tp symbol comment")
AccountInfo = namedtuple("AccountInfo", "login server currency")

# 2026-03-03 10:30 and 12:30 on a UTC+2 server clock (08:30 and 10:30 UTC)
T0 = calendar.timegm((2026, 3, 3, 10, 30, 0))  # MT5 reports server wall-clock time as seconds since 1970


def initialize(*args, **kwargs):
    return True


def last_error():
    return (1, "ok")


def account_info():
    return AccountInfo(login=12345678, server="Demo-Server", currency="USD")


def history_deals_get(date_from, date_to, group=None):
    return (
        TradeDeal(7001, 7001, T0, T0 * 1000, 0, 0, 0, 7001, 0, 1.0, 1.08250, -3.5, 0.0, 0.0, 0.0, "EURUSD.r", "", ""),
        TradeDeal(7002, 7003, T0 + 7200, (T0 + 7200) * 1000, 1, 1, 0, 7001, 0, 1.0, 1.08450, -3.5, 0.0, 200.0, 0.0, "EURUSD.r", "[tp]", ""),
        TradeDeal(7004, 0, T0, T0 * 1000, 2, 0, 0, 0, 0, 0.0, 0.0, 0.0, 0.0, 5000.0, 0.0, "", "Deposit", ""),
    )


def history_orders_get(date_from, date_to, group=None):
    return (
        TradeOrder(7001, T0, 0, 4, 7001, 1.0, 1.08250, 1.08150, 1.08550, "EURUSD.r", ""),
        TradeOrder(7003, T0 + 7200, 1, 4, 7001, 1.0, 1.08450, 0.0, 0.0, "EURUSD.r", "[tp]"),
    )


def shutdown():
    return True


def __getattr__(name):
    raise AttributeError(f"test double: MetaTrader5.{name} is not available (the bridge must not call it)")
