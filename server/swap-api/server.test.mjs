import test from "node:test";
import assert from "node:assert/strict";
import {
  createSwapApiServer,
  validateCosmosRouteRequest,
  validateEvmQuoteRequest,
} from "./server.mjs";

const tokenA = "0x1111111111111111111111111111111111111111";
const tokenB = "0x2222222222222222222222222222222222222222";
const taker = "0x3333333333333333333333333333333333333333";

function config() {
  return {
    evmChainIds: new Set(["1"]),
    cosmosChainIds: new Set(["osmosis-1", "cosmoshub-4"]),
    tokensByChain: new Map([["1", new Set([tokenA, tokenB])]]),
  };
}

test("accepts an allowlisted EVM quote request", () => {
  const result = validateEvmQuoteRequest(
    {
      chainId: "1",
      sellToken: tokenA,
      buyToken: tokenB,
      taker,
      sellAmount: "1000000",
    },
    config(),
  );
  assert.equal(result.chainId, "1");
  assert.equal(result.slippageBps, 100);
});

test("rejects an EVM chain that is not enabled", () => {
  assert.throws(
    () =>
      validateEvmQuoteRequest(
        {
          chainId: "8453",
          sellToken: tokenA,
          buyToken: tokenB,
          taker,
          sellAmount: "1000000",
        },
        config(),
      ),
    /not enabled/,
  );
});

test("rejects tokens outside the per-chain allowlist", () => {
  assert.throws(
    () =>
      validateEvmQuoteRequest(
        {
          chainId: "1",
          sellToken: tokenA,
          buyToken: "0x4444444444444444444444444444444444444444",
          taker,
          sellAmount: "1000000",
        },
        config(),
      ),
    /not enabled/,
  );
});

test("rejects zero, decimal or oversized EVM base-unit amounts", () => {
  for (const sellAmount of ["0", "1.5", "-1", "9".repeat(80)]) {
    assert.throws(() =>
      validateEvmQuoteRequest(
        { chainId: "1", sellToken: tokenA, buyToken: tokenB, taker, sellAmount },
        config(),
      ),
    );
  }
});

test("accepts a configured Cosmos route preview", () => {
  const result = validateCosmosRouteRequest(
    {
      sourceAssetChainId: "osmosis-1",
      sourceAssetDenom: "uosmo",
      destAssetChainId: "cosmoshub-4",
      destAssetDenom: "uatom",
      amountIn: "1000000",
    },
    config(),
  );
  assert.equal(result.amount_in, "1000000");
  assert.equal(result.cumulative_affiliate_fee_bps, "0");
  assert.equal(result.allow_multi_tx, true);
});

test("rejects Cosmos routes for unconfigured chains", () => {
  assert.throws(
    () =>
      validateCosmosRouteRequest(
        {
          sourceAssetChainId: "scoin-testnet-1",
          sourceAssetDenom: "uscoin",
          destAssetChainId: "osmosis-1",
          destAssetDenom: "uosmo",
          amountIn: "1000000",
        },
        config(),
      ),
    /not enabled/,
  );
});

test("health never reports transaction broadcast as enabled", async () => {
  const server = createSwapApiServer(
    {
      PORT: "0",
      ZEROX_API_KEY: "test-key",
      SWAP_ALLOWED_EVM_CHAIN_IDS: "1",
      SWAP_ALLOWED_TOKENS_JSON: JSON.stringify({ "1": [tokenA, tokenB] }),
      SWAP_ALLOWED_COSMOS_CHAIN_IDS: "osmosis-1",
    },
    async () => {
      throw new Error("network should not be called");
    },
  );

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const response = await fetch("http://127.0.0.1:" + address.port + "/healthz");
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.evmQuoteEnabled, true);
    assert.equal(payload.cosmosRoutePreviewEnabled, true);
    assert.equal(payload.transactionBroadcastEnabled, false);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

const settler = "0x4444444444444444444444444444444444444444";
const allowanceHolder = "0x5555555555555555555555555555555555555555";

function mock0xQuote(overrides = {}) {
  return {
    chainId: 1,
    sellToken: tokenA,
    buyToken: tokenB,
    sellAmount: "1000000",
    taker,
    buyAmount: "2000000",
    minBuyAmount: "1980000",
    liquidityAvailable: true,
    allowanceTarget: allowanceHolder,
    issues: { allowance: { spender: allowanceHolder, actual: "0", expected: "1000000" } },
    transaction: { to: settler, data: "0x12345678", value: "0" },
    ...overrides,
  };
}

async function runQuoteServer(env, upstreamPayload) {
  const server = createSwapApiServer(env, async () => ({
    ok: true,
    status: 200,
    json: async () => upstreamPayload,
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    request: () => fetch("http://127.0.0.1:" + address.port + "/v1/evm/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chainId: "1",
        sellToken: tokenA,
        buyToken: tokenB,
        sellAmount: "1000000",
        taker,
        slippageBps: 100,
      }),
    }),
  };
}

