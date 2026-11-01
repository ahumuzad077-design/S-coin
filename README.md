# S Coin

S Coin is a Cosmos SDK chain scaffold with the native staking denomination
`uscoin` and the `scoin` address prefix. Bank denomination metadata identifies
`scoin` (symbol `S`) as the display unit, with `1 S = 1,000,000 uscoin`.

This repository is a development/testnet starting point. It is not a launched
public blockchain, has not been independently audited, and its testnet coins
have no real-world value.

## Multi-platform product scope

The intended product is a multi-exchange crypto markets and wallet application, not a Binance-only trading terminal. It distinguishes exchange accounts, external blockchain wallets, decentralised swap routes, S Coin's own asset, provider demo environments and S Coin's internal paper-trading simulator. The full product definition, supported-provider status, simulation model, security boundaries and release requirements are documented in [the S Coin product blueprint](./docs/S-COIN-PRODUCT-BLUEPRINT.md).

## Native SQM policy and production launch status

The source tree is currently named S Coin (`scoin`), not SQM. Its native base
denomination is `uscoin`; this repository does not define a separate SQM
denomination. Native monetary policy is **UNDECIDED — FORMAL APPROVAL
REQUIRED**. The maximum supply and genesis allocations are not defined or
approved, and the current source enables Cosmos SDK inflation. Do not describe
the native coin as fixed-supply, promise a founder allocation, or treat local
testnet balances as production allocations.

Production launch is blocked. There is no configured production bank or
custodian, verified UGX or USD reserve, approved redemption arrangement, or
regulatory authorization in this repository. No production cash-backed
issuance or redemption is operational. See the [production readiness audit](./docs/production-readiness.md)
for the source-backed monetary-policy audit, launch blockers, and required
approvals. Do not change native issuance settings until the complete monetary
policy has been formally approved.

## Cash-backed issuer foundation (Stage 1)

The standalone [`issuer/`](./issuer/) module contains provisional SQM-UGX and
SQM-USD specifications (`sqmugx`: 0 decimals, UGX 1/base unit;
`sqmusd`: 2 decimals, USD 0.01/base unit), integer-based reserve coverage and
reconciliation checks, verified-operation multisignature policy, provider
interfaces and signed-webhook parsing, redemption state rules, a protected
dashboard handler, and an initial PostgreSQL schema. These are unconnected
foundations, not a live issuer: `CanIssue` and `CanRedeem` are hard-disabled,
no cash-backed asset is registered on-chain, and no bank/custodian, production
database, wallet key management, payout service, or production authentication
provider is configured. The migration has not been run against PostgreSQL. Read
[`issuer/README.md`](./issuer/README.md) before running tests or considering
the schema.

## Validator rewards and inflation

The Cosmos SDK mint and distribution modules are enabled. The scaffold uses the
SDK's default mint parameters: 13% initial inflation, 7% minimum, 20% maximum,
a 67% bonded-stake target, and a 13% annual inflation-rate change. These are
framework defaults, not a reviewed S Coin monetary policy. Set and test the
economic parameters before inviting public validators.

## Local development

Run these commands from Ubuntu on WSL in the `scoin` directory. Build the node
once, then start a single-validator local development chain. This does not start
a public network.

```sh
export PATH="/usr/local/go/bin:/usr/local/bin:$HOME/go/bin:$PATH"
export DO_NOT_TRACK=true
mkdir -p "$HOME/tmp" "$HOME/go/bin"
export TMPDIR="$HOME/tmp"
go build -mod=readonly -o "$HOME/go/bin/scoind" ./cmd/scoind
ignite chain serve --skip-build --skip-proto --config config.yml
```

Press `Ctrl+C` to stop the local chain. Its state is for development only.

## Check denomination metadata and send a local test transaction

With the local chain running, query the metadata and send 1,000 base units from
the local Alice account to Bob:

```sh
"$HOME/go/bin/scoind" query bank denom-metadata uscoin
BOB=$("$HOME/go/bin/scoind" keys show bob -a --keyring-backend test)
"$HOME/go/bin/scoind" tx bank send alice "$BOB" 1000uscoin \
  --chain-id scoin \
  --keyring-backend test \
  --fees 100uscoin \
  --gas auto \
  --yes
```

These are disposable development accounts and a local-only transaction; they
are not public testnet funds.

## Local multi-validator testnet files

Generate four validator directories with a shared genesis using the node built
above. Store them in the Linux home directory rather than the Windows-mounted
project folder so WSL can enforce private key permissions:

```sh
"$HOME/go/bin/scoind" multi-node \
  --v 4 \
  --output-dir "$HOME/scoin-testnet-1" \
  --chain-id scoin-testnet-1 \
  --validators-stake-amount 100000000,100000000,100000000,100000000
```

