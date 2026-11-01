"""Sentinel - autonomous multi-asset trading engine with learning.

Features:
- Multi-agent LLM decision (bull / bear / judge debate)
- Learning: adapts confidence per symbol + video transcript rules
- Full position lifecycle: SL / TP / trailing / LLM exit
- Prop-firm risk rules: daily halt, drawdown halt, loss-streak halt
- Fast-path chat: instant responses for commands
- Handles array responses from LLM (close all positions)
- General chat: answers any question, not just trading
"""

import os, re, json, time, sqlite3, threading
from collections import deque
from datetime import datetime, timedelta

import numpy as np
from dotenv import load_dotenv

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.data.historical import (StockHistoricalDataClient,
                                     CryptoHistoricalDataClient)
from alpaca.data.requests import (StockBarsRequest, StockLatestQuoteRequest,
                                   CryptoBarsRequest, CryptoLatestQuoteRequest)
from alpaca.data.timeframe import TimeFrame

from openai import OpenAI

try:
    from learn import LearningEngine
except ImportError:
    LearningEngine = None

try:
    from video_learn import (extract_video_id, fetch_transcript,
                              extract_lessons)
except ImportError:
    extract_video_id = None
    fetch_transcript = None
    extract_lessons = None


# ============================================================
# MEMORY
# ============================================================

class LayeredMemory:
    def __init__(self, short=20, mid=100, long=500):
        self.short = deque(maxlen=short)
        self.mid = deque(maxlen=mid)
        self.long = deque(maxlen=long)
        self.episodic = []

    def push_tick(self, tick):
        self.short.append(tick)
        self.mid.append(tick)
        self.long.append(tick)

    def push_trade_result(self, trade):
        self.episodic.append(trade)

    def summarize(self):
        if not self.short:
            return "No market data yet."
        p = [t["price"] for t in self.short]
        ret = (p[-1] / p[0] - 1) * 100 if len(p) > 1 else 0.0
        v = [t.get("volume", 0) for t in self.short]
        s = (f"Recent {len(p)} ticks: move {ret:+.2f}%. "
             f"Last {p[-1]:.4f}. Avg vol {np.mean(v):.0f}.")
        recent_losses = [t for t in self.episodic[-5:] if t.get("pnl_pct", 0) < 0]
        if recent_losses:
            losses = ", ".join(f"{t['symbol']} {t['pnl_pct']:+.1f}%"
                               for t in recent_losses[-3:])
            s += f" Recent losses: {losses}."
        return s


# ============================================================
# RISK ENGINE
# ============================================================

class RiskEngine:
    def __init__(self, cfg):
        self.cfg = cfg
        self.start_of_day_equity = None
        self.peak_equity = None
        self.consecutive_losses = 0
        self.halted = False
        self.halt_reason = ""

    def update_equity(self, e):
        if self.start_of_day_equity is None:
            self.start_of_day_equity = e
        if self.peak_equity is None or e > self.peak_equity:
            self.peak_equity = e

    def record_trade(self, pnl_pct):
        if pnl_pct < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0
        if self.consecutive_losses >= self.cfg.get("consecutive_loss_halt", 3):
            self.halted = True
            self.halt_reason = f"{self.consecutive_losses} consecutive losses"

    def full_report(self, account, positions, decision, entry, atr, is_crypto):
        eq = account["equity"]
        self.update_equity(eq)
        r = {"approved": False, "reason": "", "size_pct": 0.0, "qty": 0,
             "stop_loss": 0.0, "take_profit": 0.0, "risk_amount": 0.0,
             "reward_amount": 0.0, "position_value": 0.0, "checks": []}

        if self.halted:
            r["reason"] = f"HALTED: {self.halt_reason}"
            r["checks"].append(("Global halt", False, self.halt_reason))
            return r
        r["checks"].append(("Global halt", True, "clear"))

        if self.start_of_day_equity:
            dd = (self.start_of_day_equity - eq) / self.start_of_day_equity
            ok = dd < self.cfg["max_daily_loss_pct"]
            r["checks"].append(("Daily drawdown", ok, f"{dd*100:.2f}%"))
            if not ok:
                self.halted = True
                self.halt_reason = f"Daily DD {dd*100:.2f}%"
                r["reason"] = self.halt_reason
                return r
        else:
            r["checks"].append(("Daily drawdown", True, "0.00%"))

        if self.peak_equity:
            dd = (self.peak_equity - eq) / self.peak_equity
            ok = dd < self.cfg["max_total_drawdown_pct"]
            r["checks"].append(("Total drawdown", ok, f"{dd*100:.2f}%"))
            if not ok:
                self.halted = True
                self.halt_reason = f"Total DD {dd*100:.2f}%"
                r["reason"] = self.halt_reason
                return r
        else:
            r["checks"].append(("Total drawdown", True, "0.00%"))

        ok = len(positions) < self.cfg["max_concurrent_positions"]
        r["checks"].append(("Concurrent positions", ok,
            f"{len(positions)}/{self.cfg['max_concurrent_positions']}"))
        if not ok:
            r["reason"] = "Max concurrent positions"
            return r

        if is_crypto:
            cc = sum(1 for p in positions if "/" in p["symbol"])
            ok = cc < self.cfg["max_crypto_positions"]
            r["checks"].append(("Crypto positions", ok,
                f"{cc}/{self.cfg['max_crypto_positions']}"))
            if not ok:
                r["reason"] = "Max crypto positions"
                return r

        if decision["action"] == "HOLD":
            r["reason"] = "LLM says HOLD"
            r["checks"].append(("LLM verdict", False, "HOLD"))
            return r
        r["checks"].append(("LLM verdict", True, decision["action"]))

        conf = decision.get("confidence", 0)
        ok = conf >= self.cfg["min_confidence"]
        r["checks"].append(("Confidence", ok, f"{conf:.2f}"))
        if not ok:
            r["reason"] = f"Low confidence {conf:.2f}"
            return r

        sp = min(self.cfg["max_position_pct"],
                 self.cfg["max_position_pct"] * conf)
        notional = eq * sp

        if is_crypto:
            qty = round(max(0.0001, notional / entry), 6)
        else:
            qty = max(1, int(notional / entry))

        actual = qty * entry
        if actual > eq * self.cfg["max_position_pct"] * 1.5:
            r["reason"] = f"Size sanity: ${actual:.0f} too large"
            r["checks"].append(("Size sanity", False, r["reason"]))
            return r
        r["checks"].append(("Size sanity", True, f"${actual:.0f}"))

        d = atr * self.cfg["atr_stop_multiplier"]
        rr = self.cfg["risk_reward_ratio"]
        dec = 4 if is_crypto else 2
        if decision["action"] == "BUY":
            sl = round(entry - d, dec)
            tp = round(entry + d * rr, dec)
        else:
            sl = round(entry + d, dec)
            tp = round(entry - d * rr, dec)

        ra = abs(entry - sl) * qty
        wa = abs(tp - entry) * qty
        rra = wa / max(ra, 0.01)

        r.update({"approved": True, "reason": "approved", "size_pct": sp,
                  "qty": qty, "stop_loss": sl, "take_profit": tp,
                  "risk_amount": ra, "reward_amount": wa,
                  "position_value": qty * entry})
        r["checks"].append(("Position size", True, f"{sp*100:.2f}%"))
        r["checks"].append(("Risk/reward", rra >= rr - 0.05, f"{rra:.2f}:1"))
        return r


