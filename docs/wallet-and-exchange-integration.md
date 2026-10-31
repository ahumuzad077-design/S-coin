# S Coin markets, wallet and exchange integration

**Status:** extended development feature branch. It is not a production wallet,
centralized exchange, broker, custodian or live swap service.

## Implemented in this branch

### Binance market terminal

- Discovers every active Binance Spot market whose quote asset is USDT using
  Binance exchange metadata and filters for TRADING Spot pairs.
- Loads a public 24-hour ticker snapshot, sorted by quote volume.
- Streams the all-market 24-hour rolling ticker WebSocket feed and refreshes
  discovery/snapshot data every five minutes to pick up new and delisted pairs.
- Displays the top 100 markets by default; search filters the full discovered
  set. Users can maintain a local watchlist.
- Selected market details include 24 hourly candles, the top 10 bid/ask levels,
  and 10 recent trades.
- Reconnects the WebSocket with exponential backoff and recycles a connection
  before Binance's 24-hour connection lifetime.
- Uses public market-data-only endpoints. No Binance API key is needed and
  these calls do not access customer accounts or place orders.

### Wallet connections

- Web browser: EIP-6963/EIP-1193 provider discovery for MetaMask and compatible
  EVM wallets.
- Native Expo Android/iOS: MetaMask Connect EVM uses its mobile deeplink
  session to open MetaMask Mobile and return the public account and EVM chain
  ID.
- Keplr browser extension: connects to the configured Cosmos SDK S Coin chain
  and verifies the returned address begins with scoin1.
- EVM wallet account/network change events clear the displayed wallet and any
  stale quote.
- The client reads the connected EVM account's native balance where the
  wallet's RPC responds. The Keplr connection reads S Coin bank balances
  through the configured Cosmos REST API.
- The connections use external wallets. S Coin does not receive or store
  recovery phrases or private keys.
- Native EVM asset transfers have a two-step amount/fee preview and then call
  the connected wallet's `eth_sendTransaction` method. The wallet owner must
  approve the transaction in MetaMask. The exact chain must be included in
  `EXPO_PUBLIC_EVM_TRANSFER_CHAIN_IDS`; the default is Sepolia only.
- The app checks the account and chain again before submission, estimates gas,
  checks the balance against amount plus estimated fee, validates the returned
  transaction hash, and polls for a transaction receipt. A fee estimate is not
  a guaranteed final network fee.
- Standard ERC-20 transfers read contract code, token decimals and the connected
  account's token balance, validate the requested amount, estimate native gas,
  then request the external wallet to submit the token contract's `transfer`
  call. The token contract address is user-supplied and must be verified by
  the user; the transfer is restricted to the same configured EVM testnet
  allowlist by default.

### Quote and route previews

The separate Node service under server/swap-api/ has two preview endpoints:

- POST /v1/evm/quote: obtains a 0x AllowanceHolder quote for an operator-
  allowlisted EVM chain and token pair.
- POST /v1/cosmos/route-preview: asks Skip Go for a Cosmos/IBC route preview
  for operator-allowlisted Cosmos chains and denominations.

The service validates chain IDs, token addresses, base-unit amounts and
slippage, caps request size, applies an in-memory per-IP rate limit, restricts
browser origins, and keeps the 0x API key server-side. It returns quote or
route data only. It has no endpoint to approve tokens, sign, broadcast or
submit a transaction.

The app displays EVM quote output/minimum-output information and Cosmos route
summary information. It does not turn a quote into an executable trade.

## Wallet and chain architecture

S Coin is a Cosmos SDK / CometBFT chain with the scoin Bech32 address
prefix. MetaMask is an EVM wallet and does not natively sign Cosmos SDK
transactions. The integration therefore separates the two wallet families:

- MetaMask Connect / EIP-1193 is for EVM-compatible networks.
- Keplr is for the native Cosmos SDK S Coin network when its exact chain ID
  and trusted RPC/REST endpoints are configured.

The repository still describes a development/testnet scaffold. It does not
identify a verified production RPC, public mainnet, approved native monetary
policy or S Coin production liquidity route. The existing SQM issuer module
remains hard-disabled; this branch does not change issuance, redemption,
supply, reserves, validator rewards or monetary policy.

## Binance public market data

The app uses Binance's official public market-data host and stream host:

