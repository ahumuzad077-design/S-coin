import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { BinanceTestnetCredentials } from "./binanceCredentialStore";

const TESTNET_BASE_URL = "https://testnet.binance.vision";
const RECV_WINDOW = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface BinanceTestnetBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceTestnetAccount {
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  balances: BinanceTestnetBalance[];
}

export interface BinanceTestnetOrderRequest {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: string;
  price?: string;
}

export interface BinanceTestnetOrder {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  side: string;
  type: string;
  transactTime?: number;
  updateTime?: number;
}

export interface BinanceTestnetOpenOrder {
  symbol: string;
  orderId: number;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  side: string;
  type: string;
  time: number;
}

export interface BinanceTestnetOrderResult {
  accepted: boolean;
  order?: BinanceTestnetOrder;
  message: string;
}

export type BinanceFetch = typeof fetch;

function assertSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(normalized)) {
    throw new Error("Enter a valid Binance Spot symbol, such as BTCUSDT.");
  }
  return normalized;
}

function assertPositiveDecimal(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d{0,30})(?:\.\d{1,18})?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error(label + " must be a positive decimal value.");
  }
  return normalized;
}

function buildSignedQuery(
  params: Record<string, string | number | boolean | undefined>,
  credentials: BinanceTestnetCredentials,
  timestamp: number,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  query.set("recvWindow", String(RECV_WINDOW));
  query.set("timestamp", String(timestamp));
  const unsigned = query.toString();
  const signature = bytesToHex(
    hmac(sha256, utf8ToBytes(credentials.apiSecret), utf8ToBytes(unsigned)),
  );
  return unsigned + "&signature=" + signature;
}

