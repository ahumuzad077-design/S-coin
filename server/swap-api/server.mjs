import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8788);
const MAX_BODY_BYTES = 16 * 1024;
const WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT = 30;
const ZEROX_BASE_URL = "https://api.0x.org";
const SKIP_BASE_URL = "https://api.skip.build";

function csv(value = "") {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function tokenAllowlist(value = "{}") {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("SWAP_ALLOWED_TOKENS_JSON must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SWAP_ALLOWED_TOKENS_JSON must be an object keyed by chain ID");
  }

  const result = new Map();
  for (const [chainId, tokens] of Object.entries(parsed)) {
    if (!/^\d+$/.test(chainId) || !Array.isArray(tokens)) {
      throw new Error("Token allowlist entries must map numeric EVM chain IDs to arrays");
    }
    const normalized = tokens.map((token) => {
      if (typeof token !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(token)) {
        throw new Error("Every allowlisted EVM token must be a valid address");
      }
      return token.toLowerCase();
    });
    result.set(chainId, new Set(normalized));
  }
  return result;
}


function addressAllowlist(value = "{}", name = "ADDRESS_ALLOWLIST_JSON") {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(name + " must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(name + " must be an object keyed by chain ID");
  }
  const result = new Map();
  for (const [chainId, addresses] of Object.entries(parsed)) {
    if (!/^\d+$/.test(chainId) || !Array.isArray(addresses)) {
      throw new Error(name + " entries must map numeric chain IDs to address arrays");
    }
    const normalized = addresses.map((address) => {
      if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        throw new Error(name + " contains an invalid EVM contract address");
      }
      return address.toLowerCase();
    });
    result.set(chainId, new Set(normalized));
  }
  return result;
}

export function validateEvmQuoteRequest(body, config) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object");
  }

  const chainId = String(body.chainId ?? "");
  if (!/^\d+$/.test(chainId) || !config.evmChainIds.has(chainId)) {
    throw new Error("This EVM chain is not enabled by the service");
  }

  const sellToken = String(body.sellToken ?? "");
  const buyToken = String(body.buyToken ?? "");
  const taker = String(body.taker ?? "");
  const sellAmount = String(body.sellAmount ?? "");
  const slippageBps = body.slippageBps === undefined ? 100 : Number(body.slippageBps);

  if (!/^0x[a-fA-F0-9]{40}$/.test(sellToken) || !/^0x[a-fA-F0-9]{40}$/.test(buyToken)) {
    throw new Error("Sell and buy token must be valid EVM contract addresses");
  }
  if (sellToken.toLowerCase() === buyToken.toLowerCase()) {
    throw new Error("Sell and buy token must be different");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(taker)) {
    throw new Error("Taker must be a valid EVM wallet address");
  }
  if (!/^[1-9]\d{0,77}$/.test(sellAmount)) {
    throw new Error("Sell amount must be a positive integer in token base units");
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) {
    throw new Error("Slippage must be between 1 and 500 basis points");
  }

  const allowedTokens = config.tokensByChain.get(chainId);
  if (!allowedTokens) {
    throw new Error("No token allowlist is configured for this EVM chain");
  }
  if (!allowedTokens.has(sellToken.toLowerCase()) || !allowedTokens.has(buyToken.toLowerCase())) {
    throw new Error("One or both tokens are not enabled for quotes on this chain");
  }

  return {
    chainId,
    sellToken,
    buyToken,
    taker,
    sellAmount,
    slippageBps,
  };
}

export function validateCosmosRouteRequest(body, config) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object");
  }

  const sourceAssetChainId = String(body.sourceAssetChainId ?? "");
  const destAssetChainId = String(body.destAssetChainId ?? "");
  const sourceAssetDenom = String(body.sourceAssetDenom ?? "");
  const destAssetDenom = String(body.destAssetDenom ?? "");
  const amountIn = String(body.amountIn ?? "");

  if (
    !config.cosmosChainIds.has(sourceAssetChainId) ||
    !config.cosmosChainIds.has(destAssetChainId)
  ) {
    throw new Error("One or both Cosmos networks are not enabled by the service");
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9/:._-]{0,127}$/.test(sourceAssetDenom) ||
    !/^[A-Za-z0-9][A-Za-z0-9/:._-]{0,127}$/.test(destAssetDenom)
  ) {
    throw new Error("Asset denominations contain unsupported characters");
  }
  if (!/^[1-9]\d{0,77}$/.test(amountIn)) {
    throw new Error("Amount must be a positive integer in token base units");
  }

  return {
    source_asset_chain_id: sourceAssetChainId,
    source_asset_denom: sourceAssetDenom,
    dest_asset_chain_id: destAssetChainId,
    dest_asset_denom: destAssetDenom,
    amount_in: amountIn,
    cumulative_affiliate_fee_bps: "0",
    allow_multi_tx: true,
  };
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const contentType = String(request.headers["content-type"] ?? "");
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Content-Type must be application/json");
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body must contain valid JSON");
  }
}

