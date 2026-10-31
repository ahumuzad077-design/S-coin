# S Coin Product Blueprint
**Product baseline:** 31 October 2026  
**Repository:** `ahumuzad077-design/S-coin`  
**Purpose:** Single source of truth for S Coin's multi-exchange, multi-wallet crypto market application.

## 1. Product definition

S Coin is intended to become a multi-platform crypto market, portfolio, wallet-connection and trading application. It should let users compare markets, connect supported exchange accounts or external wallets, practise with virtual balances, and — only where a provider, network and legal operating model have been approved — submit real transactions.

S Coin is not meant to be a Binance-only terminal or a MetaMask clone. Binance and MetaMask are examples of integrations, not the product boundary. The product should be provider-neutral: a user should be able to use a supported exchange or wallet without S Coin pretending that all providers have the same APIs, assets, permissions or demo features.

The app should have its own identity and user experience. It can provide an internal paper-trading account and portfolio without taking custody of users' real funds. An eventual S Coin self-custody wallet is a separate product component requiring its own cryptographic design, audit and recovery model.

## 2. The four distinct systems

These concepts must never be treated as interchangeable:

1. **Centralised exchanges (CEXs).** A user connects an exchange account through that exchange's API or approved authorisation flow. Exchange balances and orders remain at that exchange. S Coin does not own the exchange account.
2. **Blockchain wallets.** A user connects a wallet such as MetaMask or Keplr. The wallet controls the private keys and must independently approve every on-chain transaction. A wallet connection does not create a CEX account.
3. **Decentralised exchanges (DEXs) and aggregators.** These find on-chain swap routes. A quote is only an estimate; execution requires a supported chain, verified contracts, liquidity, simulation and a user's wallet signature.
4. **S Coin's internal simulator and future wallet.** Paper balances are invented by the simulator and have no monetary value. A future self-custody wallet would generate and secure real keys; it must not be described as implemented until its complete key, backup, recovery and audit lifecycle exists.

A CEX-to-CEX transfer is not an instant swap inside a common pool. Moving assets between two custodial exchanges may require a withdrawal, blockchain confirmation and deposit. A cross-chain swap is a different flow again. The interface must show the actual route, fees, expected time and counterparties rather than describe every conversion as "instant".

## 3. Product modules

### 3.1 Markets terminal

- Searchable asset and trading-pair directory.
- Normalised symbols, prices, 24-hour change, volume, bid/ask spread and provider timestamp.
- Candlestick charts, depth/order-book snapshots and recent trades where the provider supplies them.
- Watchlists, favourite pairs, market movers and price alerts.
- Side-by-side exchange comparison for the same asset, with provider, pair, quote currency, timestamp and liquidity displayed.
- Stale-data indicators, reconnect handling, rate-limit handling and source attribution.
- No promise that prices or liquidity are identical across venues.

### 3.2 Exchange accounts and order desk

Each exchange is an independent connector. The intended provider candidates are:

| Provider | Product target | Current S Coin code status |
|---|---|---|
| Binance | Spot market data and a separately isolated Spot Testnet account/order desk | Public Spot market feed and Spot Testnet functions implemented |
| OKX | Public markets and a provider-specific Demo Trading connector, then approved live Spot connector | Not implemented |
| Bybit | Public markets and provider-specific Demo Trading connector, then approved live Spot connector | Not implemented |
| Coinbase Advanced | Public markets and an approved account/order connector after regional and API capability checks | Not implemented |
| Kraken | Public markets and an approved account/order connector after regional and API capability checks | Not implemented |
| Gate.io / Bitget and other venues | Future candidates only, subject to provider review and demand | Not implemented |

The list is a roadmap, not a statement that every provider is available to every user or that all providers support a complete sandbox. S Coin must verify each exchange's current developer rules, product availability, user eligibility, API permissions, regional restrictions, rate limits and sandbox coverage before enabling a connector.

Initial CEX order types should be Spot market and limit orders. Stop/trigger orders can follow after venue-specific handling is proven. Margin, perpetual futures, options, leverage, copy trading, lending, staking and withdrawals must not silently appear as supported. They require separate product, risk, suitability, legal and technical decisions.

