# S Coin markets, wallets and exchange integration

Status: the feature branch contains public market-data streaming, browser wallet
account connections, and server-side **quote previews**. This is not a live
custodial wallet, centralized exchange, or production swap service.

## Implemented in this branch

- Binance Spot REST snapshot and WebSocket market data for a selected set of
  24 USDT pairs. The UI includes a searchable list, a local watchlist, a
  selected-market summary, and reconnect handling. Data is public and does not
  require a Binance account or API key.
- Browser EIP-6963/EIP-1193 provider discovery for MetaMask and compatible EVM
  wallets. The app requests public account access and chain ID only.
- Browser Keplr account connection for a configured Cosmos SDK S Coin chain ID.
  It checks the \`scoin1\` address prefix and never asks for a recovery phrase.
- A quote-only Node service:
  - \`POST /v1/evm/quote\` uses 0x AllowanceHolder quote API for an operator-
    allowlisted EVM chain and pair of tokens.
  - \`POST /v1/cosmos/route-preview\` uses Skip Go's route API for configured
    Cosmos chains and denoms.
  - Request validation, strict chain/token allowlists, size limits, per-IP
    rate limiting, CORS allowlisting, server-side 0x key handling, and a
    health endpoint.
- An Expo UI that can request a firm EVM quote from the server and display its
  minimum output and approval warning. It does not ask the wallet to approve
  tokens or submit a transaction.
- Separate CI workflows for Go, the Expo web client (typecheck + web export),
  and the quote service (syntax checks + unit tests).

## What is deliberately not implemented

- Generating/importing recovery phrases, storing signing keys, private-key
  custody, or an independent seed-phrase wallet. A wallet connection is not
  the same thing as an S Coin wallet.
- Cosmos transaction signing or send/receive. Keplr is connected only to show
  the account address. The exact trusted S Coin chain ID and public RPC/REST
  endpoints still need to be supplied and configured.
- Independent seed-phrase wallet generation/import, private-key custody, or
  recovery-key backup. MetaMask Connect links to an external self-custody
  wallet; it does not make S Coin the wallet key custodian.
- Native Keplr/Cosmos wallet pairing. Keplr is currently connected through a
  browser provider only; native Expo builds still need a supported Cosmos
  WalletConnect session and an exact, registered S Coin chain configuration.
- Any EVM token approval, transaction signing, swap broadcast, receipt
  tracking, or refund/recovery process. Quotes are not trades.
- Cosmos Skip \`/msgs\` generation, signing, or cross-chain transaction
  submission. A route preview is not an executable IBC transfer.
- Authenticated Binance account balances, private User Data Streams, trading,
  order placement, deposits, withdrawals, margin, futures, or custody.
- Fiat, bank, mobile-money, cash-in/cash-out, reserve management, or issuance.
- A supported S Coin-to-other-coin route. S Coin is not yet listed in the
  provider's supported-chain/asset route set, and the repository does not
  prove that a production DEX pool or IBC path exists for it.

## Architecture

S Coin is a Cosmos SDK / CometBFT chain with the \`scoin\` Bech32 address
prefix. MetaMask is an EVM wallet; it does not natively sign Cosmos SDK
transactions. The app treats the two wallet families separately:

- Keplr (Cosmos) for a trusted S Coin chain, once the chain is properly
  configured.
- MetaMask/EIP-1193 (EVM) for EVM-compatible networks. The chain ID is read
  from the connected wallet and used when requesting a quote.

The existing S Coin chain is still a development/testnet scaffold. It has no
verified production RPC, mainnet launch, approved native coin monetary policy,
or supported public DEX/IBC liquidity route. The issuer module remains
hard-disabled and its launch blockers are unchanged.

## Binance public market data

The app uses Binance's official public market-data host and stream host:

- REST: \`https://data-api.binance.vision\`
- WebSocket: \`wss://data-stream.binance.vision\`

The all-market 24-hour ticker stream updates last price, 24-hour percentage change,
high, low, and quote volume. A selected market loads a read-only REST snapshot
of 24 hourly candles, 10 bid and ask levels, and the 10 most recent trades. The feed reconnects with backoff and recycles its
connection before Binance's 24-hour connection limit. Binance confirms that
these market-data-only endpoints do not require authentication; User Data
Streams are not available on the market-data-only host.

Do not put Binance API secrets in Expo environment variables, browser code,
mobile bundles, GitHub, or client storage. Authenticated Binance integration
would require a separately designed server-side service, encrypted secret
storage, per-user authorization, restricted API permissions, audit logs,
rate limits, and testnet validation. Withdrawal permissions should remain
disabled by default.

## Running the current code

### Expo app

Copy \`client/.env.example\` to \`client/.env\` and set only public URLs and the
exact S Coin chain ID. Do not put secrets in \`EXPO_PUBLIC_*\` variables.

\`\`\`sh
cd client
npm ci
npm run web
\`\`\`

For the local read-only Cosmos API proxy, run \`npm run proxy\` in a second
terminal. The existing local proxy remains GET-only and binds to loopback.

### Quote service

Run \`node server/swap-api/server.mjs\` from the repository root after setting
the service environment variables in the deployment environment. The safe
example file is \`server/swap-api/.env.example\`; create a local \`.env\` only
for development and never commit it.

Set:
- \`ZEROX_API_KEY\`: server-only 0x API key.
- \`SWAP_ALLOWED_EVM_CHAIN_IDS\`: numeric EVM chain IDs explicitly enabled.
- \`SWAP_ALLOWED_TOKENS_JSON\`: per-chain token contract address allowlist.
- \`SWAP_ALLOWED_COSMOS_CHAIN_IDS\`: Cosmos chain IDs enabled for Skip route
  previews.
- \`SWAP_API_ALLOWED_ORIGINS\`: exact app origin(s) allowed by CORS.
- \`EXPO_PUBLIC_SWAP_API_URL\`: public HTTPS URL of the quote service in the
  Expo app. This is a URL, not a secret.

The service rejects unknown chains and tokens. Do not add a chain or token to
the allowlist until its network, contract, liquidity, and legal status have
been checked. The service has no transaction broadcast endpoint.

## Swap execution requirements

An executable swap requires more than a price or route:

1. The connected wallet account and chain must match the quote request.
2. Token contract addresses, decimals, network, spender and transaction target
   must be verified against a trusted token/chain allowlist.
3. Allowance must be queried and limited to the amount needed; approval must
   be user-confirmed in the wallet.
4. The transaction must be simulated, gas-estimated, and checked against
   minimum output, price impact, slippage, expiry, and fee limits.
5. The user must review and sign in their own wallet. S Coin must not receive
   or store a wallet seed phrase or private key.
6. The app must monitor the transaction receipt and define retry, timeout,
   failed-transfer and cross-chain recovery procedures.

0x provides EVM quotes and transaction calldata on supported networks; its
API key is required and must stay server-side. Skip Go can generate routing
information for supported Cosmos/IBC and EVM routes. Neither provider can make
an unregistered S Coin chain liquid by itself. Add S Coin only after the chain
registry/provider support, asset metadata, route, DEX liquidity, and IBC
channels are in place.

## Security, launch and Uganda compliance

Before customer funds or fiat rails are enabled:

1. Publish and verify the intended chain ID, RPC/API endpoints, validator
   operators, explorer, network metadata, fee policy, native coin policy,
   genesis allocations, upgrade authority and incident-response process.
2. Complete an independent audit of chain, wallet, API, signing, swap, issuer,
   mobile, and supply/monetary-policy components. Add phishing protection,
   address validation, transaction simulation, hardware-wallet support,
   recovery, backup and incident-response tests.
3. Obtain written Ugandan legal advice for the exact operating model:
   exchange, brokerage, custody, transfer, stablecoin issuance, payment
   processing, consumer protection, AML/CFT and cross-border operations are
   not interchangeable activities.
4. FIA's February 2026 publication describes registration of accountable
   persons under the Anti-Money Laundering Act. Do not treat FIA registration
   as automatic prudential licensing or as blanket permission to conduct every
   virtual-asset or payment activity.
5. Treat fiat deposits, withdrawals, mobile money, bank transfers, custody and
   exchange execution as separately reviewed integrations. Confirm current
   Bank of Uganda requirements and restrictions with counsel and the relevant
   authorities before connecting regulated payment institutions.
6. Keep the existing SQM issuer hard-disable flags and production launch
   blockers unchanged. This integration does not approve SQM issuance,
   redemption, reserves, allocations, or monetary policy.

Official references:

- Binance public market data:
  https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
- Binance WebSocket streams:
  https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md
- MetaMask Connect:
  https://docs.metamask.io/metamask-connect/
- 0x API:
  https://docs.0x.org/api-reference/api-overview
- 0x Swap quickstart:
  https://docs.0x.org/docs/introduction/quickstart/swap-tokens-with-0x-swap-api
- Skip Go route API:
  https://github.com/cosmos/docs/blob/main/swagger.yml
- Cosmos chain registry:
  https://github.com/cosmos/chain-registry
- Keplr mobile browser guidance:
  https://help.keplr.app/mobile-app/5R3bMyjtr3iKzMhqyCqu56/explore-dapps-with-keplr-mobile%E2%80%99s-browser
- Uganda FIA accountable-person registration:
  https://fia.go.ug/accountable-persons-to-register-with-fia/

## Remaining implementation stages

1. Configure a trusted S Coin network ID plus RPC/REST and register its chain
   metadata with Cosmos wallet/chain registries.
2. Add Cosmos message signing with a maintained wallet SDK and safe transfer
   construction, fee estimation, simulation, and transaction monitoring.
3. Integrate MetaMask Connect for native Expo/mobile EVM sessions and a
   supported Cosmos mobile wallet adapter.
4. Add audited EVM approval/signing/receipt tracking and a Cosmos/IBC
   \`/msgs\` execution path only after supported routes and token policies exist.
5. Independently verify S Coin's listing, liquidity, IBC channels, route
   provider inclusion, and price impact before enabling S Coin swaps.
6. Add authenticated Binance Spot Testnet account/order support only if there
   is a confirmed business need; any production exchange integration needs
   separate legal, operational and security approvals.
