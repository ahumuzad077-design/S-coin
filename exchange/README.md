# MERIDIAN Exchange OS — simulation module

This is a **closed, synthetic securities-market prototype** embedded in the S Coin repository. It is not a licensed securities exchange, broker, custodian, central securities depository, payment service, or investment offer.

## Scope

- Five fictional UGX-denominated demo securities (`DENG`, `DSOL`, `DLOG`, `DWAT`, `DAGR`).
- An in-memory price/time-priority limit-order matching engine.
- Paper investor cash and share positions, reserved funds/shares, order cancellation, fills and aggregated order books.
- A loopback-only HTTP API for the existing Expo app.
- No real issuers, real securities, real balances, real cash, external broker connection, CSD integration, settlement instruction, on-chain securities token, or production trading.

All orders are ephemeral and are lost when the demo process stops. The seeded `DEMO-INVESTOR` and `DEMO-LIQUIDITY` accounts are synthetic fixtures.

## Run the local simulator

From the repository root:

```sh
cd exchange
go test ./...
go run ./cmd/meridian-demo
```

The service binds only to `127.0.0.1:8788` by default. A custom `MERIDIAN_DEMO_ADDR` is accepted only when it binds to loopback (`127.0.0.1`, `localhost`, or `::1`). **Do not expose it to the internet.**

The browser app allows only local Expo development origins. Endpoints:

- `GET /healthz`
- `GET /api/v1/markets`
- `GET /api/v1/securities`
- `GET /api/v1/securities/{symbol}`
- `GET /api/v1/securities/{symbol}/orderbook`
- `GET /api/v1/account`
- `GET /api/v1/orders`
- `POST /api/v1/orders` — paper limit orders only
- `DELETE /api/v1/orders/{id}` — cancels the demo investor's open order

The HTTP API intentionally has one fixed demo account; request bodies cannot select a wallet or investor. This is a local demo safety boundary, not production authentication.

## Matching and accounting behaviour

- Only limit orders are supported.
- Best-price priority is followed by FIFO time priority.
- Execution takes place at the resting order's limit price.
- Self-trades are not matched.
- Buy orders reserve cash at their limit price; sell orders reserve shares.
- A fill debits the buyer at the execution price, credits the seller, moves shares, and releases the buyer's price-improvement reservation.
- Order validation rejects overspending and overselling.

This prototype has not been independently audited and is not appropriate for handling real securities or money. Production exchange design requires licensed operator approval, exchange rulebooks, issuer admission/disclosure, authorised trading participants, market surveillance, approved clearing and settlement arrangements, CSD integration, governance, capital, insurance, cyber-security controls, operational resilience and jurisdiction-specific legal advice. Do not connect this demo to the S Coin native token or the `issuer/` cash-backed asset foundation.