function pickEvmQuoteFields(payload) {
  const tx = payload?.transaction;
  if (
    typeof tx !== "object" ||
    tx === null ||
    typeof tx.to !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(tx.to) ||
    typeof tx.data !== "string" ||
    !/^0x(?:[a-fA-F0-9]{2})*$/.test(tx.data) ||
    typeof tx.value !== "string" ||
    !/^\d+$/.test(tx.value)
  ) {
    throw new Error("Swap provider returned an incomplete transaction quote");
  }

  return {
    chainId: payload.chainId,
    sellToken: payload.sellToken,
    buyToken: payload.buyToken,
    sellAmount: payload.sellAmount,
    taker: payload.taker,
    buyAmount: payload.buyAmount,
    minBuyAmount: payload.minBuyAmount,
    liquidityAvailable: payload.liquidityAvailable,
    allowanceTarget: payload.allowanceTarget,
    issues: payload.issues,
    fees: payload.fees,
    route: payload.route,
    transaction: {
      to: tx.to,
      data: tx.data,
      value: tx.value,
      ...(typeof tx.gas === "string" ? { gas: tx.gas } : {}),
      ...(typeof tx.gasPrice === "string" ? { gasPrice: tx.gasPrice } : {}),
      ...(typeof tx.maxFeePerGas === "string" ? { maxFeePerGas: tx.maxFeePerGas } : {}),
      ...(typeof tx.maxPriorityFeePerGas === "string"
        ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas }
        : {}),
    },
  };
}

