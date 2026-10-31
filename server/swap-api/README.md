# S Coin quote service

This service provides **quote and route previews only**. It does not sign,
broadcast, custody, deposit, withdraw, or submit transactions.

## Run locally

Requires Node.js 22 or newer.

\`\`\`sh
cd server/swap-api
cp .env.example .env
node server.mjs
\`\`\`

Environment variables:

- \`PORT\`: listening port (default \`8788\`).
- \`ZEROX_API_KEY\`: server-only 0x API key. Never put this in Expo
  \`EXPO_PUBLIC_*\` variables or a mobile bundle.
- \`SWAP_ALLOWED_EVM_CHAIN_IDS\`: comma-separated EVM chain IDs.
- \`SWAP_ALLOWED_TOKENS_JSON\`: per-chain allowlist, e.g.
  \`{"1":["0x...","0x..."]}\`. A chain with no allowlisted token pair fails closed.
- \`SWAP_ALLOWED_COSMOS_CHAIN_IDS\`: comma-separated Cosmos chain IDs the
  operator has explicitly enabled for route preview. Do not add S Coin until
  the chain is registered with a route provider and its actual route/liquidity
  has been independently verified.
- \`SWAP_API_ALLOWED_ORIGINS\`: exact comma-separated browser origins permitted
  to call the service. Requests without an Origin header are accepted for
  server-to-server use; browser origins must match this allowlist.
- \`SWAP_API_RATE_LIMIT\`: requests per IP per minute (default 30).

## API

- \`GET /healthz\`: capability flags. Transaction broadcast is always false.
- \`POST /v1/evm/quote\`: server-side 0x AllowanceHolder quote using an
  allowlisted chain and token pair. Amounts are integer token base units.
- \`POST /v1/cosmos/route-preview\`: Skip Go route preview for explicitly
  allowlisted Cosmos chains. Amounts are integer denom base units.

The client must independently check the connected wallet's active chain and
account against the quote before presenting it. A quote is not a promise of
execution, guaranteed price, or liquidity. Wallet signing and broadcasting are
not implemented here. Do not expose a quote response as a guaranteed fill.

## Safety controls

- External API credentials remain on this server.
- Chain and token allowlists fail closed.
- Request bodies are size-limited; inputs are validated; rate limiting is
  enabled; responses use no-store caching.
- The server does not expose a generic URL proxy.
- 0x and Skip errors are not reflected verbatim to clients.
- No endpoints are provided to approve tokens, sign transactions, broadcast,
  or initiate withdrawals.
- Put this service behind HTTPS and an edge rate limiter/WAF in production.
  Configure exact CORS origins and secrets via the hosting platform's secret
  manager. Do not commit a populated \`.env\` file.


## Production access control

The built-in exact-origin CORS policy is a browser policy, not authentication.
Native clients and custom HTTP clients can omit the Origin header. Do not expose
this service publicly as a production quote proxy without placing it behind a
real user/session authentication gateway and a distributed rate limiter or
WAF. The in-memory socket-IP limiter is a local safety layer only; it is not
shared across replicas and must not be treated as a production abuse-control
boundary. Trust forwarded client IPs only when your hosting platform's reverse
proxy explicitly sanitizes and supplies those headers.