### 3.3 Wallet connectivity

Wallet connection should be modular and support only tested wallet/network combinations. Intended candidates include:

- EVM-compatible browser wallets such as MetaMask and Rabby.
- WalletConnect / Reown-compatible wallets, including Coinbase Wallet where supported by the approved connector.
- Cosmos wallets such as Keplr and Leap.
- Additional chain-specific wallets only after chain IDs, signing standards and network metadata are independently verified.

The wallet provider owns key custody and transaction confirmation. S Coin must show the connected address, network, token, recipient, amount, fee and transaction destination before the user signs. Wallet connection alone does not mean S Coin can move funds.

### 3.4 DEX and cross-chain routing

- Quote and compare routes from supported aggregators.
- Show minimum received, estimated network fee, price impact, slippage, route and quote age.
- Verify chain, token contracts, spender and transaction target against a maintained allowlist.
- Simulate the transaction where supported.
- Require a separate wallet confirmation for token approvals and swaps.
- Use exact-amount allowances by default and never treat a quote as an executed trade.
- For Cosmos/IBC, distinguish route preview from signed IBC messages and completed settlement.

Current code includes a 0x EVM quote path and a Skip Go Cosmos/IBC route-preview path. The Skip path does not sign or broadcast IBC messages. EVM swap execution is deliberately disabled unless separately enabled with matching app/server configuration and verified allowlists.

### 3.5 S Coin asset and network

The repository currently defines a Cosmos SDK chain scaffold with base denomination `uscoin`, display symbol `S`, and the `scoin` address prefix. The display conversion is 1 S = 1,000,000 uscoin.

This codebase does not establish a public production chain, production chain ID, trusted public RPC, genesis allocations, approved maximum supply, production validators, exchange listing, DEX liquidity, reserve, redemption or market price. The repository's native monetary policy remains undecided and requires formal approval. Do not label S Coin as a stablecoin, fixed-supply asset, cash-backed asset or exchange-listed token without the separate evidence and approvals needed for those claims. Do not conflate S Coin with provisional SQM-UGX / SQM-USD issuer work elsewhere in the repository.

## 4. Simulation is a first-class product

S Coin needs an internal, exchange-independent **Crypto Paper Trading** environment. This is distinct from each exchange's own demo account.

### Internal paper-trading simulator

The internal simulator should:

- Create a clearly labelled virtual account with configurable, non-withdrawable demo funds.
- Consume real public market prices from each supported market-data provider, while keeping the user's money and orders virtual.
- Support Spot market and limit orders initially.
- Model fees, spread, slippage, price precision, quantity increments, minimum trade values, partial fills and order expiry/cancellation.
- Use a deterministic, documented fill model. The app must not claim a simulated fill is an actual exchange fill.
- Maintain a virtual cash ledger, asset positions, average cost, realised/unrealised PnL, fees, order history, trade history and portfolio valuation.
- Display the market-data provider and the last price update time.
- Keep paper-trading accounts isolated from external exchange credentials, blockchain wallets and production balances.
- Offer an explicit reset operation that warns that virtual account history will be erased.
- Store simulation state per authenticated user if accounts are introduced; do not use a shared hard-coded account for public use.
- Clearly display "SIMULATION — NO REAL FUNDS — NO EXCHANGE ORDER PLACED" on every simulator screen and receipt.

The simulator must never have access to wallet signing methods, CEX API secrets, withdrawal routes or production execution endpoints. Prefer a separate service boundary and separate data models. It should be impossible to turn a paper order into a live order merely by changing a UI toggle.

### Provider demo/test environments

Where an exchange publishes an official demo/test environment, S Coin may connect to it through a separate provider adapter. These environments use provider-issued demo credentials and simulate that exchange's own account/order behaviour.

Provider demo capabilities differ. Binance Spot Testnet is separate from production Spot. OKX has Demo Trading API mode with a required simulated-trading header and some unsupported operations. Bybit Demo Trading uses a separate demo domain and does not expose every production API. These environments cannot replace S Coin's own unified paper simulator.