- REST: https://data-api.binance.vision
- WebSocket: wss://data-stream.binance.vision

The all-market 24-hour ticker stream updates last price, 24-hour percentage
change, high, low, and quote volume. A selected market loads a read-only REST
snapshot of 24 hourly candles, 10 bid and ask levels, and the 10 most recent
trades. The feed reconnects with backoff and recycles its connection before
Binance's 24-hour connection limit. Binance confirms that these market-data-
only endpoints do not require authentication; User Data Streams are not
available on the market-data-only host.

Do not put Binance API secrets in Expo environment variables, browser code,
mobile bundles, GitHub, or client storage. Authenticated Binance integration
would require a separately designed server-side service, encrypted secret
storage, per-user authorization, restricted API permissions, audit logs,
rate limits, and testnet validation. Withdrawal permissions should remain
disabled by default.

## Configuration and local development

Copy client/.env.example to client/.env. EXPO_PUBLIC_* values are embedded in
client builds and must contain public configuration only, never secrets.

- EXPO_PUBLIC_SCOIN_API_URL: trusted Cosmos REST endpoint or the existing
  local read-only proxy.
- EXPO_PUBLIC_SCOIN_CHAIN_ID: exact trusted S Coin chain ID. Leave blank
  until the network operator supplies the real value; do not guess it.
- EXPO_PUBLIC_SWAP_API_URL: HTTPS base URL for the server-side quote API.
- EXPO_PUBLIC_SCOIN_DAPP_URL: official HTTPS app origin displayed by
  MetaMask Connect. Replace the repository fallback before public release.
- EXPO_PUBLIC_METAMASK_SUPPORTED_NETWORKS_JSON: optional JSON map from
  EVM hex chain IDs to trusted HTTPS RPC URLs. Defaults in the source cover
  Ethereum, Sepolia, Polygon, Optimism, Arbitrum, Base and BNB Chain. Public
  RPCs have no uptime guarantee; replace them with production RPC services.
- EXPO_PUBLIC_EVM_TRANSFER_CHAIN_IDS: comma-separated EVM hex chain IDs where
  native-asset sending is enabled. The default is `0xaa36a7` (Sepolia). Do
  not add mainnets before testnet validation, a security review and an explicit
  operational decision.

### Web development

    cd client
    npm ci
    npm run proxy
    # In a second terminal:
    npm run web

Open Markets in the app navigation. The local S Coin proxy remains GET-only
and binds to loopback.

### Native Android/iOS development

The native MetaMask Connect adapter uses Linking, the required Metro shims,
and the random-values polyfill. Build a native development app rather than
assuming a browser export tests a native wallet session:

    cd client
    npm ci
    npx expo prebuild
    npx expo run:android
    # iOS requires macOS:
    npx expo run:ios

Set the official app URL and production-quality RPC URLs before distributing
a build. Keplr is still browser-only: native Cosmos WalletConnect pairing has
not yet been added.

### Quote service

Run node server/swap-api/server.mjs from the repository root after setting
the service environment variables in the hosting environment. Use
server/swap-api/.env.example as a template; never commit a populated .env.

Required settings:
- ZEROX_API_KEY: server-only 0x key.
- SWAP_ALLOWED_EVM_CHAIN_IDS: numeric EVM chain IDs explicitly enabled.
- SWAP_ALLOWED_TOKENS_JSON: per-chain token contract allowlist.
- SWAP_ALLOWED_COSMOS_CHAIN_IDS: Cosmos chain IDs enabled for Skip previews.
- SWAP_API_ALLOWED_ORIGINS: exact browser origin allowlist.
- SWAP_API_RATE_LIMIT: per-IP requests per minute.

CORS is not authentication. The built-in in-memory IP limiter is not a
production abuse-control boundary, especially across multiple replicas or
native clients. Do not expose this service to public users until it is behind
a real authentication/session gateway and distributed rate limiter/WAF with
HTTPS, monitoring and abuse controls.

## What is deliberately not enabled

- No S Coin-generated seed phrase, independent self-custody wallet, private
  key storage, seed backup, key export, or account recovery workflow.
- No S Coin Cosmos transaction signing, send/receive, fee calculation or
  transaction monitoring.