The generated directory contains validator keys and seed phrases. Keep it
private and disposable; never publish or reuse these local keys. The generated
nodes are configured for a local test network, not public hosting.

To run all four validators, open four Ubuntu terminals and run one command in
each:

```sh
"$HOME/go/bin/scoind" start --home "$HOME/scoin-testnet-1/validator0"
"$HOME/go/bin/scoind" start --home "$HOME/scoin-testnet-1/validator1"
"$HOME/go/bin/scoind" start --home "$HOME/scoin-testnet-1/validator2"
"$HOME/go/bin/scoind" start --home "$HOME/scoin-testnet-1/validator3"
```

The local RPC ports are `26657`, `26654`, `26651`, and `26648`, respectively.
Keep them local; do not expose these development nodes to the internet. Press
`Ctrl+C` in each terminal to stop its validator.

## MERIDIAN real exchange-operator operations

The proposed MERIDIAN securities-market venture is being developed as a separate Go service in [`exchange/`](./exchange/). The first real subsystem supports authenticated issuer applications, company registration particulars, exchange reviewer decisions, durable PostgreSQL storage and append-only audit/application-event records. It contains no synthetic listings, mock prices, paper balances, simulated fills or trading endpoint.

The exchange operations service is separate from the S Coin blockchain and does not use native `uscoin`, SQM-UGX, SQM-USD or issuer reserves as securities, cash balances or settlement assets. The S Coin Expo wallet remains separate; securities exchange administration does not belong inside a cryptocurrency wallet screen.

See [`exchange/README.md`](./exchange/README.md) for database, OIDC, TLS and API requirements, and [`docs/meridian-concept.md`](./docs/meridian-concept.md) for the real exchange establishment programme and regulatory sequence.

**Live-market boundary:** MERIDIAN is not currently an incorporated/approved securities exchange. The first service does not list securities, approve offers, accept investments, onboard licensed brokers, route/match orders, custody assets, clear trades or settle transactions. It reports `tradingEnabled: false` unconditionally. A real market requires the applicable CMA approval and conditions, market rules, suitable capital and governance, authorised trading participants, approved securities central-depository connectivity, clearing/settlement arrangements, surveillance and operational readiness. Do not present an issuer application as an approved listing.

## Before operating a public testnet

A public testnet needs independently operated validators, a coordinated
genesis, reachable peer-to-peer endpoints, monitoring, backups, and a tested
upgrade and incident-response process. The local multi-node files are only a
starting point: configure each host's networking and peer settings, and keep
RPC/API endpoints restricted. Do not reuse the generated local keys or genesis
for a public network.

Before any real-value deployment, the chain's monetary policy, genesis
allocations, validator onboarding, wallet compatibility, operations, and
security must be reviewed and independently audited.

## S Coin web and mobile app

The shared Expo app is in [`client/`](./client/). It runs on web, Android, and
iOS and provides a read-only account lookup, network status, recent account
transactions, and bonded-validator information. It does not create wallets,
hold private keys, sign transactions, or promise coin value.

Install dependencies once:

```sh
cd client
npm install
```

For web development, keep a local S Coin node running with its REST API enabled.
The generated multi-validator node configuration disables REST by default. In
`$HOME/scoin-testnet-1/validator0/config/app.toml`, set `enable = true` in the
`[api]` section and keep the API bound to `tcp://localhost:1317`. Then use two
terminals in `client/`:

```sh
npm run proxy
```

```sh
npm run web
```

The local proxy binds only to `127.0.0.1:8787`, permits only read-only chain
query routes, and allows browser requests only from the local Expo web
development origin.

To open the native app with Expo Go, run `npm start` in `client/` and scan its
QR code. The Android emulator uses `http://10.0.2.2:1317` by default; the iOS
simulator uses `http://127.0.0.1:1317`. Physical devices need a trusted,
reachable REST API URL entered under Connection settings. Do not expose a
validator node or its RPC/API ports to the public internet just to connect a
phone. iOS native builds require macOS or a configured remote build service.

Use only a trusted node endpoint. This app is a development client; it has not
been security audited and is not suitable for managing real funds.

## Markets and wallet connection hub

The app includes a Markets screen to the Expo
client. It reads public Binance Spot market data for selected USDT pairs and
supports browser-injected EVM wallet connections, MetaMask Connect sessions in
native Android/iOS builds, and Keplr connections for a preconfigured S Coin
Cosmos chain.

Run the existing app as described above, then open **Markets** in the app
navigation. No new package installation is required for this initial browser
integration. Set `EXPO_PUBLIC_SCOIN_CHAIN_ID` to the exact trusted S Coin chain
ID when one has been established; do not guess or reuse a local test chain ID
for production.