# ============================================================
# CONFIG
# ============================================================

def load_config():
    load_dotenv(override=True)

    def get(k, d=None, req=False):
        v = os.environ.get(k, d)
        if req and not v:
            raise ValueError(f"Missing env var: {k}")
        return v

    gf = [m.strip() for m in
          get("GROQ_FALLBACKS", "qwen/qwen3.8-27b").split(",") if m.strip()]
    nf = [m.strip() for m in
          get("NIM_FALLBACKS",
              "deepseek-ai/deepseek-v4.1-flash,"
              "google/gemma-4-31b-it").split(",") if m.strip()]

    return {
        "alpaca_key": get("ALPACA_API_KEY", req=True),
        "alpaca_secret": get("ALPACA_SECRET_KEY", req=True),
        "groq_key": get("GROQ_API_KEY", req=True),
        "nvidia_key": get("NVIDIA_API_KEY", ""),
        # Live brokerage is opt-in twice: the operator must explicitly enable
        # it, and ALPACA_PAPER_TRADE must be false. Otherwise force paper mode.
        "paper": (
            get("ALPACA_PAPER_TRADE", "true").lower() != "false"
            or get("SENTINEL_LIVE_TRADING_ENABLED", "false").lower() != "true"
        ),
        "live_trading_enabled": (
            get("SENTINEL_LIVE_TRADING_ENABLED", "false").lower() == "true"
        ),
        "model_judge": get("LLM_MODEL_JUDGE", "openai/gpt-oss-20b"),
        "model_debate": get("LLM_MODEL_DEBATE", "openai/gpt-oss-20b"),
        "model_research": get("LLM_MODEL_RESEARCH", "openai/gpt-oss-20b"),
        "groq_fallbacks": gf,
        "nim_fallbacks": nf,
        "symbols": [s.strip().upper() for s in
                    get("SYMBOLS", "AAPL,MSFT,NVDA,SPY").split(",") if s.strip()],
        "crypto_symbols": [s.strip().upper() for s in
                           get("CRYPTO_SYMBOLS", "BTC/USD,ETH/USD").split(",")
                           if s.strip()],
        "cycle_seconds": int(get("CYCLE_SECONDS", "3600")),
        "entry_cooldown_seconds": int(get("ENTRY_COOLDOWN_SECONDS", "3600")),
        "research_every_n": int(get("RESEARCH_EVERY_N", "20")),
        "screen_top_stocks": int(get("SCREEN_TOP_STOCKS", "5")),
        "screen_top_crypto": int(get("SCREEN_TOP_CRYPTO", "2")),
        "max_position_pct": float(get("MAX_POSITION_PCT", "0.03")),
        "max_daily_loss_pct": float(get("MAX_DAILY_LOSS_PCT", "0.02")),
        "max_total_drawdown_pct": float(get("MAX_TOTAL_DRAWDOWN_PCT", "0.06")),
        "max_concurrent_positions": int(get("MAX_CONCURRENT_POSITIONS", "5")),
        "max_crypto_positions": int(get("MAX_CRYPTO_POSITIONS", "3")),
        "risk_reward_ratio": float(get("RISK_REWARD_RATIO", "2.0")),
        "atr_stop_multiplier": float(get("ATR_STOP_MULTIPLIER", "1.5")),
        "min_confidence": float(get("MIN_CONFIDENCE", "0.55")),
        "consecutive_loss_halt": int(get("CONSECUTIVE_LOSS_HALT", "3")),
        "trailing_trigger_pct": float(get("TRAILING_TRIGGER_PCT", "3.0")),
        "enable_browser": get("ENABLE_BROWSER", "false").lower() == "true",
        "journal_path": get("JOURNAL_PATH", "trades.db"),
    }


# ============================================================
# JOURNAL
# ============================================================

