import test from "node:test";
import assert from "node:assert/strict";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  getBinanceTestnetAccount,
  validateBinanceTestnetOrder,
  placeBinanceTestnetOrder,
  getBinanceTestnetOpenOrders,
  cancelBinanceTestnetOrder,
  getBinanceTestnetBaseUrl,
} from "./binanceTestnet.ts";

const credentials = {
  apiKey: "TESTNET_API_KEY",
  apiSecret: "TESTNET_SECRET",
};

function mockResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function verifySignature(url) {
  const parsed = new URL(url);
  const signature = parsed.searchParams.get("signature");
  parsed.searchParams.delete("signature");
  const payload = parsed.searchParams.toString();
  const expected = bytesToHex(
    hmac(sha256, utf8ToBytes(credentials.apiSecret), utf8ToBytes(payload)),
  );
  assert.equal(signature, expected);
}

test("all signed requests are pinned to Binance Spot Testnet", () => {
  assert.equal(getBinanceTestnetBaseUrl(), "https://testnet.binance.vision");
});

test("reads Spot Testnet account balances with a verifiable HMAC signature", async () => {
  let seen;
  const account = await getBinanceTestnetAccount(credentials, async (url, init) => {
    seen = { url: String(url), init };
    return mockResponse({
      canTrade: true,
      canWithdraw: false,
      canDeposit: false,
      balances: [
        { asset: "USDT", free: "1000.00000000", locked: "0.00000000" },
        { asset: "BTC", free: "0.01", locked: "0" },
        { asset: "ZERO", free: "0", locked: "0" },
      ],
    });
  });
  assert.equal(account.canTrade, true);
  assert.equal(account.balances.length, 2);
  assert.equal(seen.init.headers["X-MBX-APIKEY"], credentials.apiKey);
  verifySignature(seen.url);
  assert.match(seen.url, /^https:\/\/testnet\.binance\.vision\/api\/v3\/account\?/);
});

test("validates a MARKET order using the non-executing test endpoint", async () => {
  let seen;
  const result = await validateBinanceTestnetOrder(
    { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "0.001" },
    credentials,
    async (url, init) => {
      seen = { url: String(url), init };
      return mockResponse({});
    },
  );
  assert.equal(result.accepted, true);
  assert.match(result.message, /No order has been placed/);
  assert.equal(seen.init.method, "POST");
  assert.match(seen.url, /\/api\/v3\/order\/test\?/);
  assert.match(seen.url, /type=MARKET/);
  assert.doesNotMatch(seen.url, /api\.binance\.com/);
  verifySignature(seen.url);
});

test("validates LIMIT order time-in-force and rejects malformed order values", async () => {
  let seen;
  await validateBinanceTestnetOrder(
    { symbol: "ETHUSDT", side: "SELL", type: "LIMIT", quantity: "0.1", price: "3500.50" },
    credentials,
    async (url) => {
      seen = String(url);
      return mockResponse({});
    },
  );
  assert.match(seen, /timeInForce=GTC/);
  assert.match(seen, /price=3500\.50/);
  await assert.rejects(
    validateBinanceTestnetOrder(
      { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0", price: "5" },
      credentials,
      async () => { throw new Error("must not call fetch"); },
    ),
    /Order quantity must be a positive decimal/,
  );
});

test("places a Spot Testnet order only through the fixed testnet endpoint", async () => {
  let seen;
  const order = await placeBinanceTestnetOrder(
    { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "0.001" },
    credentials,
    async (url, init) => {
      seen = { url: String(url), init };
      return mockResponse({
        symbol: "BTCUSDT",
        orderId: 12345,
        clientOrderId: "test-order",
        price: "0",
        origQty: "0.001",
        executedQty: "0.001",
        status: "FILLED",
        side: "BUY",
        type: "MARKET",
        transactTime: 1,
      });
    },
  );
  assert.equal(order.orderId, 12345);
  assert.equal(seen.init.method, "POST");
  assert.match(seen.url, /^https:\/\/testnet\.binance\.vision\/api\/v3\/order\?/);
  verifySignature(seen.url);
});

test("queries and cancels only Spot Testnet orders", async () => {
  let calls = [];
  const open = await getBinanceTestnetOpenOrders(
    "BTCUSDT",
    credentials,
    async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return mockResponse([{
        symbol: "BTCUSDT",
        orderId: 12345,
        price: "30000",
        origQty: "0.1",
        executedQty: "0",
        status: "NEW",
        side: "BUY",
        type: "LIMIT",
        time: 100,
      }]);
    },
  );
  assert.equal(open.length, 1);
  const cancelled = await cancelBinanceTestnetOrder(
    "BTCUSDT",
    12345,
    credentials,
    async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return mockResponse({
        symbol: "BTCUSDT",
        orderId: 12345,
        price: "30000",
        origQty: "0.1",
        executedQty: "0",
        status: "CANCELED",
        side: "BUY",
        type: "LIMIT",
        time: 100,
      });
    },
  );
  assert.equal(cancelled.status, "CANCELED");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[1].method, "DELETE");
  assert.ok(calls.every((call) => call.url.startsWith(getBinanceTestnetBaseUrl())));
  for (const call of calls) verifySignature(call.url);
});

test("does not call Binance for invalid symbols or unsafe order parameters", async () => {
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return mockResponse({});
  };
  await assert.rejects(
    validateBinanceTestnetOrder(
      { symbol: "BTC/USDT", side: "BUY", type: "MARKET", quantity: "1" },
      credentials,
      fetchImpl,
    ),
    /valid Binance Spot symbol/,
  );
  await assert.rejects(
    cancelBinanceTestnetOrder("BTCUSDT", -1, credentials, fetchImpl),
    /valid Binance Testnet order ID/,
  );
  assert.equal(requestCount, 0);
});