### Historical backtesting

Backtesting is a third, separate simulation mode. It should replay historical candles/trades and report data coverage, strategy assumptions, fees, slippage, trade list, drawdown, Sharpe/return calculations where justified and limitations. Backtests are not proof of future returns and must not imply guaranteed profit.

## 5. Mode separation

The app should visibly separate these modes:

| Mode | Price/data | Balance | Order handling | Real value? |
|---|---|---|---|---|
| Live market viewer | Public provider feeds | No trading balance required | Read-only | No |
| S Coin paper trading | Public market data | Internal virtual ledger | Internal simulator only | No |
| Exchange demo/testnet | Provider's demo environment | Provider demo balance | Provider demo API only | No |
| Historical backtesting | Historical market data | Simulated ledger | Replay engine | No |
| Real CEX or on-chain execution | Approved live venue/network | Actual provider or chain balance | Live exchange or signed blockchain transaction | Yes |

Mode must be selected and displayed by the backend and validated again when an order is submitted. Never rely on a front-end label alone to prevent test orders reaching production or live orders reaching a demo endpoint.

## 6. Technical architecture

Use explicit provider interfaces rather than embedding venue assumptions in shared UI components:

- `MarketDataAdapter`: exchange metadata, tickers, candles, depth and trades.
- `ExchangeAccountAdapter`: authenticated account and balances, read-only by default.
- `OrderExecutionAdapter`: provider-specific order validation, placement, status, cancellation and reconciliation.
- `WalletAdapter`: connection, chain/account discovery and wallet signing requests.
- `SwapQuoteAdapter`: DEX quote, route, minimum-received and allowance information.
- `ChainAdapter`: chain identity, public balances, transaction simulation and chain transaction status.
- `PaperTradingEngine`: virtual accounts, virtual orders, fills, fees and ledger only.
- `BacktestEngine`: historical replay, strategy and results.

Normalise common fields in the application while preserving provider-specific data for auditing. Use provider-native symbol maps and precision rules; never assume that `BTC/USDT`, `BTC-USDT` and `XBT/USD` are interchangeable. Treat rate limits, clock drift, pagination, reconnects, partial fills, cancelled orders and out-of-order WebSocket events as normal failure cases.

For real CEX execution, the server must re-check the user's authenticated session, provider account, permission scope, market status, price/quantity increments, minimum notional, available balance, order idempotency and risk limits immediately before placement. Reconcile exchange order status after timeouts; a network timeout does not prove that an order failed.

## 7. Credential, wallet and transaction security

- Never ask a user to paste seed phrases, private keys, exchange secrets or production API tokens into ChatGPT, support tickets or source control.
- Do not put privileged credentials in `EXPO_PUBLIC_*` variables; Expo public variables are bundled into client applications.
- For any future server-side CEX connector, use encrypted secret storage/KMS, least privilege, per-user access controls, secret rotation and audit logs. Where the provider supports it, restrict keys by IP.
- Request read-only and trading permissions only when needed. Withdrawals and transfers-out must remain disabled.
- Never log full secrets, signed requests, seed phrases or sensitive authentication payloads.
- Apply MFA, session expiry, CSRF protection where applicable, origin checks, server-side rate limiting, WAF/abuse controls, alerts and incident response before public account/trading access.
- Use idempotency keys and immutable audit events for every real order attempt.
- Use transaction simulation and user confirmation for on-chain execution. Validate contract addresses and token decimals from trusted chain metadata.
- Obtain an independent security assessment for wallet, transaction, custody, key-handling and trading paths before real-value use.

## 8. Uganda and operating model

Before offering real exchange execution, brokerage-like functionality, custody, fiat or mobile-money conversion, cash-backed issuance/redemption, or operating a virtual-asset service, obtain a written Ugandan legal/regulatory assessment for the exact activity and entity. Determine applicable registration/licensing, AML/CFT, sanctions, customer due diligence, consumer disclosures, complaints, data protection, tax and cross-border requirements. Do not infer legal permission from a provider API key or from operating a software interface.

