# S Coin

S Coin is a Cosmos SDK chain scaffold with the native staking denomination
`uscoin` and the `scoin` address prefix. Bank denomination metadata identifies
`scoin` (symbol `S`) as the display unit, with `1 S = 1,000,000 uscoin`.

This repository is a development/testnet starting point. It is not a launched
public blockchain, has not been independently audited, and its testnet coins
have no real-world value.

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

## Markets and wallet connection hub (feature branch)

The feature branch `feat/scoin-wallet-markets` adds a Markets screen to the Expo
client. It reads public Binance Spot market data for selected USDT pairs and
supports browser-injected EVM wallet connections, MetaMask Connect sessions in
native Android/iOS builds, and Keplr connections for a preconfigured S Coin
Cosmos chain.

Run the existing app as described above, then open **Markets** in the app
navigation. No new package installation is required for this initial browser
integration. Set `EXPO_PUBLIC_SCOIN_CHAIN_ID` to the exact trusted S Coin chain
ID when one has been established; do not guess or reuse a local test chain ID
for production.

This is an early wallet and market-data stage, not a standalone self-custody
wallet or exchange. It does not generate or store recovery phrases or private
keys. It supports user-approved native-asset transfers through an external
EVM wallet only on chain IDs listed in
EXPO_PUBLIC_EVM_TRANSFER_CHAIN_IDS; the default is Sepolia testnet. Standard
ERC-20 sends are also supported through external wallet approval on those
configured networks. It does not send native S Coin, execute swaps, place
Binance orders, or process deposits/withdrawals. Browser extension connections are
supported in web builds; native MetaMask Connect requires a custom Expo
development/native build and trusted RPC configuration. Keplr mobile pairing
is still not configured. 0x and Skip integrations return quote/route previews
only; they do not approve, sign or broadcast swaps.

See [wallet and exchange integration notes](./docs/wallet-and-exchange-integration.md)
for the architecture, security boundary, regulatory readiness and next stages.
Do not use this client to manage real funds; independent security review and
production readiness gates remain outstanding.

## Markets, wallet and quote service

The Markets screen now includes a Binance public REST snapshot plus a
reconnecting public WebSocket feed, search, local watchlist and 24-hour market
metrics. See `client/.env.example` for the public endpoint settings.

The feature branch also includes a **quote-only** service in
`server/swap-api/`. It supports a protected 0x EVM quote endpoint and a Skip
Go Cosmos/IBC route-preview endpoint. Configure the service-side chain and
token allowlists and keep `ZEROX_API_KEY` on the server. Configure only the
public HTTPS service URL in `EXPO_PUBLIC_SWAP_API_URL`.

The app can display a 0x quote and Skip Go Cosmos route preview, and reads
native coin balances for connected EVM and S Coin accounts where a trusted RPC
responds. It can prepare and submit native EVM transfers on explicitly
allowlisted networks after the user reviews the amount/fee preview and approves
the transaction in MetaMask. The default transfer allowlist is Sepolia only.
ERC-20 transfers, EVM swaps, Cosmos sends, seed-phrase wallet creation,
key storage and account recovery are not implemented. MetaMask Connect is
available in native EVM builds; Keplr mobile pairing and native Cosmos
transaction signing remain future work. S Coin has no verified production
network or registered DEX/IBC swap route yet. See
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
