# S Coin wallet, market and exchange integration

Status: first-stage interface and read-only integrations. This document is an
implementation boundary, not a claim that S Coin is a live exchange or a
launched public chain.

## What this integration adds

- Binance Spot public market watch for selected USDT pairs, with a 15-second
  refresh interval. The market-data-only domain does not require an API key.
- Browser-injected EIP-1193 wallet connection for MetaMask and compatible EVM
  wallets. It requests public account access and network ID only.
- Browser Keplr connection for the native Cosmos SDK S Coin chain. The chain
  must already be configured in Keplr with trusted RPC/REST endpoints.
- A conversion preview based on public Binance prices. It is explicitly not
  an executable quote or a trade.
- A mobile/web exchange hub inside the existing Expo client.

## Architecture that must remain clear

S Coin is a Cosmos SDK / CometBFT chain with the scoin Bech32 address prefix.
MetaMask is an EVM wallet; it cannot sign native Cosmos SDK S Coin transactions
unless the chain is separately made EVM-compatible or an audited bridge/account
abstraction layer is introduced. Keplr is the native Cosmos wallet connection.

The current S Coin codebase is a development/testnet scaffold. It does not
identify a public production RPC, launch mainnet, or define an approved native
supply policy. The app does not generate/import seed phrases, store private
keys, sign transactions, or submit transfers.

## Binance integration boundary

The initial market screen uses:
- https://developers.binance.com/docs/binance-spot-api-docs
- https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
- https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md

Public market data is distinct from authenticated account, order placement,
cancellation, wallet, deposit, or withdrawal operations. Do not put Binance
API secrets in Expo environment variables, browser code, mobile bundles,
GitHub, or client storage. Any later private Binance connection needs a
server-side signing service, encrypted secret storage, per-user authentication,
strict key permissions, audit logs, rate limits, and withdrawal permissions
disabled by default. Start with Binance Spot Testnet; do not place live orders
from a first-stage wallet UI.

## Swap / crypto-to-crypto boundary

An indicative conversion is not a swap. An executable swap needs a firm quote,
route validation, token/chain allow-lists, allowance checks, slippage and price
impact limits, gas estimation, transaction simulation where supported,
user confirmation, wallet signing, receipt tracking, and failure/reversal
handling.

For EVM chains, a DEX aggregator such as 0x can provide executable quotes and
transaction calldata for supported networks. Its API key must be held by a
server-side API, never in the app bundle. A user wallet must review and sign
the returned transaction. This does not make the native S Coin Cosmos asset
swappable: S Coin needs a supported DEX pool or verified IBC/cross-chain route,
a token listing, liquidity, and a production chain endpoint first.

Official references:
- https://docs.0x.org/api-reference/api-overview
- https://docs.0x.org/docs/introduction/quickstart/swap-tokens-with-0x-swap-api
- https://docs.metamask.io/metamask-connect/
- https://docs.cosmos.network/
- https://docs.keplr.app/

## Production/legal/security gates

Before real customer funds or fiat rails are supported:
1. Define the public chain ID, trusted RPC/API endpoints, validator operations,
   native coin policy, token metadata and audited upgrade process.
2. Complete an independent wallet/app/chain security review. Add tested
   transaction simulation, address validation, chain ID checks, phishing
   protection, hardware-wallet support, and incident response.
3. Obtain written Ugandan legal advice on the applicable virtual-asset,
   AML/CFT, custody, transfer, consumer-protection and payment-services duties.
   The FIA published a February 2026 notice requiring VASPs to register as
   accountable persons following the relevant Anti-Money Laundering Act
   schedule amendment. AML registration should not be assumed to replace any
   other licence or approval that applies to the business model.
4. Treat fiat deposits, withdrawals, mobile money, bank transfers, custody and
   exchange execution as separate regulated integrations. The National
   Payment Systems Act requires a Bank of Uganda licence for covered payment
   services, payment systems and payment instruments.
5. Keep the existing SQM issuer hard-disable flags and production launch
   blockers unchanged. Wallet and market interfaces do not approve issuance,
   redemption, bank reserves, or monetary policy.

Ugandan references:
- https://fia.go.ug/amendment-of-the-second-schedule-to-the-anti-money-laundering-act-cap-118/
- https://ulii.org/en/akn/ug/act/2013/12/eng%402025-02-14
- https://ulii.org/en/akn/ug/act/2020/15/eng%402023-12-31
- https://fia.go.ug/virtual-assets-vas-and-virtual-asset-service-providers-vasps-ml-tf-national-risk-assessment-report-2025/

## Next implementation stages

1. Confirm the production/testnet S Coin chain ID and trusted public RPC/API.
2. Add native Cosmos transaction signing through a maintained wallet SDK, with
   Keplr first; include send/receive only after address, fee and simulation
   handling is tested.
3. Add a native mobile wallet session (MetaMask Connect / WalletConnect) and
   Cosmos mobile wallet pairing. The current connector intentionally covers
   browser-injected providers only.
4. Deploy a protected server-side swap adapter. Add 0x for approved EVM pairs
   and a Cosmos/IBC aggregator only after S Coin has a valid route and liquidity.
5. Add authenticated Binance account/order integration only if needed, using
   user-owned restricted API keys or a properly isolated server-side broker
   model. Use testnet for validation first.
