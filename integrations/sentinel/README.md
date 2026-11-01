# S Coin Sentinel — AI stocks and crypto trading service

This is S Coin's integrated Sentinel service, copied from the standalone Sentinel Trader project and adapted for the S Coin monorepo. It retains the AI analysis, multi-agent bull/bear/judge workflow, Alpaca market data and order adapter, risk checks, learning, trade journal and performance statistics.

## Scope

- US equities and ETFs (default examples: AAPL, MSFT, NVDA, SPY).
- Crypto pairs through Alpaca's crypto market-data/trading APIs.
- AI-assisted asset analysis, research, trade proposals, stop/target management and performance reporting.
- Dashboard endpoints for status, positions, activity, statistics and chat-driven analysis.
- Paper trading is forced by default.
- All API routes are protected by a server-side access token. The token is never required in an Expo public environment variable.

## Run as a separate service

Build from the repository root using `integrations/sentinel/Dockerfile`, or run locally:

```sh
cd integrations/sentinel
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python web.py
```

Configure secrets through the hosting platform's secret manager. Set a strong random `SENTINEL_API_TOKEN`. The HTML dashboard exchanges the token for a short-lived HttpOnly, SameSite=Strict session cookie; the token is held only in the password field during login and is not kept in browser storage. Trusted server-to-server API clients may send the token as a Bearer credential. All endpoints under `/api/` require authentication except the login endpoint. `/healthz` exposes only service health and the live-trading capability flag.

## Trading safety

- `ALPACA_PAPER_TRADE=true` is the default.
- Live mode is forced off unless the operator explicitly sets BOTH `ALPACA_PAPER_TRADE=false` and `SENTINEL_LIVE_TRADING_ENABLED=true`.
- Do not enable live execution until the broker account, user permissions, regulatory position, risk limits, independent security review and incident controls are approved.
- This service is an AI-assisted trading tool, not a stock exchange, broker, custodian or investment adviser. It must not be used to represent MERIDIAN as a licensed venue.
- API access token is a service-level initial access control. Before multi-user production, replace it with S Coin's OIDC user authentication, per-user authorization, audit attribution and rate limiting.

## Deployment

Use the dedicated Dockerfile. Expose the service only over HTTPS behind a reverse proxy/WAF. Do not publish Alpaca, model-provider or Sentinel access credentials in the client bundle or repository. Use a persistent encrypted volume for the trade journal database if the journal must survive container replacement. Configure one worker for the current in-memory engine; horizontal scaling requires a shared job/leader mechanism and durable state.

## Original source

Adapted from `ahumuzad077-design/sentinel-trader`. The original project remains separate and unchanged.