export function createSwapApiServer(env = process.env, fetchImpl = fetch) {
  const configuredRateLimit = Number(env.SWAP_API_RATE_LIMIT ?? DEFAULT_RATE_LIMIT);
  const config = {
    zeroXApiKey: env.ZEROX_API_KEY ?? "",
    evmChainIds: new Set(csv(env.SWAP_ALLOWED_EVM_CHAIN_IDS)),
    cosmosChainIds: new Set(csv(env.SWAP_ALLOWED_COSMOS_CHAIN_IDS)),
    tokensByChain: tokenAllowlist(env.SWAP_ALLOWED_TOKENS_JSON ?? "{}"),
    swapExecutionEnabled: env.SWAP_EVM_EXECUTION_ENABLED === "true",
    transactionTargetsByChain: addressAllowlist(
      env.SWAP_ALLOWED_EVM_TRANSACTION_TARGETS_JSON ?? "{}",
      "SWAP_ALLOWED_EVM_TRANSACTION_TARGETS_JSON",
    ),
    allowanceTargetsByChain: addressAllowlist(
      env.SWAP_ALLOWED_EVM_ALLOWANCE_TARGETS_JSON ?? "{}",
      "SWAP_ALLOWED_EVM_ALLOWANCE_TARGETS_JSON",
    ),
    allowedOrigins: new Set(csv(env.SWAP_API_ALLOWED_ORIGINS)),
    rateLimit:
      Number.isInteger(configuredRateLimit) && configuredRateLimit > 0
        ? Math.min(configuredRateLimit, 1000)
        : DEFAULT_RATE_LIMIT,
  };

  const rateBuckets = new Map();
  const maxRateBuckets = 10_000;

  function isRateLimited(request) {
    // Use the socket address. Do not trust arbitrary X-Forwarded-For headers;
    // configure the reverse proxy to enforce its own client-IP rate limit.
    const ip = request.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const bucket = rateBuckets.get(ip);

    if (!bucket || now - bucket.start >= WINDOW_MS) {
      if (!bucket && rateBuckets.size >= maxRateBuckets) {
        for (const [key, value] of rateBuckets) {
          if (now - value.start >= WINDOW_MS) rateBuckets.delete(key);
        }
        if (rateBuckets.size >= maxRateBuckets) return true;
      }
      rateBuckets.set(ip, { start: now, count: 1 });
      return false;
    }

    bucket.count += 1;
    return bucket.count > config.rateLimit;
  }

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.has(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      if (!origin || !config.allowedOrigins.has(origin)) {
        json(response, 403, { error: "Origin is not allowed" });
        return;
      }
      response.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      });
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/healthz") {
      json(response, 200, {
        status: "ok",
        evmQuoteEnabled: Boolean(config.zeroXApiKey && config.evmChainIds.size && config.tokensByChain.size),
        evmSwapExecutionConfigured: Boolean(
          config.swapExecutionEnabled &&
          config.evmChainIds.size > 0 &&
          config.tokensByChain.size > 0 &&
          [...config.transactionTargetsByChain.entries()].some(([chainId, targets]) =>
            config.evmChainIds.has(chainId) &&
            config.tokensByChain.has(chainId) &&
            targets.size > 0 &&
            (config.allowanceTargetsByChain.get(chainId)?.size ?? 0) > 0
          )
        ),
        cosmosRoutePreviewEnabled: config.cosmosChainIds.size > 0,
        transactionBroadcastEnabled: false,
      });
      return;
    }

    if (request.method !== "POST") {
      json(response, 405, { error: "Method not allowed" });
      return;
    }

    if (!url.pathname.startsWith("/v1/")) {
      json(response, 404, { error: "Route not found" });
      return;
    }

    if (origin && !config.allowedOrigins.has(origin)) {
      json(response, 403, { error: "Origin is not allowed" });
      return;
    }

    if (isRateLimited(request)) {
      json(response, 429, { error: "Rate limit exceeded" });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      json(response, 400, { error: error.message });
      return;
    }

    if (url.pathname === "/v1/evm/quote") {
      if (!config.zeroXApiKey) {
        json(response, 503, { error: "EVM swap quotes are not configured on this service" });
        return;
      }

      let quoteRequest;
      try {
        quoteRequest = validateEvmQuoteRequest(body, config);
      } catch (error) {
        json(response, 400, { error: error.message });
        return;
      }

      const query = new URLSearchParams({
        chainId: quoteRequest.chainId,
        sellToken: quoteRequest.sellToken,
        buyToken: quoteRequest.buyToken,
        sellAmount: quoteRequest.sellAmount,
        taker: quoteRequest.taker,
        slippageBps: String(quoteRequest.slippageBps),
      });

      try {
        const upstream = await fetchImpl(
          ZEROX_BASE_URL + "/swap/allowance-holder/quote?" + query.toString(),
          {
            headers: {
              Accept: "application/json",
              "0x-api-key": config.zeroXApiKey,
              "0x-version": "v2",
            },
            signal: AbortSignal.timeout(12_000),
          },
        );
        if (!upstream.ok) {
          json(response, 502, {
            error: "EVM liquidity provider did not return a usable quote",
            providerStatus: upstream.status,
          });
          return;
        }
        const upstreamPayload = await upstream.json();
        const pickedQuote = pickEvmQuoteFields(upstreamPayload);
        const transactionTargets = config.transactionTargetsByChain.get(quoteRequest.chainId);
        const allowanceTargets = config.allowanceTargetsByChain.get(quoteRequest.chainId);
        const allowanceTarget = String(
          pickedQuote.issues?.allowance?.spender ?? pickedQuote.allowanceTarget ?? "",
        ).toLowerCase();
        const executionEnabled = Boolean(
          config.swapExecutionEnabled &&
          transactionTargets?.has(pickedQuote.transaction.to.toLowerCase()) &&
          allowanceTargets?.has(allowanceTarget) &&
          pickedQuote.chainId !== undefined &&
          String(pickedQuote.chainId) === quoteRequest.chainId &&
          typeof pickedQuote.taker === "string" &&
          pickedQuote.taker.toLowerCase() === quoteRequest.taker.toLowerCase() &&
          pickedQuote.sellToken?.toLowerCase() === quoteRequest.sellToken.toLowerCase() &&
          pickedQuote.buyToken?.toLowerCase() === quoteRequest.buyToken.toLowerCase() &&
          pickedQuote.sellAmount === quoteRequest.sellAmount &&
          pickedQuote.liquidityAvailable === true &&
          pickedQuote.issues?.simulationIncomplete !== true &&
          (!pickedQuote.issues?.allowance?.spender ||
            !pickedQuote.allowanceTarget ||
            pickedQuote.issues.allowance.spender.toLowerCase() === pickedQuote.allowanceTarget.toLowerCase()) &&
          typeof pickedQuote.buyAmount === "string" &&
          /^[1-9]\d{0,77}$/.test(pickedQuote.buyAmount) &&
          typeof pickedQuote.minBuyAmount === "string" &&
          /^[1-9]\d{0,77}$/.test(pickedQuote.minBuyAmount) &&
          BigInt(pickedQuote.minBuyAmount) <= BigInt(pickedQuote.buyAmount)
        );
        json(response, 200, {
          provider: "0x",
          quote: pickedQuote,
          executionEnabled,
          notice: executionEnabled
            ? "Wallet execution is enabled only for this explicitly allowlisted chain, token pair and 0x contract set. The connected wallet must still approve."
            : "Quote preview only. Configure server execution, chain and contract allowlists before wallet execution can be enabled.",
        });
      } catch {
        json(response, 502, { error: "Could not obtain an EVM swap quote" });
      }
      return;
    }

    if (url.pathname === "/v1/cosmos/route-preview") {
      let routeRequest;
      try {
        routeRequest = validateCosmosRouteRequest(body, config);
      } catch (error) {
        json(response, 400, { error: error.message });
        return;
      }

      try {
        const upstream = await fetchImpl(SKIP_BASE_URL + "/v2/fungible/route", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(routeRequest),
          signal: AbortSignal.timeout(15_000),
        });
        if (!upstream.ok) {
          json(response, 502, {
            error: "Cosmos liquidity provider did not return a usable route",
            providerStatus: upstream.status,
          });
          return;
        }
        const route = await upstream.json();
        json(response, 200, {
          provider: "Skip Go",
          route,
          executionEnabled: false,
          notice: "Route preview only. No wallet messages have been generated or signed.",
        });
      } catch {
        json(response, 502, { error: "Could not obtain a Cosmos/IBC route preview" });
      }
      return;
    }

    json(response, 404, { error: "Route not found" });
  });

  return server;
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const server = createSwapApiServer();
  server.listen(PORT, "0.0.0.0", () => {
    process.stdout.write("S Coin quote service listening on port " + PORT + "\n");
  });
}