class TradeJournal:
    def __init__(self, path):
        self.path = path
        self._lock = threading.Lock()
        with sqlite3.connect(self.path) as c:
            c.execute("""CREATE TABLE IF NOT EXISTS decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT, symbol TEXT, action TEXT, confidence REAL,
                reason TEXT, bull TEXT, bear TEXT, approved INTEGER,
                qty REAL, entry REAL, stop_loss REAL,
                take_profit REAL, order_id TEXT)""")
            c.execute("""CREATE TABLE IF NOT EXISTS closed_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                opened_ts TEXT, closed_ts TEXT, symbol TEXT,
                side TEXT, qty REAL, entry REAL, exit REAL,
                pnl REAL, pnl_pct REAL, close_reason TEXT)""")
            c.commit()

    def log(self, **kw):
        with self._lock, sqlite3.connect(self.path) as c:
            c.execute("""INSERT INTO decisions
                (ts,symbol,action,confidence,reason,bull,bear,approved,
                 qty,entry,stop_loss,take_profit,order_id)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
                datetime.utcnow().isoformat(),
                kw.get("symbol",""), kw.get("action",""),
                kw.get("confidence",0.0), kw.get("reason",""),
                kw.get("bull",""), kw.get("bear",""),
                1 if kw.get("approved") else 0,
                kw.get("qty",0), kw.get("entry",0.0),
                kw.get("stop_loss",0.0), kw.get("take_profit",0.0),
                kw.get("order_id","")))
            c.commit()

    def log_close(self, **kw):
        with self._lock, sqlite3.connect(self.path) as c:
            c.execute("""INSERT INTO closed_trades
                (opened_ts, closed_ts, symbol, side, qty, entry, exit,
                 pnl, pnl_pct, close_reason)
                VALUES (?,?,?,?,?,?,?,?,?,?)""", (
                kw.get("opened_ts",""), datetime.utcnow().isoformat(),
                kw.get("symbol",""), kw.get("side",""), kw.get("qty",0),
                kw.get("entry",0.0), kw.get("exit",0.0),
                kw.get("pnl",0.0), kw.get("pnl_pct",0.0),
                kw.get("close_reason","")))
            c.commit()


# ============================================================
# SENTINEL ENGINE
# ============================================================

class SentinelEngine:
    SYS_BULL = (
        "You are a bullish trading analyst. Argue concisely WHY this trade "
        "should be taken. Max 100 words."
    )

    SYS_BEAR = (
        "You are a bearish risk analyst. Argue concisely WHY this trade "
        "should NOT be taken. Max 100 words."
    )

    SYS_JUDGE = (
        'You are the portfolio risk manager. Decide direction and confidence '
        'ONLY. Do NOT calculate position sizes. Output ONLY valid JSON: '
        '{"action": "BUY"|"SELL"|"HOLD", "confidence": 0-1, "reason": "..."}. '
        'BUY if the bull case is stronger. HOLD only if truly balanced.'
    )

    SYS_EXIT = (
        'Should Sentinel close this position now? Output ONLY JSON: '
        '{"action": "HOLD"|"CLOSE", "confidence": 0-1, "reason": "..."}. '
        'CLOSE if momentum reversed, thesis broke, or taking profit is prudent.'
    )

    SYS_RESEARCH = (
        "Find the 2-3 most important recent news items for this asset. "
        "Max 80 words."
    )

    def __init__(self, on_log=None, on_status=None, on_bars=None):
        self.on_log = on_log or (lambda m, l="info": None)
        self.on_status = on_status or (lambda d: None)
        self.on_bars = on_bars or (lambda s, b, t: None)

        self.cfg = load_config()
        self.trade = TradingClient(self.cfg["alpaca_key"],
            self.cfg["alpaca_secret"], paper=self.cfg["paper"])
        self.data = StockHistoricalDataClient(self.cfg["alpaca_key"],
            self.cfg["alpaca_secret"])
        self.crypto_data = CryptoHistoricalDataClient()

        self.llm = OpenAI(api_key=self.cfg["groq_key"],
                          base_url="https://api.groq.com/openai/v1")
        self.llm_nim = None
        if self.cfg["nvidia_key"]:
            self.llm_nim = OpenAI(api_key=self.cfg["nvidia_key"],
                base_url="https://integrate.api.nvidia.com/v1")

        self.memory = {}
        self.risk = RiskEngine(self.cfg)
        self.journal = TradeJournal(self.cfg["journal_path"])
        self.learner = LearningEngine(self.cfg["journal_path"]) if LearningEngine else None
        self._active_trades = {}
        self._pending_entries = {}
        self._stop_event = threading.Event()
        self._thread = None
        self._last_day = None
        self._equity_curve = []
        self._cycle_count = 0
        self._research_cache = {}

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def is_running(self):
        return self._thread is not None and self._thread.is_alive()

    def _log(self, m, l="info"):
        try:
            self.on_log(m, l)
        except Exception:
            pass

    def _emit(self, **kw):
        try:
            self.on_status(kw)
        except Exception:
            pass

    def _bars_emit(self, s, b, t):
        try:
            self.on_bars(s, b, t)
        except Exception:
            pass

    # ---------- LLM ----------

    def _llm_call(self, client, model, system, user, temp=0.3, json_mode=False,
                  max_tokens=500):
        kwargs = {"model": model,
                  "messages": [{"role":"system","content":system},
                               {"role":"user","content":user}],
                  "temperature": temp, "max_tokens": max_tokens}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        r = client.chat.completions.create(**kwargs)
        return (r.choices[0].message.content or "").strip()

    def _call(self, primary, system, user, temp=0.3, json_mode=False,
              max_tokens=500):
        chain = [("groq", self.llm, primary)]
        for m in self.cfg["groq_fallbacks"]:
            if m != primary:
                chain.append(("groq", self.llm, m))
        if self.llm_nim:
            for m in self.cfg["nim_fallbacks"]:
                chain.append(("nim", self.llm_nim, m))
        last = None
        for prov, cli, mod in chain:
            try:
                return self._llm_call(cli, mod, system, user, temp,
                                       json_mode, max_tokens)
            except Exception as e:
                last = e
                s = str(e).lower()
                if any(x in str(e) for x in ("429","410","404")) or any(
                    x in s for x in ("rate_limit","tokens per day",
                    "not found","model_not_found","end of life",
                    "decommissioned","no longer available")):
                    self._log(f"{prov}:{mod} unavailable, trying next", "warn")
                    continue
                raise
        raise last

    def _debate(self, symbol, context, constraints, research=""):
        asset = "CRYPTO" if "/" in symbol else "STOCK/ETF"
        bu = f"Symbol: {symbol} ({asset})\nContext:\n{context}"
        be = f"Symbol: {symbol} ({asset})\nContext:\n{context}"
        if research:
            bu += f"\n\nResearch:\n{research}"
            be += f"\n\nResearch:\n{research}"
        bull = self._call(self.cfg["model_debate"], self.SYS_BULL, bu)
        bear = self._call(self.cfg["model_debate"], self.SYS_BEAR, be)

        lessons_txt = ""
        if self.learner:
            summary = self.learner.learned_summary()
            if "No lessons" not in summary:
                lessons_txt = f"\n\nLEARNED FROM PAST:\n{summary}"

        ji = (f"Symbol: {symbol}\n\nBULL:\n{bull}\n\nBEAR:\n{bear}\n\n"
              f"CONSTRAINTS:\n{constraints}{lessons_txt}\n\nDecide. JSON only.")
        try:
            v = self._call(self.cfg["model_judge"], self.SYS_JUDGE, ji, 0.0, True)
            v = re.sub(r"```json|```", "", v).strip()
            d = json.loads(v)
        except Exception:
            d = {"action": "HOLD", "confidence": 0.0, "reason": "parse_fail"}
        d["bull"] = bull
        d["bear"] = bear
        return d

    # ---------- broker ----------

    def _account(self):
        a = self.trade.get_account()
        return {"equity": float(a.equity),
                "buying_power": float(a.buying_power)}

    def _positions(self):
        out = []
        crypto_map = {s.replace("/", ""): s for s in self.cfg["crypto_symbols"]}
        for p in self.trade.get_all_positions():
            sym = p.symbol
            if "/" not in sym and sym in crypto_map:
                sym = crypto_map[sym]
            out.append({
                "symbol": sym, "qty": float(p.qty),
                "avg_entry": float(p.avg_entry_price),
                "current_price": float(p.current_price) if p.current_price else 0.0,
                "market_value": float(p.market_value),
                "unrealized_pl": float(p.unrealized_pl),
                "unrealized_plpc": float(p.unrealized_plpc) * 100,
            })
        return out

    def _bars(self, symbol, days=90):
        if "/" in symbol:
            req = CryptoBarsRequest(symbol_or_symbols=symbol,
                                     timeframe=TimeFrame.Day,
                                     start=datetime.now() - timedelta(days=days))
            return self.crypto_data.get_crypto_bars(req).df
        req = StockBarsRequest(symbol_or_symbols=symbol,
                                timeframe=TimeFrame.Day,
                                start=datetime.now() - timedelta(days=days))
        return self.data.get_stock_bars(req).df

    def _quote(self, symbol):
        if "/" in symbol:
            req = CryptoLatestQuoteRequest(symbol_or_symbols=symbol)
            q = self.crypto_data.get_crypto_latest_quote(req)[symbol]
        else:
            req = StockLatestQuoteRequest(symbol_or_symbols=symbol)
            q = self.data.get_stock_latest_quote(req)[symbol]
        bid = float(q.bid_price)
        ask = float(q.ask_price)
        return {"bid": bid, "ask": ask, "mid": (bid + ask) / 2}

    def _submit(self, symbol, qty, side):
        is_crypto = "/" in symbol
        tif = TimeInForce.GTC if is_crypto else TimeInForce.DAY
        o = MarketOrderRequest(symbol=symbol, qty=qty,
            side=OrderSide.BUY if side == "BUY" else OrderSide.SELL,
            time_in_force=tif)
        return self.trade.submit_order(o)

    @staticmethod
    def _atr(df, p=14):
        h, l, c = df["high"].values, df["low"].values, df["close"].values
        tr = np.maximum(h[1:]-l[1:],
                        np.maximum(abs(h[1:]-c[:-1]), abs(l[1:]-c[:-1])))
        return float(np.mean(tr[-p:])) if len(tr) >= p else float(np.mean(tr))

    def _df_to_bars(self, symbol, df, n=30):
        out = []
        try:
            for ts, row in df.tail(n).iterrows():
                stamp = ts[1] if isinstance(ts, tuple) else ts
                out.append({"t": str(stamp),
                            "o": float(row["open"]), "h": float(row["high"]),
                            "l": float(row["low"]), "c": float(row["close"]),
                            "v": float(row["volume"]), "symbol": symbol})
        except Exception:
            pass
        return out

    # ---------- position management ----------

    def _close_position(self, symbol, reason):
        try:
            self.trade.close_position(symbol)
        except Exception as e:
            self._log(f"[{symbol}] close failed: {e}", "error")
            return False

        track = self._active_trades.get(symbol)
        if track:
            try:
                q = self._quote(symbol)
                exit_price = q["mid"]
                entry = track["entry"]
                qty = track["qty"]
                side = track["side"]
                if side == "BUY":
                    pnl = (exit_price - entry) * qty
                    pnl_pct = (exit_price / entry - 1) * 100
                else:
                    pnl = (entry - exit_price) * qty
                    pnl_pct = (entry / exit_price - 1) * 100

                self.journal.log_close(
                    opened_ts=track.get("opened_at", ""),
                    symbol=symbol, side=side, qty=qty,
                    entry=entry, exit=exit_price,
                    pnl=pnl, pnl_pct=pnl_pct, close_reason=reason)

                if symbol in self.memory:
                    self.memory[symbol].push_trade_result({
                        "symbol": symbol, "side": side,
                        "entry": entry, "exit": exit_price,
                        "pnl_pct": pnl_pct})
                self.risk.record_trade(pnl_pct)
                if self.learner:
                    self.learner.record_trade(
                        symbol=symbol, pnl_pct=pnl_pct, pnl_dollar=pnl,
                        side=side, reason=reason)

                self._log(f"[{symbol}] CLOSED {reason} -- "
                          f"P/L ${pnl:+.2f} ({pnl_pct:+.2f}%)", "trade")
                del self._active_trades[symbol]
                return True
            except Exception as e:
                self._log(f"[{symbol}] close bookkeeping error: {e}", "warn")
        return True

    def _check_positions(self, positions):
        for p in positions:
            symbol = p["symbol"]
            track = self._active_trades.get(symbol)

            if not track:
                try:
                    bars = self._bars(symbol)
                    atr = self._atr(bars)
                    dec = 4 if "/" in symbol else 2
                    sl = round(p["avg_entry"] - atr * self.cfg["atr_stop_multiplier"], dec)
                    tp = round(p["avg_entry"] + atr * self.cfg["atr_stop_multiplier"]
                               * self.cfg["risk_reward_ratio"], dec)
                    self._active_trades[symbol] = {
                        "symbol": symbol, "side": "BUY", "qty": p["qty"],
                        "entry": p["avg_entry"], "sl": sl, "tp": tp,
                        "order_id": "adopted",
                        "opened_at": datetime.utcnow().isoformat(),
                        "opened_ts": time.time()}
                    self._log(f"[{symbol}] adopted SL=${sl} TP=${tp}", "info")
                    track = self._active_trades[symbol]
                except Exception as e:
                    self._log(f"[{symbol}] adopt failed: {e}", "warn")
                    continue

            cur = p["current_price"]
            sl = track.get("sl", 0)
            tp = track.get("tp", 0)
            side = track.get("side", "BUY")

            if side == "BUY":
                if sl > 0 and cur <= sl:
                    self._close_position(symbol, f"stop-loss (${cur:.4f} <= ${sl:.4f})")
                    continue
                if tp > 0 and cur >= tp:
                    self._close_position(symbol, f"take-profit (${cur:.4f} >= ${tp:.4f})")
                    continue
            else:
                if sl > 0 and cur >= sl:
                    self._close_position(symbol, f"stop-loss (${cur:.4f} >= ${sl:.4f})")
                    continue
                if tp > 0 and cur <= tp:
                    self._close_position(symbol, f"take-profit (${cur:.4f} <= ${tp:.4f})")
                    continue

            pnl_pct = p["unrealized_plpc"]
            if (side == "BUY"
                    and pnl_pct >= self.cfg["trailing_trigger_pct"]
                    and sl < p["avg_entry"]):
                dec = 4 if "/" in symbol else 2
                new_sl = round(p["avg_entry"] * 1.001, dec)
                track["sl"] = new_sl
                self._log(f"[{symbol}] trailing stop raised to ${new_sl} "
                          f"(+{pnl_pct:.1f}%)", "trade")

            try:
                self._evaluate_exit(symbol, p, track)
            except Exception as e:
                self._log(f"[{symbol}] exit eval failed: {e}", "warn")

    def _evaluate_exit(self, symbol, position, track):
        entry = track["entry"]
        cur = position["current_price"]
        pnl_pct = position["unrealized_plpc"]
        side = track["side"]
        context = (f"Position: {side} {track['qty']} {symbol}\n"
                   f"Entry: ${entry:.4f}  Now: ${cur:.4f}  P/L: {pnl_pct:+.2f}%\n"
                   f"Stop: ${track['sl']:.4f}  Target: ${track['tp']:.4f}")
        prompt = f"Decide whether to close {symbol} now. Context:\n{context}"
        try:
            v = self._call(self.cfg["model_judge"], self.SYS_EXIT, prompt, 0.0, True)
            v = re.sub(r"```json|```", "", v).strip()
            d = json.loads(v)
        except Exception:
            return
        if d.get("action") == "CLOSE" and d.get("confidence", 0) >= 0.7:
            reason = f"LLM exit ({d.get('confidence',0):.2f}): {d.get('reason','')[:80]}"
            self._close_position(symbol, reason)

    # ---------- analysis ----------

    def analyze_symbol(self, symbol):
        symbol = symbol.upper().strip()
        try:
            account = self._account()
            positions = self._positions()
        except Exception as e:
            return {"ok": False, "error": f"Broker error: {e}"}

        try:
            bars = self._bars(symbol)
        except Exception as e:
            return {"ok": False, "error": f"No data for {symbol}: {e}"}
        if len(bars) < 20:
            return {"ok": False, "error": "Not enough history"}

        try:
            q = self._quote(symbol)
        except Exception as e:
            return {"ok": False, "error": f"No quote: {e}"}

        atr = self._atr(bars)
        is_crypto = "/" in symbol

        if symbol not in self.memory:
            self.memory[symbol] = LayeredMemory()
        self.memory[symbol].push_tick({
            "symbol": symbol, "price": q["mid"],
            "volume": int(bars["volume"].iloc[-1]),
            "timestamp": datetime.utcnow().isoformat(), "atr": atr})

        mem = self.memory[symbol].summarize()
        pos_str = ", ".join(f"{p['symbol']}:{p['qty']:.4f}"
                             for p in positions) or "none"
        context = (f"Equity: ${account['equity']:.2f}\n"
                   f"Buying power: ${account['buying_power']:.2f}\n"
                   f"Open: {pos_str}\nMemory: {mem}")
        c = self.cfg
        cons = (f"Risk engine handles sizing. "
                f"Max {c['max_position_pct']*100:.0f}% per position. "
                f"Max {c['max_concurrent_positions']} positions.")

        decision = self._debate(symbol, context, cons, "")

        if self.learner:
            bias = self.learner.confidence_adjustment(symbol)
            if bias:
                original = decision.get("confidence", 0)
                decision["confidence"] = max(0.0, min(1.0, original + bias))
                self._log(f"[{symbol}] learned bias {bias:+.2f} -> "
                          f"conf {original:.2f} -> {decision['confidence']:.2f}",
                          "info")

        if decision["action"] == "SELL":
            held = any(p["symbol"] == symbol and float(p["qty"]) > 0
                       for p in positions)
            if not held:
                self._log(f"[{symbol}] SELL but not held -- skip", "info")
                return {"ok": False, "symbol": symbol, "action": "SELL",
                        "confidence": decision.get("confidence", 0),
                        "reason": f"Cannot short {symbol} (not held)",
                        "decision_reason": decision.get("reason", ""),
                        "bull": decision.get("bull",""),
                        "bear": decision.get("bear","")}

        report = self.risk.full_report(account, positions, decision,
                                        q["mid"], atr, is_crypto)
        bar_list = self._df_to_bars(symbol, bars, 30)
        self._bars_emit(symbol, bar_list, None)

        if not report["approved"]:
            return {"ok": False, "symbol": symbol,
                    "action": decision["action"],
                    "confidence": decision.get("confidence", 0),
                    "reason": report["reason"],
                    "decision_reason": decision.get("reason", ""),
                    "bull": decision.get("bull",""),
                    "bear": decision.get("bear","")}

        return {"ok": True, "symbol": symbol,
                "action": decision["action"],
                "confidence": decision.get("confidence", 0),
                "reason": decision.get("reason", ""),
                "bull": decision.get("bull",""),
                "bear": decision.get("bear",""),
                "entry": q["mid"], "qty": report["qty"],
                "stop_loss": report["stop_loss"],
                "take_profit": report["take_profit"],
                "risk_amount": report["risk_amount"],
                "reward_amount": report["reward_amount"],
                "is_crypto": is_crypto,
                "checks": report["checks"]}

    def execute_proposal(self, p):
        symbol = p["symbol"]
        try:
            order = self._submit(symbol, p["qty"], p["action"])
        except Exception as e:
            return {"ok": False, "error": str(e)}

        self._active_trades[symbol] = {
            "symbol": symbol, "side": p["action"], "qty": p["qty"],
            "entry": p["entry"], "sl": p["stop_loss"], "tp": p["take_profit"],
            "order_id": str(order.id),
            "opened_at": datetime.utcnow().isoformat(),
            "opened_ts": time.time()}
        self._pending_entries[symbol] = time.time()

        try:
            self.journal.log(symbol=symbol, action=p["action"],
                confidence=p.get("confidence", 0),
                reason=p.get("reason", ""),
                bull=p.get("bull",""), bear=p.get("bear",""),
                approved=True, qty=p["qty"], entry=p["entry"],
                stop_loss=p["stop_loss"], take_profit=p["take_profit"],
                order_id=str(order.id))
        except Exception:
            pass

        return {"ok": True, "order_id": str(order.id),
                "symbol": symbol, "qty": p["qty"],
                "side": p["action"], "entry": p["entry"]}

    # ---------- main loop ----------

    def _run(self):
        mode = "PAPER" if self.cfg["paper"] else "LIVE"
        self._log(f"Sentinel v4.1 started - {mode}", "info")
        self._log(f"Learning: {'ON' if self.learner else 'OFF'}", "info")
        self._log(f"Video learning: {'ON' if extract_video_id else 'OFF'}",
                  "info")
        self._log(f"Cooldown: {self.cfg['entry_cooldown_seconds']}s", "info")
        self._log(f"Max positions: {self.cfg['max_concurrent_positions']}", "info")
        while not self._stop_event.is_set():
            try:
                self._cycle()
            except Exception as e:
                self._log(f"Cycle error: {e}", "error")
            for _ in range(self.cfg["cycle_seconds"] * 10):
                if self._stop_event.is_set():
                    break
                time.sleep(0.1)
        self._log("Sentinel stopped.", "info")

    def _cycle(self):
        self._cycle_count += 1
        try:
            a = self._account()
            ps = self._positions()
        except Exception as e:
            self._log(f"Broker error: {e}", "error")
            return

        self._equity_curve.append((datetime.utcnow().isoformat(), a["equity"]))
        if len(self._equity_curve) > 500:
            self._equity_curve = self._equity_curve[-500:]

        live = {p["symbol"] for p in ps}
        for s in list(self._active_trades.keys()):
            if s not in live and self._active_trades[s].get("order_id") != "adopted":
                del self._active_trades[s]

        self._emit(equity=a["equity"], buying_power=a["buying_power"],
                   positions=ps, halted=self.risk.halted,
                   halt_reason=self.risk.halt_reason,
                   mode="PAPER" if self.cfg["paper"] else "LIVE",
                   equity_curve=list(self._equity_curve),
                   cycle=self._cycle_count)

        self._log(f"Cycle #{self._cycle_count} - equity "
                  f"${a['equity']:.2f}, {len(ps)} positions", "info")

        if ps:
            self._check_positions(ps)
            try:
                ps = self._positions()
            except Exception:
                pass

        held = {p["symbol"] for p in ps}
        cooldown = self.cfg["entry_cooldown_seconds"]
        now = time.time()

        candidates = self.cfg["symbols"][:self.cfg["screen_top_stocks"]]
        candidates += self.cfg["crypto_symbols"][:self.cfg["screen_top_crypto"]]

        for s in candidates:
            if self._stop_event.is_set():
                break
            if s in held:
                continue
            last_entry = self._pending_entries.get(s, 0)
            if now - last_entry < cooldown:
                continue
            if len(ps) >= self.cfg["max_concurrent_positions"]:
                self._log(f"[{s}] max positions reached", "info")
                break

            try:
                r = self.analyze_symbol(s)
                if r.get("ok"):
                    self._log(f"[{s}] APPROVED {r['action']} qty={r['qty']}",
                              "trade")
                    res = self.execute_proposal(r)
                    if res.get("ok"):
                        self._log(f"[{s}] order submitted: {res['order_id']}",
                                  "trade")
                        try:
                            ps = self._positions()
                            held = {p["symbol"] for p in ps}
                        except Exception:
                            pass
                else:
                    self._log(f"[{s}] {r.get('reason','no trade')}", "info")
            except Exception as e:
                self._log(f"[{s}] error: {e}", "error")
            time.sleep(1.0)

        today = datetime.utcnow().date()
        if self._last_day != today:
            if self._last_day is not None:
                self.risk.start_of_day_equity = a["equity"]
            self._last_day = today


TraderEngine = SentinelEngine


# ============================================================
# CHAT ENGINE (with array action support)
# ============================================================

class ChatEngine:
    SYS = (
        "You are Sentinel, a general-purpose AI assistant with deep knowledge "
        "of trading, markets, and technology. You can answer ANY question "
        "the user asks - coding, math, science, history, advice, opinions, "
        "explanations, jokes, whatever. You are not limited to trading.\n\n"
        "You also control a live paper trading bot. When the user wants you "
        "to DO something with the bot, output ONLY valid JSON:\n"
        '{"action":"analyze","symbol":"AAPL"}\n'
        '{"action":"quote","symbol":"AAPL"}\n'
        '{"action":"positions"}\n'
        '{"action":"cash"}\n'
        '{"action":"close","symbol":"AAPL"}\n'
        '{"action":"close_all"}\n'
        '{"action":"confirm"}\n'
        '{"action":"cancel"}\n'
        '{"action":"lessons"}\n\n'
        "If the user asks to close MULTIPLE positions, output a JSON array:\n"
        '[{"action":"close","symbol":"AAPL"},{"action":"close","symbol":"MSFT"}]\n'
        "If the user asks to close ALL positions, output: "
        '{"action":"close_all"}\n\n'
        "For EVERYTHING ELSE - questions, explanations, advice, casual chat, "
        "code help, math, science, definitions, opinions - reply in plain "
        "text like ChatGPT would. Be helpful, thorough, honest.\n\n"
        "Rules:\n"
        "- If the user asks a question, answer it fully.\n"
        "- If the user asks for code, write the code.\n"
        "- If the user asks for an opinion, give one.\n"
        "- If the user asks about trading commands, output the JSON.\n"
        "- Never refuse a question just because it's not about trading.\n"
        "- Be concise but complete. No filler. No marketing language."
    )

    def __init__(self, engine):
        self.engine = engine
        self.history = deque(maxlen=30)
        self.pending = None
        self._pending_batch = []

    def handle(self, user_msg):
        raw = user_msg.strip()
        cleaned = raw.strip().strip("'\".,!?").strip()
        upper = cleaned.upper()
        no_space = upper.replace(" ", "").replace("'", "").replace("\"", "")

        # ---- YOUTUBE URL DETECTION ----
        if "youtube.com" in raw or "youtu.be" in raw:
            return self._learn_from_video(raw)

        # ---- GOAL CHECK ----
        target_match = re.match(
            r"(?:TARGET|GOAL|MAKE|EARN)\s+\$?([\d,]+(?:\.\d+)?)\s+"
            r"(?:BY|IN)\s+(.+)$", upper)
        if target_match:
            try:
                amount = float(target_match.group(1).replace(",", ""))
                deadline = target_match.group(2).strip()
                return self._set_target(amount, deadline)
            except Exception:
                pass

        # ---- INSTANT COMMANDS ----
        if upper in ("YES","Y","CONFIRM","DO IT","EXECUTE","OK","OKAY"):
            return self._run_action({"action":"confirm"})
        if upper in ("NO","N","CANCEL","NEVER MIND"):
            return self._run_action({"action":"cancel"})
        if upper in ("POSITIONS","POS","HOLDINGS"):
            return self._run_action({"action":"positions"})
        if upper in ("CASH","BALANCE","EQUITY","BUYING POWER"):
            return self._run_action({"action":"cash"})
        if upper in ("LESSONS","LESSON","LEARNED","LEARNING",
                     "WHAT HAVE YOU LEARNED","WHAT DID YOU LEARN"):
            return self._run_action({"action":"lessons"})
        if upper in ("CLOSE ALL","CLOSE ALL POSITIONS","CLOSE EVERYTHING",
                     "SELL ALL","EXIT ALL","LIQUIDATE ALL","FLATTEN"):
            return self._run_action({"action":"close_all"})

        m = re.match(r"^(?:QUOTE|PRICE(?:\s+OF)?)\s+([A-Z0-9/]{1,12})$", upper)
        if m:
            return self._run_action({"action":"quote","symbol":m.group(1)})

        m = re.match(r"^(?:CLOSE|SELL|EXIT|DUMP)\s+([A-Z0-9/]{1,12})$", upper)
        if m:
            return self._run_action({"action":"close","symbol":m.group(1)})

        m = re.match(r"^(?:ANALYZE|ANALYSE|LOOK\s+AT|CHECK)\s+([A-Z0-9/]{1,12})$", upper)
        if m:
            return self._do_analyze(m.group(1))

        if re.fullmatch(r"[A-Z]{1,6}(/[A-Z]{2,4})?", no_space):
            return self._do_analyze(no_space)

        # ---- GENERAL LLM PATH ----
        try:
            account = self.engine._account()
            positions = self.engine._positions()
            pos_str = ", ".join(f"{p['symbol']}:{p['qty']:.4f}"
                                 for p in positions) or "none"
            context = (f"BOT CONTEXT (only relevant if user asks about the bot):\n"
                       f"Equity: ${account['equity']:.2f}, "
                       f"BP: ${account['buying_power']:.2f}\n"
                       f"Open positions: {pos_str}")
        except Exception as e:
            context = f"(Broker error: {e})"

        pending_txt = ""
        if self.pending:
            p = self.pending
            pending_txt = (f"\nPENDING PROPOSAL: {p['action']} {p['qty']} "
                           f"{p['symbol']} @ {p['entry']:.4f}")

        conv_hist = ""
        if len(self.history) > 0:
            recent = list(self.history)[-6:]
            conv_hist = "\n\nRECENT CONVERSATION:\n"
            for h in recent:
                role = "User" if h["role"] == "user" else "Sentinel"
                msg = h["content"][:200]
                conv_hist += f"{role}: {msg}\n"

        full_sys = self.SYS + "\n\n" + context + pending_txt + conv_hist

        try:
            reply = self.engine._call(
                self.engine.cfg["model_judge"], full_sys, cleaned, temp=0.5,
                max_tokens=800)
        except Exception as e:
            reply = f"[LLM error: {e}]"

        if self.engine.learner:
            try:
                self.engine.learner.record_conversation("user", user_msg)
                self.engine.learner.record_conversation("bot", reply)
            except Exception:
                pass

        self.history.append({"role":"user","content":user_msg})
        action = self._parse_action(reply)
        if action:
            result = self._run_action(action)
            self.history.append({"role":"assistant","content":result["reply"]})
            return result
        self.history.append({"role":"assistant","content":reply})
        return {"reply": reply, "pending": self.pending, "type": "text"}

    def _learn_from_video(self, url):
        if extract_video_id is None or fetch_transcript is None:
            return {"reply": "Video learning module not loaded.",
                    "pending": self.pending, "type": "text"}

        vid = extract_video_id(url)
        if not vid:
            return {"reply": "Could not parse YouTube URL.",
                    "pending": self.pending, "type": "text"}

        transcript, err = fetch_transcript(vid)
        if err or not transcript:
            return {"reply": f"Could not read transcript: {err}",
                    "pending": self.pending, "type": "text"}

        def _llm(system, user):
            return self.engine._call(
                self.engine.cfg["model_judge"], system, user, temp=0.2,
                max_tokens=800)

        try:
            lessons = extract_lessons(transcript, _llm)
        except Exception as e:
            return {"reply": f"Extraction failed: {e}",
                    "pending": self.pending, "type": "text"}

        if not lessons:
            return {"reply": (f"Read {len(transcript):,} chars of transcript "
                              f"but found no actionable trading rules."),
                    "pending": self.pending, "type": "text"}

        stored = 0
        lines = []
        for lesson in lessons:
            rule = lesson.get("rule", "")
            cat = lesson.get("category", "general")
            if self.engine.learner and rule:
                try:
                    self.engine.learner.add_lesson(cat, rule, weight=1.5)
                    stored += 1
                    lines.append(f"[{cat}] {rule}")
                except Exception:
                    pass

        reply = (f"Learned from video {vid}\n"
                 f"Transcript: {len(transcript):,} chars\n"
                 f"Extracted {stored} trading rules:\n\n"
                 + "\n".join(lines) +
                 "\n\nThese rules now appear in every future decision.")
        return {"reply": reply, "pending": self.pending, "type": "text"}

    def _set_target(self, amount, deadline):
        eq = self.engine._account()["equity"]
        pct = (amount / eq) * 100
        if pct > 100:
            return {"reply": (
                f"Target: ${amount:,.0f} by {deadline}\n"
                f"Required: {pct:,.0f}% return\n\n"
                f"That is not achievable. Realistic monthly targets:\n"
                f"  ${eq*0.05:,.0f} (5%) - aggressive\n"
                f"  ${eq*0.10:,.0f} (10%) - excellent\n"
                f"  ${eq*0.15:,.0f} (15%) - exceptional\n\n"
                f"Set a real target and I will work toward it."),
                "pending": None, "type": "text"}
        return {"reply": (
            f"TARGET SET: ${amount:,.0f} by {deadline}\n"
            f"Required: {pct:.1f}% on ${eq:,.0f}\n"
            f"I will track progress. Say 'progress' anytime."),
            "pending": None, "type": "text"}

    def _parse_action(self, reply):
        reply = reply.strip()
        if not reply:
            return None
        clean = re.sub(r"```json|```", "", reply).strip()
        if not clean:
            return None
        # Try direct JSON parse
        try:
            d = json.loads(clean)
        except Exception:
            # Try to find JSON object or array in the text
            m = re.search(r"(\{.*\}|\[.*\])", clean, re.DOTALL)
            if not m:
                return None
            try:
                d = json.loads(m.group(1))
            except Exception:
                return None
        # Handle array of actions
        if isinstance(d, list):
            if not d:
                return None
            # Queue remaining actions for subsequent calls
            self._pending_batch = d[1:] if len(d) > 1 else []
            return d[0]
        if isinstance(d, dict) and "action" in d:
            return d
        return None

    def _run_action(self, action):
        # If called with no action and we have a pending batch, take next
        if not action and self._pending_batch:
            action = self._pending_batch.pop(0)

        if not action:
            return {"reply": "No action to run.",
                    "pending": self.pending, "type": "text"}

        a = action.get("action", "").lower()

        if a == "analyze":
            return self._do_analyze(action.get("symbol", "").upper())

        if a == "quote":
            sym = action.get("symbol", "").upper()
            try:
                q = self.engine._quote(sym)
                return {"reply": f"{sym}: bid ${q['bid']:.4f} / ask ${q['ask']:.4f}",
                        "pending": self.pending, "type": "text"}
            except Exception as e:
                return {"reply": f"Cannot quote {sym}: {e}",
                        "pending": self.pending, "type": "text"}

        if a == "positions":
            try:
                ps = self.engine._positions()
                if not ps:
                    return {"reply": "No open positions.",
                            "pending": self.pending, "type": "text"}
                lines = []
                for p in ps:
                    track = self.engine._active_trades.get(p["symbol"], {})
                    sl = track.get("sl", 0)
                    tp = track.get("tp", 0)
                    extra = f"  SL ${sl:.4f}  TP ${tp:.4f}" if sl and tp else ""
                    lines.append(
                        f"{p['symbol']}: {p['qty']:.4f} @ ${p['avg_entry']:.4f}  "
                        f"now ${p['current_price']:.4f}  "
                        f"P/L ${p['unrealized_pl']:+.2f} "
                        f"({p['unrealized_plpc']:+.2f}%){extra}")
                return {"reply": "\n".join(lines),
                        "pending": self.pending, "type": "text"}
            except Exception as e:
                return {"reply": f"Error: {e}",
                        "pending": self.pending, "type": "text"}

        if a == "cash":
            try:
                acc = self.engine._account()
                return {"reply": f"Equity ${acc['equity']:.2f}, "
                                  f"buying power ${acc['buying_power']:.2f}",
                        "pending": self.pending, "type": "text"}
            except Exception as e:
                return {"reply": f"Error: {e}",
                        "pending": self.pending, "type": "text"}

        if a == "lessons":
            if not self.engine.learner:
                return {"reply": "Learning module not loaded.",
                        "pending": self.pending, "type": "text"}
            summary = self.engine.learner.learned_summary()
            count = self.engine.learner.trade_count()
            return {"reply": f"Learned from {count} trades:\n\n{summary}",
                    "pending": self.pending, "type": "text"}

        if a == "close":
            sym = action.get("symbol", "").upper()
            held = any(p["symbol"] == sym for p in self.engine._positions())
            if not held:
                return {"reply": f"Not holding {sym}.",
                        "pending": self.pending, "type": "text"}
            ok = self.engine._close_position(sym, "manual close via chat")
            return {"reply": f"{sym}: closed." if ok else f"{sym}: close failed.",
                    "pending": self.pending,
                    "type": "trade" if ok else "error"}

        if a == "close_all":
            try:
                positions = self.engine._positions()
                if not positions:
                    return {"reply": "No positions to close.",
                            "pending": self.pending, "type": "text"}
                closed = []
                failed = []
                for p in positions:
                    sym = p["symbol"]
                    if self.engine._close_position(sym, "manual close all"):
                        closed.append(sym)
                    else:
                        failed.append(sym)
                msg = f"Closed {len(closed)}: {', '.join(closed)}"
                if failed:
                    msg += f"\nFailed: {', '.join(failed)}"
                return {"reply": msg, "pending": self.pending, "type": "trade"}
            except Exception as e:
                return {"reply": f"Close-all error: {e}",
                        "pending": self.pending, "type": "error"}

        if a == "confirm":
            if not self.pending:
                return {"reply": "Nothing pending.",
                        "pending": None, "type": "text"}
            res = self.engine.execute_proposal(self.pending)
            if res["ok"]:
                msg = (f"EXECUTED: {res['side']} {res['qty']} {res['symbol']} "
                       f"@ ~{res['entry']:.4f}\nOrder ID: {res['order_id']}\n"
                       f"SL/TP monitoring active.")
                self.pending = None
                return {"reply": msg, "pending": None, "type": "trade"}
            return {"reply": f"Execution failed: {res.get('error')}",
                    "pending": self.pending, "type": "error"}

        if a == "cancel":
            self.pending = None
            return {"reply": "Cancelled.", "pending": None, "type": "text"}

        return {"reply": f"Unknown action: {a}",
                "pending": self.pending, "type": "text"}

    def _do_analyze(self, symbol):
        if not symbol:
            return {"reply": "Which symbol?",
                    "pending": self.pending, "type": "text"}

        result = self.engine.analyze_symbol(symbol)

        if not result.get("ok"):
            reason = result.get("reason") or result.get("error") or "unknown"
            if result.get("action") == "HOLD":
                msg = (f"{symbol}: HOLD at "
                       f"{result.get('confidence',0):.0%}.\n"
                       f"{result.get('decision_reason','')}")
                return {"reply": msg, "pending": None, "type": "text"}
            return {"reply": f"{symbol}: no trade. {reason}",
                    "pending": None, "type": "text"}

        self.pending = result
        arrow = "BUY" if result["action"] == "BUY" else "SELL"
        notional = result["entry"] * result["qty"]
        msg = (
            f"{symbol} - {arrow} signal, {result['confidence']:.0%}.\n\n"
            f"Entry: ~${result['entry']:.4f}\n"
            f"Qty: {result['qty']} (~${notional:,.2f})\n"
            f"Stop loss: ${result['stop_loss']:.4f}\n"
            f"Take profit: ${result['take_profit']:.4f}\n"
            f"Risk: ${result['risk_amount']:.2f}  "
            f"Reward: ${result['reward_amount']:.2f}\n\n"
            f"Reason: {result['reason'][:250]}\n\n"
            f"Reply 'yes' to execute."
        )
        return {"reply": msg, "pending": self.pending, "type": "proposal"}