The internal simulator and public market viewer should remain clearly non-custodial and non-executing. Any change that allows S Coin or its operator to hold customer assets, control keys, execute orders for others or receive/settle fiat must trigger a new legal and security review.

## 9. Truthful implementation inventory (this repository)

### Implemented in the current feature branch

- Binance public Spot market discovery, market-data snapshots and WebSocket ticker updates.
- Search/watchlist and market detail data (candles, order-book snapshot and recent trades).
- Binance Spot Testnet account, test-order validation, demo market/limit orders, open orders, cancellations and order history.
- EVM browser wallet discovery and native MetaMask Connect support.
- Keplr browser connection for Cosmos/S Coin.
- External-wallet-approved native EVM and ERC-20 sends, with chain restrictions and receipt checks.
- Browser Keplr S Coin send flow, disabled by default pending trusted production chain configuration.
- 0x EVM swap quote/preview and gated execution path.
- Skip Go Cosmos/IBC route preview only.
- Automated tests and web/Android/iOS bundle checks recorded on the current feature commit.

### Configured but disabled or limited

- Native S Coin sends: require an operator-supplied, verified chain ID, trusted HTTPS RPC and approved gas price; disabled by default.
- EVM swap execution: disabled by default on app and server; requires verified supported networks, tokens, 0x transaction targets and allowance spenders.
- EVM native sends: current chain restriction defaults to Sepolia.
- Binance testnet: only the Binance Spot Testnet endpoint; not production Binance.
- Cosmos wallet: Keplr browser flow only; native mobile Keplr session pairing is not implemented.

### Not implemented

- OKX, Bybit, Coinbase Advanced, Kraken or other exchange account/order adapters.
- A unified multi-exchange live order terminal.
- S Coin's own exchange-independent crypto paper-trading engine.
- A standalone S Coin self-custody wallet, seed phrase generation, encrypted key vault or recovery service.
- Production S Coin chain, public validator network, production RPC, DEX liquidity or IBC route.
- Production CEX API credential vault, authenticated public user accounts or multi-tenant trading backend.
- Deposits, withdrawals, fiat/mobile-money settlement, cash-backed issuance or redemption.
- Independent security audit or a live deployment.

These items must not be shown as complete in product marketing or UI until delivered and verified.

## 10. Acceptance criteria for a credible public release

- All core app routes are registered and work on web, Android and iOS.
- Market data clearly identifies its provider and freshness.
- Paper trading is separated from exchange demo and production trading at API, data and credential boundaries.
- Each exchange connector passes sandbox contract tests, rate-limit tests, precision tests, failure/reconciliation tests and provider-specific approval checks.
- Wallet signing shows clear transaction details, wrong-chain prevention and safe error/recovery behaviour.
- Server authentication, user isolation, secret management, audit logging, abuse controls, monitoring, backup and incident response are live-tested.
- Dependency/security scanning has no unresolved high-impact finding without an approved, documented mitigation.
- Monetary policy, genesis, tokenomics, chain operations and legal obligations are formally approved before native S Coin is described as a production asset.
- External independent security review and legal/regulatory sign-off are recorded.
- Release has a rollback plan, status page, support channel and incident contact.

## 11. Release policy

`main` is the canonical source branch. Merging code into `main` does not, by itself, deploy a production app, launch a public blockchain, create market liquidity or authorise real-money trading.

A safe public web release may initially expose the market viewer and clearly labelled simulation/demo tools only, after build, hosting, privacy, monitoring and support checks. Real exchange execution, deposits, withdrawals, custody, S Coin transfers and public chain operation must stay disabled until their individual requirements are met. There is no "one switch" that safely turns every provider and network live.

## 12. Provider references

- [Binance Spot Testnet documentation](https://github.com/binance/binance-spot-api-docs/blob/master/testnet/general-info.md)
- [OKX API documentation — Demo Trading](https://www.okx.com/docs-v5/)
- [Bybit API documentation — Demo Trading Service](https://bybit-exchange.github.io/docs/v5/demo)
- [Expo SDK 58 Router documentation](https://docs.expo.dev/versions/v58.0.0/sdk/router/)
