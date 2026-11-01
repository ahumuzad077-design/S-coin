# S Coin securities markets and AI trading integration

## Unified product boundary

S Coin now contains three connected but independently operated market domains:

1. **Crypto markets and wallet access** — the existing Expo Markets area, public Binance Spot market data, external EVM/Cosmos wallet connections, Binance Spot Testnet orders, and separately gated swap/transfer paths.
2. **MERIDIAN securities exchange operations** — the `exchange/` Go service for real issuer applications, verified company identity, compliance review, due diligence and append-only audit events.
3. **Sentinel AI markets and trading** — `integrations/sentinel/`, an isolated Python service for US stocks, ETFs and crypto analysis, Alpaca market/broker connectivity, risk checks, paper execution, learning, journaling and performance reporting.

The Expo app adds a Securities navigation route that serves as the access point for the Sentinel and MERIDIAN hosted services. Configure their public HTTPS URLs in `client/.env`. Never include API keys or service tokens in `EXPO_PUBLIC_*` values.

## What is integrated in source

### MERIDIAN

- Real issuer-application intake and company registration details.
- Verified organisation identity and company-scoped access.
- Compliance evidence and review decision history.
- PostgreSQL persistence and append-only audit trail.
- TLS 1.3 service configuration and OIDC authentication.
- Explicitly disabled trading endpoint; no securities orders are routed or matched.

### Sentinel

- AI analysis of configured equity/ETF symbols and crypto pairs.
- Alpaca stock and crypto market-data adapters.
- Multi-agent analysis, risk engine, stop-loss/target handling and position monitoring.
- Trade journal, learning components, performance calculations and standalone dashboard.
- Bearer-token and HttpOnly dashboard-session protection.
- Default paper trading, with live trading forced off unless both operator settings are explicitly enabled.

### S Coin client

- Existing Crypto Markets area remains intact.
- New Securities area provides entry points to the hosted Sentinel dashboard and MERIDIAN issuer portal.
- External service URLs must be HTTPS.
- No API secret or broker credential belongs in the Expo bundle.

## Deployment shape

Deploy these services independently from the same S Coin repository:

- S Coin Cosmos node and existing web/mobile client on the selected hosting infrastructure.
- MERIDIAN Go issuer-operations service with PostgreSQL, verified OIDC issuer, TLS certificates, backup, monitoring and least-privilege database roles.
- Sentinel Python service using its dedicated Dockerfile, one worker for its current in-memory engine, persistent encrypted journal volume, HTTPS reverse proxy and server-side secrets.

The S Coin client points to the public HTTPS entry URLs. Service secrets remain on the server.

## Remaining operational gates

Source consolidation is not the same as a production exchange launch. The following still require real counterparties, approved environments, independent validation and/or legal permission:

- S Coin production mainnet, native monetary policy, reserve and redemption operations.
- MERIDIAN company incorporation, CMA authorisation, exchange rules, qualified governance, approved broker/dealer participants, CSD, custody, clearing and settlement contracts, market surveillance, approved securities market data and operational resilience.
- Sentinel OIDC/per-user permissions, account-level authorization, audit attribution, distributed rate limits, broker account approval, kill-switch review and independent trading-risk/security assessment before any live execution.
- End-to-end deployments, platform secrets, DNS, TLS, backups, monitoring, incident response, disaster recovery and production acceptance tests.

Do not enable live securities trading or live broker orders just because source code has been consolidated.
