"""Sentinel - web server."""

import os
import json
import hmac
import threading
from collections import deque
from datetime import datetime

from flask import Flask, render_template, jsonify, request, make_response

from bot import TraderEngine, ChatEngine

try:
    from stats import compute_stats
except ImportError:
    compute_stats = None

app = Flask(__name__)

_log_buffer = deque(maxlen=500)
_state = {
    "equity": 0.0, "buying_power": 0.0, "positions": [],
    "cycle": 0, "halted": False, "halt_reason": "",
    "mode": "PAPER", "bars": {}, "trades": {},
    "running": False, "equity_curve": [],
}
_lock = threading.Lock()
_engine = None
_chat = None

_API_TOKEN = os.environ.get("SENTINEL_API_TOKEN", "")
_COOKIE_NAME = "scoin_sentinel_session"


@app.before_request
def _require_api_authentication():
    """Protect every API route with a server-side bearer token or session cookie."""
    if request.path == "/healthz" or request.path == "/api/session":
        return None
    if not request.path.startswith("/api/"):
        return None
    if len(_API_TOKEN) < 32:
        return jsonify({"error": "Sentinel API requires a 32-character or longer SENTINEL_API_TOKEN."}), 503
    authorization = request.headers.get("Authorization", "")
    bearer = authorization[7:].strip() if authorization.lower().startswith("bearer ") else ""
    cookie = request.cookies.get(_COOKIE_NAME, "")
    if not (
        (bearer and hmac.compare_digest(bearer, _API_TOKEN))
        or (cookie and hmac.compare_digest(cookie, _API_TOKEN))
    ):
        return jsonify({"error": "Authentication required."}), 401
    return None


@app.route("/healthz")
def healthz():
    return jsonify({
        "service": "scoin-sentinel",
        "status": "ok",
        "liveTradingEnabled": os.environ.get("SENTINEL_LIVE_TRADING_ENABLED", "false").lower() == "true",
        "authenticationConfigured": len(_API_TOKEN) >= 32,
    })


@app.route("/api/session", methods=["POST"])
def api_session():
    data = request.get_json(silent=True) or {}
    candidate = str(data.get("token") or "")
    if len(_API_TOKEN) < 32:
        return jsonify({"error": "Sentinel API requires a 32-character or longer access token."}), 503
    if not candidate or not hmac.compare_digest(candidate, _API_TOKEN):
        return jsonify({"error": "Invalid access token."}), 401
    response = make_response(jsonify({"ok": True}))
    secure_cookie = (
        request.is_secure
        or os.environ.get("SENTINEL_COOKIE_SECURE", "false").lower() == "true"
    )
    response.set_cookie(
        _COOKIE_NAME,
        _API_TOKEN,
        max_age=3600,
        httponly=True,
        secure=secure_cookie,
        samesite="Strict",
        path="/",
    )
    return response


@app.route("/api/session", methods=["DELETE"])
def api_session_logout():
    response = make_response(jsonify({"ok": True}))
    response.delete_cookie(_COOKIE_NAME, path="/")
    return response



def _clean(obj):
    """Recursively convert any object into JSON-safe primitives."""
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        if isinstance(obj, float):
            if obj != obj or obj == float("inf") or obj == float("-inf"):
                return None
        return obj
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_clean(x) for x in obj]
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    return str(obj)


def _on_log(msg, level):
    with _lock:
        _log_buffer.append({
            "ts": datetime.now().strftime("%H:%M:%S"),
            "msg": str(msg),
            "level": str(level)})


def _on_status(d):
    with _lock:
        for k in ("equity", "buying_power", "positions", "cycle",
                  "halted", "halt_reason", "mode", "equity_curve"):
            if k in d:
                _state[k] = _clean(d[k])


def _on_bars(symbol, bars, trade):
    with _lock:
        _state["bars"][str(symbol)] = _clean(bars)
        _state["trades"][str(symbol)] = _clean(trade)


def _ensure_engine():
    global _engine, _chat
    if _engine is None:
        _engine = TraderEngine(
            on_log=_on_log, on_status=_on_status, on_bars=_on_bars)
    if _chat is None:
        _chat = ChatEngine(_engine)
    return _engine, _chat


@app.route("/")
def index():
    return render_template("dashboard.html")


@app.route("/api/state")
def api_state():
    with _lock:
        payload = {**_state, "log": list(_log_buffer)[-200:]}
    return jsonify(_clean(payload))


@app.route("/api/stats")
def api_stats():
    if compute_stats is None:
        return jsonify({"error": "stats module not loaded"})
    try:
        path = os.environ.get("JOURNAL_PATH", "trades.db")
        s = compute_stats(path)
        # Convert inf to string so JSON doesn't choke
        if s.get("profit_factor") == float("inf"):
            s["profit_factor"] = "inf"
        return jsonify(_clean(s))
    except Exception as e:
        return jsonify({"error": str(e)})


@app.route("/api/start", methods=["POST"])
def api_start_route():
    engine, _ = _ensure_engine()
    engine.start()
    with _lock:
        _state["running"] = True
    return jsonify({"ok": True})


@app.route("/api/stop", methods=["POST"])
def api_stop():
    global _engine
    if _engine:
        _engine.stop()
    with _lock:
        _state["running"] = False
    return jsonify({"ok": True})


@app.route("/api/chat", methods=["POST"])
def api_chat():
    engine, chat = _ensure_engine()
    data = request.get_json(silent=True) or {}
    msg = str(data.get("message") or "").strip()
    if not msg:
        return jsonify({"reply": "", "type": "text"})

    try:
        result = chat.handle(msg)
    except Exception as e:
        import traceback
        traceback.print_exc()
        result = {"reply": f"Chat error: {e}", "type": "error"}

    if not isinstance(result, dict):
        result = {"reply": str(result), "type": "text"}

    reply = result.get("reply", "")
    if not isinstance(reply, str):
        try:
            reply = json.dumps(_clean(reply), indent=2)
        except Exception:
            reply = str(reply)

    pending = result.get("pending")
    if pending is not None:
        pending = _clean(pending)

    return jsonify({
        "reply": reply,
        "pending": pending,
        "type": str(result.get("type", "text")),
    })


def _deferred_start():
    import time as _t
    _t.sleep(3)
    try:
        engine, _ = _ensure_engine()
        engine.start()
        with _lock:
            _state["running"] = True
        print("[AUTO_START] engine started", flush=True)
    except Exception as e:
        print(f"[AUTO_START] failed: {e}", flush=True)


if os.environ.get("AUTO_START", "false").lower() == "true":
    threading.Thread(target=_deferred_start, daemon=True).start()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
