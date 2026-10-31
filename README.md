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

## Meridian securities-market simulator (pre-licensing)

The Expo app includes a **MERIDIAN Markets** tab connected to an isolated local Go simulator in [`exchange/`](./exchange/). This is a synthetic paper-trading prototype only, not a securities exchange, broker, investment offer, custodian, central securities depository, clearing house, or settlement service. Its fictional issuers, prices, balances, orders and fills have no real-world value. The matching engine is in-memory and resets when the demo process stops.

Run the simulator from the repository root:

```sh
cd exchange
go test ./...
go run ./cmd/meridian-demo
```

It binds to `127.0.0.1:8788` by default and refuses non-loopback listen addresses. Start the Expo client in a second terminal using the normal [client instructions](./client/AGENTS.md). The Markets tab uses the local simulator endpoint automatically for web, iOS simulator and Android emulator development. For a different local endpoint, set `EXPO_PUBLIC_MERIDIAN_API_URL` before starting Expo.

Read [`exchange/README.md`](./exchange/README.md) for API endpoints, the synthetic matching and reservation rules, and limitations. Read [`docs/meridian-concept.md`](./docs/meridian-concept.md) for the proposed future regulated-exchange thesis.

**Production boundary:** MERIDIAN is not licensed or approved to operate a securities exchange. The simulator must not be exposed to the internet or connected to real investors, cash, securities, S Coin balances, SQM reserve assets, broker systems, custody systems or settlement infrastructure. Any real exchange operation requires the relevant regulator approvals, qualified market-operator governance, legal advice, approved trading participants, depository/clearing/settlement arrangements, operational capital, security testing and jurisdiction-specific permissions. The simulator does not modify the S Coin native `uscoin` monetary policy or the separate `issuer/` cash-backed asset foundation.

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