async function requestBinance<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  params: Record<string, string | number | boolean | undefined> = {},
  options: {
    signed?: boolean;
    credentials?: BinanceTestnetCredentials;
    fetchImpl?: BinanceFetch;
  } = {},
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Cache-Control": "no-store",
  };
  let query = new URLSearchParams();
  let body: string | undefined;

  if (options.signed) {
    const credentials = options.credentials ?? await loadBinanceTestnetCredentials();
    if (!credentials) {
      throw new Error("Connect a Binance Spot Testnet API key before using testnet account features.");
    }
    headers["X-MBX-APIKEY"] = credentials.apiKey;
    query = new URLSearchParams(
      buildSignedQuery(params, credentials, Date.now()),
    );
  } else {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
  }

  const queryString = query.toString();
  const url = TESTNET_BASE_URL + path + (queryString ? "?" + queryString : "");
  if (method === "POST" || method === "DELETE") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = "";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      cache: "no-store",
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload: unknown = {};
    if (raw.trim()) {
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error("Binance Testnet returned an unreadable response.");
      }
    }
    if (!response.ok) {
      const error = payload as { code?: number; msg?: string };
      const message =
        typeof error.msg === "string"
          ? error.msg.slice(0, 240)
          : "Binance Testnet rejected the request.";
      throw new Error("Binance Testnet (" + response.status + "): " + message);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Binance Spot Testnet request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function getCredentials(explicit?: BinanceTestnetCredentials): BinanceTestnetCredentials {
  if (!explicit) {
    throw new Error("Connect a Binance Spot Testnet API key before using testnet account features.");
  }
  return explicit;
}

export async function getBinanceTestnetAccount(
  credentials?: BinanceTestnetCredentials,
  fetchImpl?: BinanceFetch,
): Promise<BinanceTestnetAccount> {
  const resolved = await getCredentials(credentials);
  if (!resolved) throw new Error("Connect a Binance Spot Testnet API key first.");
  const result = await requestBinance<BinanceTestnetAccount>(
    "/api/v3/account",
    "GET",
    {},
    { signed: true, credentials: resolved, fetchImpl },
  );
  if (!Array.isArray(result.balances) || typeof result.canTrade !== "boolean") {
    throw new Error("Binance Testnet returned an invalid account payload.");
  }
  return {
    ...result,
    balances: result.balances
      .filter((balance) =>
        typeof balance.asset === "string" &&
        /^\d+(?:\.\d+)?$/.test(balance.free) &&
        /^\d+(?:\.\d+)?$/.test(balance.locked),
      )
      .sort((left, right) => Number(right.free) + Number(right.locked) - Number(left.free) - Number(left.locked)),
  };
}

function normalizeOrder(request: BinanceTestnetOrderRequest) {
  const symbol = assertSymbol(request.symbol);
  const quantity = assertPositiveDecimal(request.quantity, "Order quantity");
  if (request.type === "MARKET") {
    return {
      symbol,
      side: request.side,
      type: "MARKET",
      quantity,
      newOrderRespType: "FULL",
    };
  }
  if (request.type === "LIMIT") {
    const price = assertPositiveDecimal(request.price ?? "", "Limit price");
    return {
      symbol,
      side: request.side,
      type: "LIMIT",
      timeInForce: "GTC",
      quantity,
      price,
      newOrderRespType: "FULL",
    };
  }
  throw new Error("Only MARKET and LIMIT Spot Testnet orders are supported.");
}

/**
 * Sends a signed validation request to the fixed Binance Spot Testnet
 * /order/test endpoint. It does not create an order.
 */
export async function validateBinanceTestnetOrder(
  request: BinanceTestnetOrderRequest,
  credentials?: BinanceTestnetCredentials,
  fetchImpl?: BinanceFetch,
): Promise<BinanceTestnetOrderResult> {
  const resolved = await getCredentials(credentials);
  if (!resolved) throw new Error("Connect a Binance Spot Testnet API key first.");
  const params = normalizeOrder(request);
  await requestBinance<unknown>(
    "/api/v3/order/test",
    "POST",
    params,
    { signed: true, credentials: resolved, fetchImpl },
  );
  return {
    accepted: true,
    message: "Binance Spot Testnet accepted the test order. No order has been placed yet.",
  };
}

/**
 * Places a simulated order on the isolated Binance Spot Test Network only.
 * No production endpoint is accepted by this module.
 */
export async function placeBinanceTestnetOrder(
  request: BinanceTestnetOrderRequest,
  credentials?: BinanceTestnetCredentials,
  fetchImpl?: BinanceFetch,
): Promise<BinanceTestnetOrder> {
  const resolved = await getCredentials(credentials);
  if (!resolved) throw new Error("Connect a Binance Spot Testnet API key first.");
  const params = normalizeOrder(request);
  const result = await requestBinance<BinanceTestnetOrder>(
    "/api/v3/order",
    "POST",
    params,
    { signed: true, credentials: resolved, fetchImpl },
  );
  if (
    typeof result.orderId !== "number" ||
    typeof result.symbol !== "string" ||
    typeof result.status !== "string"
  ) {
    throw new Error("Binance Testnet returned an invalid order response.");
  }
  return result;
}

export async function getBinanceTestnetOpenOrders(
  symbol?: string,
  credentials?: BinanceTestnetCredentials,
  fetchImpl?: BinanceFetch,
): Promise<BinanceTestnetOpenOrder[]> {
  const resolved = await getCredentials(credentials);
  if (!resolved) throw new Error("Connect a Binance Spot Testnet API key first.");
  const result = await requestBinance<BinanceTestnetOpenOrder[]>(
    "/api/v3/openOrders",
    "GET",
    symbol ? { symbol: assertSymbol(symbol) } : {},
    { signed: true, credentials: resolved, fetchImpl },
  );
  if (!Array.isArray(result)) throw new Error("Binance Testnet returned an invalid open order list.");
  return result;
}

export async function cancelBinanceTestnetOrder(
  symbol: string,
  orderId: number,
  credentials?: BinanceTestnetCredentials,
  fetchImpl?: BinanceFetch,
): Promise<BinanceTestnetOpenOrder> {
  const resolved = await getCredentials(credentials);
  if (!resolved) throw new Error("Connect a Binance Spot Testnet API key first.");
  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw new Error("Select a valid Binance Testnet order ID.");
  }
  return requestBinance<BinanceTestnetOpenOrder>(
    "/api/v3/order",
    "DELETE",
    { symbol: assertSymbol(symbol), orderId },
    { signed: true, credentials: resolved, fetchImpl },
  );
}


export async function getBinanceTestnetOrderHistory(
  symbol: string,
  credentials?: BinanceTestnetCredentials,
  fetchImpl?: BinanceFetch,
): Promise<BinanceTestnetOrder[]> {
  const resolved = await getCredentials(credentials);
  if (!resolved) throw new Error("Connect a Binance Spot Testnet API key first.");
  const result = await requestBinance<BinanceTestnetOrder[]>(
    "/api/v3/allOrders",
    "GET",
    { symbol: assertSymbol(symbol), limit: 20 },
    { signed: true, credentials: resolved, fetchImpl },
  );
  if (!Array.isArray(result)) {
    throw new Error("Binance Testnet returned an invalid order history.");
  }
  return result;
}

export function getBinanceTestnetBaseUrl(): string {
  return TESTNET_BASE_URL;
}
