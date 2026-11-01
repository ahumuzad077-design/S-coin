"""Sentinel learning module.

Tracks outcomes, conversation patterns, symbol performance, and
injects learned lessons into every decision.
"""

import os
import json
import sqlite3
import threading
from datetime import datetime, timedelta
from collections import defaultdict


class LearningEngine:
    """Rolling statistics that improve Sentinel's decisions over time."""

    def __init__(self, db_path="trades.db"):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()
        self.symbol_stats = {}
        self.conversation_notes = []
        self.lessons = []
        self._load()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as c:
            c.execute("""CREATE TABLE IF NOT EXISTS symbol_stats (
                symbol TEXT PRIMARY KEY, wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0, total_pnl REAL DEFAULT 0,
                avg_pnl_pct REAL DEFAULT 0, last_trade TEXT,
                confidence_bias REAL DEFAULT 0)""")
            c.execute("""CREATE TABLE IF NOT EXISTS lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created TEXT, category TEXT, lesson TEXT, weight REAL)""")
            c.execute("""CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT, role TEXT, message TEXT, learned TEXT)""")
            c.commit()

    def _load(self):
        """Load existing symbol stats and lessons from disk."""
        try:
            with sqlite3.connect(self.db_path) as c:
                for row in c.execute(
                    "SELECT symbol, wins, losses, total_pnl, avg_pnl_pct, "
                    "confidence_bias FROM symbol_stats"):
                    self.symbol_stats[row[0]] = {
                        "wins": row[1], "losses": row[2],
                        "total_pnl": row[3], "avg_pnl_pct": row[4],
                        "confidence_bias": row[5]}
                for row in c.execute(
                    "SELECT category, lesson, weight FROM lessons "
                    "ORDER BY weight DESC LIMIT 20"):
                    self.lessons.append({
                        "category": row[0], "lesson": row[1], "weight": row[2]})
        except Exception:
            pass

    def record_trade(self, symbol, pnl_pct, pnl_dollar, side, reason):
        """Called when a position closes. Updates per-symbol stats."""
        with self._lock:
            stats = self.symbol_stats.get(symbol, {
                "wins": 0, "losses": 0, "total_pnl": 0.0,
                "avg_pnl_pct": 0.0, "confidence_bias": 0.0})
            if pnl_pct >= 0:
                stats["wins"] += 1
            else:
                stats["losses"] += 1
            n = stats["wins"] + stats["losses"]
            old_total = stats["avg_pnl_pct"] * (n - 1)
            stats["avg_pnl_pct"] = (old_total + pnl_pct) / n
            stats["total_pnl"] += pnl_dollar

            # Confidence bias: wins raise it, losses lower it
            if pnl_pct >= 0:
                stats["confidence_bias"] = min(0.15,
                    stats["confidence_bias"] + 0.02)
            else:
                stats["confidence_bias"] = max(-0.20,
                    stats["confidence_bias"] - 0.03)
            self.symbol_stats[symbol] = stats

            with sqlite3.connect(self.db_path) as c:
                c.execute("""INSERT INTO symbol_stats
                    (symbol, wins, losses, total_pnl, avg_pnl_pct,
                     last_trade, confidence_bias)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(symbol) DO UPDATE SET
                        wins=excluded.wins, losses=excluded.losses,
                        total_pnl=excluded.total_pnl,
                        avg_pnl_pct=excluded.avg_pnl_pct,
                        last_trade=excluded.last_trade,
                        confidence_bias=excluded.confidence_bias""",
                    (symbol, stats["wins"], stats["losses"],
                     stats["total_pnl"], stats["avg_pnl_pct"],
                     datetime.utcnow().isoformat(),
                     stats["confidence_bias"]))
                c.commit()

    def record_conversation(self, role, message, learned=""):
        """Remember what the user discussed."""
        with self._lock:
            with sqlite3.connect(self.db_path) as c:
                c.execute("""INSERT INTO conversations
                    (ts, role, message, learned) VALUES (?, ?, ?, ?)""",
                    (datetime.utcnow().isoformat(), role, message, learned))
                c.commit()

    def add_lesson(self, category, lesson, weight=1.0):
        """Add a learned rule that shapes future decisions."""
        with self._lock:
            self.lessons.append({
                "category": category, "lesson": lesson, "weight": weight})
            self.lessons.sort(key=lambda x: -x["weight"])
            with sqlite3.connect(self.db_path) as c:
                c.execute("""INSERT INTO lessons
                    (created, category, lesson, weight) VALUES (?, ?, ?, ?)""",
                    (datetime.utcnow().isoformat(), category, lesson, weight))
                c.commit()

    def confidence_adjustment(self, symbol):
        """Return a bias value based on this symbol's history."""
        s = self.symbol_stats.get(symbol)
        if not s:
            return 0.0
        if s["wins"] + s["losses"] < 3:
            return 0.0
        return s["confidence_bias"]

    def learned_summary(self):
        """Human-readable summary of what Sentinel has learned."""
        lines = []
        if self.symbol_stats:
            best = max(self.symbol_stats.items(),
                       key=lambda x: x[1]["avg_pnl_pct"], default=None)
            worst = min(self.symbol_stats.items(),
                        key=lambda x: x[1]["avg_pnl_pct"], default=None)
            if best and best[1]["avg_pnl_pct"] > 0:
                lines.append(
                    f"Best symbol: {best[0]} "
                    f"({best[1]['wins']}W/{best[1]['losses']}L, "
                    f"avg {best[1]['avg_pnl_pct']:+.2f}%)")
            if worst and worst[1]["avg_pnl_pct"] < 0:
                lines.append(
                    f"Worst symbol: {worst[0]} "
                    f"({worst[1]['wins']}W/{worst[1]['losses']}L, "
                    f"avg {worst[1]['avg_pnl_pct']:+.2f}%)")
        if self.lessons:
            for l in self.lessons[:5]:
                lines.append(f"[{l['category']}] {l['lesson']}")
        return "\n".join(lines) if lines else "No lessons learned yet."

    def trade_count(self):
        return sum(s["wins"] + s["losses"]
                   for s in self.symbol_stats.values())
