#!/usr/bin/env python3
"""Refresh quotes.json using Nasdaq public APIs (same pattern as tesla-dashboard) plus FX/BTC."""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "quotes.json"
UA = "Mozilla/5.0 (compatible; PortfolioDashboard/1.0; +local)"
SH = ZoneInfo("Asia/Shanghai")
DEFAULT_TICKERS = ["AAPL", "TSLA", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "QQQ", "SPY"]


def http_get_json(url: str, timeout: int = 45, extra_headers: dict | None = None) -> Any:
    headers = {
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def money(s: Any) -> float | None:
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s)
    t = str(s).strip()
    if not t or t.upper() in {"N/A", "NA", "--", "-"}:
        return None
    t = t.replace("$", "").replace(",", "").replace("%", "").replace("+", "")
    try:
        return float(t)
    except ValueError:
        return None


def nasdaq_asset_class(symbol: str) -> str:
    return "etf" if symbol.upper() in {"SPY", "QQQ"} else "stocks"


def nasdaq_quote(symbol: str) -> dict:
    asset = nasdaq_asset_class(symbol)
    url = f"https://api.nasdaq.com/api/quote/{symbol}/info?assetclass={asset}"
    data = http_get_json(
        url,
        extra_headers={"Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"},
    ).get("data") or {}
    primary = data.get("primaryData") or {}
    return {
        "symbol": symbol.upper(),
        "name": data.get("companyName") or symbol.upper(),
        "price": money(primary.get("lastSalePrice")),
        "changePct": money(str(primary.get("percentageChange") or "").replace("%", "")),
        "asOf": primary.get("lastTradeTimestamp"),
        "source": "nasdaq",
    }


def fetch_fx() -> tuple[float | None, str | None]:
    try:
        fx = http_get_json("https://api.frankfurter.dev/v1/latest?from=USD&to=CNY")
        return float(fx["rates"]["CNY"]), fx.get("date")
    except Exception:
        pass
    try:
        fx = http_get_json("https://open.er-api.com/v6/latest/USD")
        return float(fx["rates"]["CNY"]), fx.get("time_last_update_utc")
    except Exception:
        return None, None


def fetch_btc() -> float | None:
    try:
        data = http_get_json(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
        )
        return float(data["bitcoin"]["usd"])
    except Exception:
        pass
    try:
        data = http_get_json("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT")
        return float(data["price"])
    except Exception:
        return None


def main() -> None:
    existing: dict = {}
    if OUT.exists():
        try:
            existing = json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            existing = {}

    tickers = list(dict.fromkeys(
        [*(existing.get("stocks") or {}).keys(), *DEFAULT_TICKERS]
    ))

    stocks: dict[str, dict] = {}
    for sym in tickers:
        try:
            q = nasdaq_quote(sym)
            if q.get("price") is not None:
                stocks[sym.upper()] = q
                print(f"  {sym}: {q['price']}")
            else:
                print(f"  {sym}: no price")
        except Exception as e:
            print(f"  {sym}: ERR {e}")

    usd_cny, fx_date = fetch_fx()
    btc = fetch_btc()
    print(f"  USD/CNY: {usd_cny} ({fx_date})")
    print(f"  BTC-USD: {btc}")

    payload = {
        "updatedAt": datetime.now(SH).isoformat(),
        "usdCny": usd_cny,
        "fxDate": fx_date,
        "btcUsd": btc,
        "stocks": stocks,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
