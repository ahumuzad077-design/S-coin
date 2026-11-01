import test from "node:test";
import assert from "node:assert/strict";
import { requestEvmSwapQuote } from "./swapApi.ts";

const sellToken = "0x1111111111111111111111111111111111111111";
const buyToken = "0x2222222222222222222222222222222222222222";
const taker = "0x3333333333333333333333333333333333333333";
const settler = "0x4444444444444444444444444444444444444444";
const spender = "0x5555555555555555555555555555555555555555";

const request = {
  chainId: "1",
  sellToken,
  buyToken,
  sellAmount: "1000000000000000000",
  taker,
  slippageBps: 100,
};

function quote(overrides = {}) {
  return {
    chainId: 1,
    sellToken,
    buyToken,
    sellAmount: request.sellAmount,
    taker,
    buyAmount: "2000000000000000000",
    minBuyAmount: "1980000000000000000",
    liquidityAvailable: true,
    allowanceTarget: spender,
    issues: {
      simulationIncomplete: false,
      allowance: { spender, actual: "0", expected: request.sellAmount },
    },
    transaction: {
      to: settler,
      data: "0x12345678",
      value: "0",
    },
    ...overrides,
  };
}

function fetchWithPayload(payload) {
  return async (url, init) => {
    assert.equal(url, "https://quote.example/v1/evm/quote");
    assert.equal(init.method, "POST");
    assert.equal(JSON.parse(init.body).taker, taker);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

test("accepts a firm quote bound to the requested chain, tokens, amount and wallet", async () => {
  const response = await requestEvmSwapQuote(
    "https://quote.example",
    request,
    fetchWithPayload({
      provider: "0x",
      executionEnabled: false,
      notice: "Quote preview only",
      quote: quote(),
    }),
  );
  assert.equal(response.provider, "0x");
  assert.equal(response.quote.taker, taker);
  assert.equal(response.executionEnabled, false);
  assert.ok(typeof response.receivedAt === "number");
});

test("rejects a quote for a different wallet, token or amount", async () => {
  for (const payload of [
    { ...quote(), taker: "0x6666666666666666666666666666666666666666" },
    { ...quote(), sellToken: "0x6666666666666666666666666666666666666666" },
    { ...quote(), sellAmount: "2" },
    { ...quote(), chainId: 8453 },
  ]) {
    await assert.rejects(
      requestEvmSwapQuote(
        "https://quote.example",
        request,
        fetchWithPayload({
          provider: "0x",
          executionEnabled: false,
          notice: "Preview",
          quote: payload,
        }),
      ),
      /does not match this wallet request/,
    );
  }
});

test("rejects an unliquid quote and inconsistent minimum output", async () => {
  for (const payload of [
    { ...quote(), liquidityAvailable: false },
    { ...quote(), minBuyAmount: "2000000000000000001" },
  ]) {
    await assert.rejects(
      requestEvmSwapQuote(
        "https://quote.example",
        request,
        fetchWithPayload({
          provider: "0x",
          executionEnabled: false,
          notice: "Preview",
          quote: payload,
        }),
      ),
      /does not match this wallet request/,
    );
  }
});

test("rejects invalid transaction targets, calldata and missing execution flag", async () => {
  for (const [payload, executionEnabled] of [
    [{ ...quote(), transaction: { to: "0x1234", data: "0x1234", value: "0" } }, false],
    [{ ...quote(), transaction: { to: settler, data: "0x1", value: "0" } }, false],
    [quote(), undefined],
  ]) {
    await assert.rejects(
      requestEvmSwapQuote(
        "https://quote.example",
        request,
        fetchWithPayload({
          provider: "0x",
          ...(executionEnabled === undefined ? {} : { executionEnabled }),
          notice: "Preview",
          quote: payload,
        }),
      ),
      /does not match this wallet request/,
    );
  }
});

test("rejects conflicting 0x allowance-target fields", async () => {
  await assert.rejects(
    requestEvmSwapQuote(
      "https://quote.example",
      request,
      fetchWithPayload({
        provider: "0x",
        executionEnabled: false,
        notice: "Preview",
        quote: {
          ...quote(),
          allowanceTarget: "0x6666666666666666666666666666666666666666",
        },
      }),
    ),
    /conflicting token allowance targets/,
  );
});

test("rejects an allowance target that is not an address", async () => {
  await assert.rejects(
    requestEvmSwapQuote(
      "https://quote.example",
      request,
      fetchWithPayload({
        provider: "0x",
        executionEnabled: false,
        notice: "Preview",
        quote: { ...quote(), allowanceTarget: "not-an-address" },
      }),
    ),
    /invalid token allowance target/,
  );
});