- No native Keplr/Cosmos mobile wallet pairing.
- Native EVM asset sending is limited to explicitly configured chain IDs
  (Sepolia only by default) and always requires the external wallet's explicit
  approval. This is not an independent S Coin self-custody wallet.
- ERC-20 token sends are supported only through an explicit external-wallet
  transfer prompt on configured EVM networks (Sepolia by default).
- EVM swap approval and signing are implemented through the connected external
  wallet only when both server and client chain/contract allowlists are enabled.
  The default configuration is off; this is not a production exchange launch.
- No Skip Go /msgs generation/signing/broadcast, cross-chain recovery or refund
  workflow. A route preview is not an IBC transaction.
- No production Binance account balances, user-data streams, orders, deposits,
  withdrawals, margin, futures, lending or custody. The separate Spot Testnet
  desk uses simulated accounts and orders only.
- No fiat, bank, mobile-money, payment, reserve-management, issuance or
  redemption rails.
- No supported S Coin-to-other-coin route. S Coin is not verified as a
  registered, supported asset with a production DEX pool/IBC route and
  executable liquidity.

## Swap execution requirements

An executable swap requires more than a route response:

1. Verify the connected wallet's chain ID and account against the exact quote.
2. Verify token contract, decimals, spender, transaction target, and chain
   against a trusted allowlist.
3. Check and cap existing token allowance. Any approval must be separately
   reviewed and confirmed by the wallet owner.
4. Simulate the transaction and estimate gas; enforce slippage, minimum output,
   price impact, expiry, maximum fees and token/chain restrictions.
5. Show final transaction details and ask the user to sign in their own
   wallet. S Coin must not collect a recovery phrase or wallet private key.
6. Track transaction receipts and provide safe failure, timeout and
   cross-chain recovery procedures. The app tracks native transfers, token
   approvals, ERC-20 sends and EVM swap receipts. Cross-chain recovery remains
   outside this release.

0x supports EVM quotes and transaction calldata on supported networks. Skip Go
can return routing information for supported Cosmos/IBC and EVM routes. Neither
provider creates liquidity or chain-registry support for S Coin. S Coin must
have a verified chain registration, token metadata, DEX pool or IBC route,
adequate liquidity, price-impact limits and independently reviewed support
before its native asset is offered as a swap route.

## Security, launch and Uganda compliance

Before customer funds or fiat rails are enabled:

1. Publish and verify the intended chain ID, trusted RPC/API endpoints,
   validator operators, explorer, network metadata, fee policy, native coin
   policy, genesis allocations, upgrade authority and incident response.
2. Complete an independent audit of chain, wallet, mobile app, APIs, signing,
   swaps, issuer, supply and monetary-policy components.
3. Add tested address validation, transaction simulation, phishing protection,
   hardware-wallet support, session expiration, backup/recovery and incident
   response.
4. Obtain written Ugandan legal advice for the actual model: exchange,
   brokerage, custody, transfer, stablecoin issuance, payment processing,
   consumer protection, AML/CFT and cross-border services are distinct
   activities. FIA registration must not be assumed to be a blanket licence.
5. Confirm current Bank of Uganda requirements for any fiat, mobile-money,
   bank-transfer or other regulated payment integration.
6. Keep the existing SQM issuer hard-disable flags and production launch
   blockers unchanged until there is formal approval and independent evidence.

## Official technical references

- Binance market-data-only REST and WebSocket:
  https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
  https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md
- MetaMask Connect EVM (including Expo/React Native):
  https://docs.metamask.io/metamask-connect/evm/
  https://docs.metamask.io/metamask-connect/evm/quickstart/react-native/
- 0x Swap API:
  https://docs.0x.org/api-reference/api-overview
- Skip Go route API:
  https://skmtc.dev/skip-mev/apis/skip-go-api/revisions/fd713a1d0418/docs/v2/fungible/route/post
- Cosmos chain registry:
  https://github.com/cosmos/chain-registry
- Keplr:
  https://docs.keplr.app/

## Remaining implementation work

1. Obtain the exact S Coin testnet chain ID and trusted RPC/REST endpoint; add
   its chain metadata to the Cosmos ecosystem registries.
2. Add native Cosmos signing, fee estimation, simulation and transaction
   monitoring using a maintained Cosmos wallet library.