This is not an independent self-custody vault: S Coin does not generate,
store or recover seed phrases or private keys. It uses external wallets for
EVM and Cosmos signing. Native EVM and ERC-20 transfers require external wallet
approval and are enabled by chain allowlist; native transfers default to
Sepolia. Browser users can also send native S Coin through Keplr when the exact
chain ID, trusted RPC and operator-approved gas price have been configured.
Cosmos sends are disabled by default and Keplr mobile pairing is not configured.
An EVM swap flow supports separate exact-amount approval and wallet signing,
but execution is disabled by default on both server and app. Binance trading
is isolated to its Spot Testnet, with simulated account balances and orders.
Production Binance trading, deposits and withdrawals are not implemented.

See [wallet and exchange integration notes](./docs/wallet-and-exchange-integration.md)
for the architecture, security boundary, regulatory readiness and next stages.
Do not use this client to manage real funds; independent security review and
production readiness gates remain outstanding.

## Markets, wallet and quote service

The Markets screen now includes a Binance public REST snapshot plus a
reconnecting public WebSocket feed, search, local watchlist and 24-hour market
metrics. See `client/.env.example` for the public endpoint settings.

The app also includes a service in `server/swap-api/` with a
0x EVM quote endpoint and a Skip Go Cosmos/IBC route-preview endpoint. EVM swap
execution is gated off by default and requires exact server and app chain,
token, transaction-target and allowance-spender allowlists. Keep
`ZEROX_API_KEY` on the server. Configure only the public HTTPS service URL in
`EXPO_PUBLIC_SWAP_API_URL`.

The app reads native balances for connected EVM and S Coin accounts where a
trusted endpoint responds. It supports externally approved native EVM and
ERC-20 transfers, browser Keplr sends of native S Coin when explicit operator
configuration is present, and EVM swaps when both allowlists are explicitly
enabled. Binance account/order functions are restricted to Spot Testnet.
MetaMask Connect is available in native EVM builds; native Keplr mobile pairing
remains future work. S Coin still has no verified production network or
registered DEX/IBC swap route. See
[`docs/wallet-and-exchange-integration.md`](./docs/wallet-and-exchange-integration.md)
and [`server/swap-api/README.md`](./server/swap-api/README.md).

The market screen now discovers active Binance Spot markets quoted in USDT from
Binance exchange metadata, ranks them by 24-hour quote volume, and supports
search across the full discovered set. It shows the top 100 by default and
updates from Binance's public all-market 24-hour ticker WebSocket stream.

The selected market detail panel also shows 24 hourly candles, a top-of-book
snapshot (up to 10 bid and ask levels), and recent trades. These are public
read-only market-data endpoints; they do not place or settle orders.


## Binance Spot Testnet

The Markets screen includes a separate Binance Spot Testnet account and
trading panel for simulated balances, MARKET/LIMIT orders, order validation,
open-order cancellation and recent order history. It is pinned to
https://testnet.binance.vision and has no production API, withdrawals, margin
or futures route. The API key and secret are entered locally; mobile uses the
OS secure store and web keeps them in memory for the browser session only.
Create a dedicated key at https://testnet.binance.vision.

## EVM swap execution

An EVM swap flow is implemented with quote binding, token balance/allowance
checks, exact sell-amount approvals, transaction simulation, gas estimation
and separate wallet confirmation. It is deliberately disabled by default in
both the quote service and the app build. It requires matching chain and
contract allowlists and an independently reviewed supported 0x network.
0x swaps are not enabled on Sepolia, and native S Coin swaps are not available
until the real S Coin network, DEX/IBC route and liquidity are verified.


## Securities markets and AI trading

S Coin now includes the MERIDIAN issuer-operations foundation and the Sentinel AI stocks/crypto trading service in this repository:

- `exchange/`: MERIDIAN issuer intake, company verification, compliance review, durable PostgreSQL records and append-only audit events. It is not yet an authorised exchange and exposes no live securities-trading endpoint.
- `integrations/sentinel/`: Sentinel's AI-assisted multi-asset analysis, Alpaca stock/crypto integration, trading risk engine, journal, learning and performance dashboard. API endpoints require a server-side token. Paper trading is forced unless live mode is separately enabled by an operator.
- `client/src/app/securities.tsx`: S Coin navigation surface for securities services. Configure optional external service URLs in `client/.env`; never place API keys or secrets in `EXPO_PUBLIC_*` variables.

The MERIDIAN and Sentinel services remain separate from the Cosmos chain and from the crypto wallet's custody boundary. Securities order routing, matching, settlement, live broker access and public exchange trading remain disabled until the necessary regulatory authorisation, counterparties, security controls and operational readiness are verified.