test("EVM swap execution remains off by default even with a valid firm quote", async () => {
  const { server, request } = await runQuoteServer({
    PORT: "0",
    ZEROX_API_KEY: "test-key",
    SWAP_ALLOWED_EVM_CHAIN_IDS: "1",
    SWAP_ALLOWED_TOKENS_JSON: JSON.stringify({ "1": [tokenA, tokenB] }),
  }, mock0xQuote());
  try {
    const response = await request();
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.executionEnabled, false);
    assert.match(payload.notice, /Quote preview only/);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("execution requires matching server switch and both per-chain contract allowlists", async () => {
  const env = {
    PORT: "0",
    ZEROX_API_KEY: "test-key",
    SWAP_ALLOWED_EVM_CHAIN_IDS: "1",
    SWAP_ALLOWED_TOKENS_JSON: JSON.stringify({ "1": [tokenA, tokenB] }),
    SWAP_EVM_EXECUTION_ENABLED: "true",
    SWAP_ALLOWED_EVM_TRANSACTION_TARGETS_JSON: JSON.stringify({ "1": [settler] }),
    SWAP_ALLOWED_EVM_ALLOWANCE_TARGETS_JSON: JSON.stringify({ "1": [allowanceHolder] }),
  };
  const { server, request } = await runQuoteServer(env, mock0xQuote());
  try {
    const response = await request();
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.executionEnabled, true);
    assert.equal(payload.quote.transaction.to, settler);
    assert.equal(payload.quote.issues.allowance.spender, allowanceHolder);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("execution remains off when the provider returns a transaction target outside the allowlist", async () => {
  const env = {
    PORT: "0",
    ZEROX_API_KEY: "test-key",
    SWAP_ALLOWED_EVM_CHAIN_IDS: "1",
    SWAP_ALLOWED_TOKENS_JSON: JSON.stringify({ "1": [tokenA, tokenB] }),
    SWAP_EVM_EXECUTION_ENABLED: "true",
    SWAP_ALLOWED_EVM_TRANSACTION_TARGETS_JSON: JSON.stringify({ "1": [tokenA] }),
    SWAP_ALLOWED_EVM_ALLOWANCE_TARGETS_JSON: JSON.stringify({ "1": [allowanceHolder] }),
  };
  const { server, request } = await runQuoteServer(env, mock0xQuote());
  try {
    const response = await request();
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.executionEnabled, false);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("execution remains off when the provider quote does not match the taker", async () => {
  const env = {
    PORT: "0",
    ZEROX_API_KEY: "test-key",
    SWAP_ALLOWED_EVM_CHAIN_IDS: "1",
    SWAP_ALLOWED_TOKENS_JSON: JSON.stringify({ "1": [tokenA, tokenB] }),
    SWAP_EVM_EXECUTION_ENABLED: "true",
    SWAP_ALLOWED_EVM_TRANSACTION_TARGETS_JSON: JSON.stringify({ "1": [settler] }),
    SWAP_ALLOWED_EVM_ALLOWANCE_TARGETS_JSON: JSON.stringify({ "1": [allowanceHolder] }),
  };
  const { server, request } = await runQuoteServer(env, mock0xQuote({
    taker: "0x6666666666666666666666666666666666666666",
  }));
  try {
    const response = await request();
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.executionEnabled, false);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("contract allowlist rejects invalid chain keys", () => {
  assert.throws(
    () => createSwapApiServer({
      SWAP_ALLOWED_EVM_TRANSACTION_TARGETS_JSON: JSON.stringify({ "not-a-chain": [settler] }),
    }),
    /numeric chain IDs/,
  );
});
