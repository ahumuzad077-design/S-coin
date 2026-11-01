"""Sentinel performance tracking - reads closed_trades from trades.db."""

import sqlite3
import math


def compute_stats(db_path="trades.db"):
    try:
        conn = sqlite3.connect(db_path)
        rows = conn.execute("""
            SELECT ts, symbol, side, qty, entry, exit, pnl, pnl_pct, close_reason
            FROM closed_trades ORDER BY ts ASC
        """).fetchall()
        conn.close()
    except Exception as e:
        return {"error": str(e), "trades": 0}

    if not rows:
        return {"trades": 0, "msg": "No closed trades yet."}

    wins, losses = [], []
    total_pnl = 0.0
    pnl_pcts = []
    equity = 0.0
    peak = 0.0
    max_dd = 0.0
    equity_curve = [0.0]

    for r in rows:
        pnl = r[6] or 0
        pnl_pct = r[7] or 0
        total_pnl += pnl
        pnl_pcts.append(pnl_pct)
        if pnl >= 0:
            wins.append(pnl)
        else:
            losses.append(pnl)
        equity += pnl
        equity_curve.append(equity)
        if equity > peak:
            peak = equity
        dd = peak - equity
        if dd > max_dd:
            max_dd = dd

    n = len(rows)
    win_count = len(wins)
    loss_count = len(losses)
    win_rate = (win_count / n * 100) if n else 0
    avg_win = (sum(wins) / win_count) if win_count else 0
    avg_loss = (sum(losses) / loss_count) if loss_count else 0

    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else float("inf")

    if len(pnl_pcts) > 1:
        mean = sum(pnl_pcts) / len(pnl_pcts)
        variance = sum((x - mean) ** 2 for x in pnl_pcts) / len(pnl_pcts)
        std = math.sqrt(variance)
        sharpe = (mean / std) if std > 0 else 0
    else:
        sharpe = 0

    best = max(rows, key=lambda r: r[6] or 0)
    worst = min(rows, key=lambda r: r[6] or 0)

    symbol_stats = {}
    for r in rows:
        sym = r[1]
        pnl = r[6] or 0
        pct = r[7] or 0
        s = symbol_stats.setdefault(sym, {"wins": 0, "losses": 0, "pnl": 0.0, "n": 0})
        s["pnl"] += pnl
        s["n"] += 1
        if pnl >= 0:
            s["wins"] += 1
        else:
            s["losses"] += 1

    return {
        "trades": n,
        "wins": win_count,
        "losses": loss_count,
        "win_rate": win_rate,
        "total_pnl": total_pnl,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "max_drawdown": max_dd,
        "sharpe": sharpe,
        "equity_curve": equity_curve,
        "best": {"symbol": best[1], "pnl": best[6] or 0},
        "worst": {"symbol": worst[1], "pnl": worst[6] or 0},
        "symbol_stats": symbol_stats,
    }


def format_stats(stats):
    if stats.get("trades", 0) == 0:
        return stats.get("msg", "No closed trades yet.")

    n = stats["trades"]
    wr = stats["win_rate"]
    tp = stats["total_pnl"]
    pf = stats["profit_factor"]
    aw = stats["avg_win"]
    al = stats["avg_loss"]
    dd = stats["max_drawdown"]
    sharpe = stats["sharpe"]

    lines = [
        f"PERFORMANCE -- {n} closed trades",
        "",
        f"  Win rate:       {wr:.1f}% ({stats['wins']}W / {stats['losses']}L)",
        f"  Total P/L:      ${tp:+,.2f}",
        f"  Avg win:        ${aw:+,.2f}",
        f"  Avg loss:       ${al:+,.2f}",
    ]
    pf_str = f"{pf:.2f}" if pf != float("inf") else "inf"
    lines.append(f"  Profit factor:  {pf_str}")
    lines.append(f"  Max drawdown:   ${dd:,.2f}")
    lines.append(f"  Sharpe:         {sharpe:.2f}")
    lines.append("")
    lines.append(f"  Best:  {stats['best']['symbol']}  ${stats['best']['pnl']:+,.2f}")
    lines.append(f"  Worst: {stats['worst']['symbol']}  ${stats['worst']['pnl']:+,.2f}")

    syms = stats.get("symbol_stats", {})
    if syms:
        lines.append("")
        lines.append("Symbols:")
        ranked = sorted(syms.items(), key=lambda x: x[1]["pnl"], reverse=True)
        for sym, s in ranked[:10]:
            n_s = s["n"]
            wr_s = (s["wins"] / n_s * 100) if n_s else 0
            lines.append(f"  {sym:12s}  {s['wins']}W/{s['losses']}L  "
                         f"{wr_s:.0f}%  ${s['pnl']:+,.2f}")

    return "\n".join(lines)