3. Add native Keplr/Cosmos wallet pairing.
4. Complete an independent security audit and test end-to-end flows with
   dedicated testnet accounts before any production use.
5. Verify S Coin chain/provider support, liquidity and IBC routes before
   enabling its native asset for swaps.
6. Keep production Binance credentials, trading, deposits and withdrawals
   outside this integration until separate legal, operational and security
   approval exists. The isolated Spot Testnet desk is already implemented.


## Binance Spot Testnet trading desk

The Markets screen now includes an isolated Binance Spot Testnet panel. It
supports testnet account balances, signed MARKET/LIMIT order validation and
placement, open-order queries, cancellation and recent order history. All
requests are hard-pinned in the client module to
https://testnet.binance.vision. There is no production Binance API host,
withdrawal, margin or futures route in this integration.

Create an API key on the official Binance Spot Test Network website. Enter the
key and secret only in the local app. Android/iOS builds use Expo SecureStore;
web keeps them in memory for the current browser tab/session only. The app does
not send Binance credentials to the S Coin server. Use a dedicated testnet key
with read and Spot-trading permissions only. Revoke it at Binance Testnet if
you lose control of the device or browser. Browser secrets remain exposed to
malicious extensions or compromised page scripts, so use a trusted browser.

Official Testnet REST API root: https://testnet.binance.vision/api
Testnet API-key portal: https://testnet.binance.vision

## EVM swap execution gates

The client and quote service now contain a wallet-confirmed EVM swap path. It
checks quote freshness, chain, taker, sell/buy tokens, provider liquidity,
sell-token balance, token contracts, exact allowance, transaction target and
gas simulation. When token allowance is insufficient, the app requests a
separate approval for the exact sell amount. The user must approve that action
and the later swap separately in their external wallet.

Execution is disabled by default on both client and server. It should only be
considered after verifying (a) a chain supported by the 0x Swap API, (b) exact
sell and buy token contracts, (c) the 0x transaction/Settler entrypoint target,
and (d) the AllowanceHolder or Permit2 spender returned by the 0x quote. Never
approve Settler. 0x does not provide a Sepolia testnet swap venue; use Binance
Spot Testnet for simulated trading tests instead.

Server settings: SWAP_EVM_EXECUTION_ENABLED,
SWAP_ALLOWED_EVM_TRANSACTION_TARGETS_JSON, and
SWAP_ALLOWED_EVM_ALLOWANCE_TARGETS_JSON. Client settings:
EXPO_PUBLIC_EVM_SWAP_ENABLED, EXPO_PUBLIC_EVM_SWAP_CHAIN_IDS, and
EXPO_PUBLIC_EVM_SWAP_TARGETS_JSON. Keep these unset/off until independent
security review and explicit operational approval. The quote service must also
sit behind real session authentication and a production-grade distributed
limiter/WAF; CORS and an in-memory IP limiter are not authentication.


## Native S Coin transfers through Keplr (web)

The web client now contains a Keplr/CosmJS native S Coin send flow. It checks
that Keplr controls the displayed `scoin1` account, connects to a separate
CometBFT RPC endpoint, verifies the exact chain ID against the configured
value, reads the `uscoin` balance, simulates a bank `MsgSend`, calculates an
estimated fee from the configured gas price, and only then asks Keplr to sign
and broadcast the transaction. The client verifies the transaction result
and refreshes the displayed balance after confirmation.

This feature is deliberately **disabled by default**. Enable it only after the
chain operator supplies a verified RPC endpoint and the approved fee policy.
Configure:

- `EXPO_PUBLIC_SCOIN_COSMOS_SEND_ENABLED=true` only after explicit operator approval.
- `EXPO_PUBLIC_SCOIN_CHAIN_ID` with the exact live/test chain ID.
- `EXPO_PUBLIC_SCOIN_RPC_URL` with a trusted HTTPS CometBFT RPC endpoint.
- `EXPO_PUBLIC_SCOIN_GAS_PRICE` with the actual network fee price in the
  native fee denom, e.g. `0.025uscoin` only if the operator confirms that value.

The app does not invent a gas price, chain ID or RPC. On Android/iOS, Keplr
mobile session pairing has not been configured, so native S Coin transfers
remain unavailable in native builds. This path is not audited for production
funds and should first be tested against an operator-controlled test network.
