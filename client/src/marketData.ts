export interface BinanceTicker {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
}

export type BinanceStreamStatus = "connecting" | "live" | "reconnecting";

interface BinanceExchangeSymbol {
  symbol?: unknown;
  baseAsset?: unknown;
  quoteAsset?: unknown;
  status?: unknown;
  isSpotTradingAllowed?: unknown;
}

interface BinanceStreamTicker {
  s?: unknown;
  c?: unknown;
  P?: unknown;
  q?: unknown;
  h?: unknown;
  l?: unknown;
}

const REST_BASE_URL = "https://data-api.binance.vision";
const STREAM_URL =
  "wss://data-stream.binance.vision/stream?streams=!ticker_1d@arr";
const requestTimeoutMs = 12_000;
const knownUsdtMarkets = new Map<string, { baseAsset: string; quoteAsset: string }>();

async function getJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("Binance market data returned HTTP " + response.status);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Binance market-data request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseStreamTicker(value: unknown): BinanceTicker | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as BinanceStreamTicker;

  if (
    typeof row.s !== "string" ||
    !row.s.endsWith("USDT") ||
    typeof row.c !== "string" ||
    typeof row.P !== "string" ||
    typeof row.q !== "string" ||
    typeof row.h !== "string" ||
    typeof row.l !== "string"
  ) {
    return null;
  }

  const metadata = knownUsdtMarkets.get(row.s);
  const ticker: BinanceTicker = {
    symbol: row.s,
    baseAsset: metadata?.baseAsset ?? row.s.slice(0, -4),
    quoteAsset: "USDT",
    lastPrice: row.c,
    priceChangePercent: row.P,
    quoteVolume: row.q,
    highPrice: row.h,
    lowPrice: row.l,
  };

  if (
    !Number.isFinite(Number(ticker.lastPrice)) ||
    !Number.isFinite(Number(ticker.priceChangePercent)) ||
    !Number.isFinite(Number(ticker.quoteVolume)) ||
    !Number.isFinite(Number(ticker.highPrice)) ||
    !Number.isFinite(Number(ticker.lowPrice)) ||
    Number(ticker.lastPrice) < 0 ||
    Number(ticker.quoteVolume) < 0
  ) {
    return null;
  }

  return ticker;
}

/**
 * Discovers all currently trading Binance Spot pairs quoted in USDT, then
 * fetches the full 24-hour ticker snapshot once. The screen ranks the result
 * by quote volume and supports searching the whole returned market set.
 *
 * Both endpoints are public market-data-only endpoints; no exchange key is
 * required and no user account/order data is accessed.
 */
export async function fetchBinanceTickers(): Promise<BinanceTicker[]> {
  const [exchangeInfo, tickerPayload] = await Promise.all([
    getJson<{ symbols?: BinanceExchangeSymbol[] }>(
      REST_BASE_URL + "/api/v3/exchangeInfo",
    ),
    getJson<unknown>(REST_BASE_URL + "/api/v3/ticker/24hr"),
  ]);

  if (!Array.isArray(exchangeInfo.symbols) || !Array.isArray(tickerPayload)) {
    throw new Error("Binance returned an invalid exchange or ticker response");
  }

  knownUsdtMarkets.clear();
  for (const entry of exchangeInfo.symbols) {
    if (
      typeof entry.symbol === "string" &&
      typeof entry.baseAsset === "string" &&
      entry.quoteAsset === "USDT" &&
      entry.status === "TRADING" &&
      entry.isSpotTradingAllowed !== false
    ) {
      knownUsdtMarkets.set(entry.symbol, {
        baseAsset: entry.baseAsset,
        quoteAsset: "USDT",
      });
    }
  }

  const tickers: BinanceTicker[] = [];
  for (const value of tickerPayload) {
    if (typeof value !== "object" || value === null) continue;
    const row = value as Record<string, unknown>;
    if (typeof row.symbol !== "string") continue;

    const market = knownUsdtMarkets.get(row.symbol);
    if (!market) continue;

    const fields = [
      "lastPrice",
      "priceChangePercent",
      "quoteVolume",
      "highPrice",
      "lowPrice",
    ];
    if (fields.some((field) => typeof row[field] !== "string")) continue;

    const ticker: BinanceTicker = {
      symbol: row.symbol,
      baseAsset: market.baseAsset,
      quoteAsset: market.quoteAsset,
      lastPrice: row.lastPrice as string,
      priceChangePercent: row.priceChangePercent as string,
      quoteVolume: row.quoteVolume as string,
      highPrice: row.highPrice as string,
      lowPrice: row.lowPrice as string,
    };

    if (
      !Number.isFinite(Number(ticker.lastPrice)) ||
      !Number.isFinite(Number(ticker.priceChangePercent)) ||
      !Number.isFinite(Number(ticker.quoteVolume)) ||
      !Number.isFinite(Number(ticker.highPrice)) ||
      !Number.isFinite(Number(ticker.lowPrice)) ||
      Number(ticker.lastPrice) < 0 ||
      Number(ticker.quoteVolume) < 0
    ) {
      continue;
    }

    tickers.push(ticker);
  }

  if (tickers.length === 0) {
    throw new Error("Binance returned no active USDT-quoted Spot markets");
  }

  return tickers.sort(
    (left, right) =>
      Number(right.quoteVolume) - Number(left.quoteVolume),
  );
}

export function formatMarketPrice(value: string): string {
  const price = Number(value);
  if (!Number.isFinite(price)) return "—";

  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: price >= 1 ? 2 : 8,
  });
}

export function formatMarketPercent(value: string): string {
  const change = Number(value);
  if (!Number.isFinite(change)) return "—";
  return (change > 0 ? "+" : "") + change.toFixed(2) + "%";
}

/**
 * Opens Binance's all-market 24-hour rolling ticker stream. Binance sends only
 * symbols whose rolling statistics changed; this client filters to USDT-quoted
 * Spot market symbols discovered via exchangeInfo.
 */
export function subscribeBinanceTickers(
  onTickers: (tickers: BinanceTicker[]) => void,
  onStatus: (status: BinanceStreamStatus) => void,
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let recycleTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  const latest = new Map<string, BinanceTicker>();

  const clearTimers = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (recycleTimer) clearTimeout(recycleTimer);
    reconnectTimer = null;
    recycleTimer = null;
  };

  const closeSocket = () => {
    if (!socket) return;
    const current = socket;
    socket = null;
    current.onopen = null;
    current.onmessage = null;
    current.onerror = null;
    current.onclose = null;
    try {
      current.close();
    } catch {
      // A closed or failed socket needs no further action.
    }
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    onStatus("reconnecting");
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempt, 5));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) return;
    onStatus(reconnectAttempt === 0 ? "connecting" : "reconnecting");

    try {
      const nextSocket = new WebSocket(STREAM_URL);
      socket = nextSocket;

      nextSocket.onopen = () => {
        if (stopped || socket !== nextSocket) return;
        reconnectAttempt = 0;
        onStatus("live");

        // Binance WebSocket connections have a 24-hour lifetime.
        recycleTimer = setTimeout(() => {
          if (socket !== nextSocket) return;
          closeSocket();
          scheduleReconnect();
        }, 23 * 60 * 60 * 1000);
      };

      nextSocket.onmessage = (event) => {
        if (stopped || socket !== nextSocket) return;
        try {
          const parsed: unknown = JSON.parse(String(event.data));
          if (typeof parsed !== "object" || parsed === null) return;
          const envelope = parsed as { data?: unknown };
          const payload = envelope.data ?? parsed;
          const rows = Array.isArray(payload) ? payload : [payload];
          const updated: BinanceTicker[] = [];

          for (const row of rows) {
            const ticker = parseStreamTicker(row);
            if (!ticker) continue;
            latest.set(ticker.symbol, ticker);
            updated.push(ticker);
          }

          if (updated.length > 0) {
            onTickers(updated);
          }
        } catch {
          // Ignore malformed messages; the REST snapshot remains available.
        }
      };

      nextSocket.onerror = () => {
        if (stopped || socket !== nextSocket) return;
        closeSocket();
        scheduleReconnect();
      };

      nextSocket.onclose = () => {
        if (stopped || socket !== nextSocket) return;
        socket = null;
        clearTimers();
        scheduleReconnect();
      };
    } catch {
      scheduleReconnect();
    }
  };

  connect();

  return () => {
    stopped = true;
    clearTimers();
    closeSocket();
  };
}


export interface BinanceOrderBookLevel {
  price: string;
  quantity: string;
}

export interface BinanceRecentTrade {
  id: number;
  price: string;
  quantity: string;
  time: number;
  buyerIsMaker: boolean;
}

export interface BinanceCandle {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface BinanceMarketDetails {
  bids: BinanceOrderBookLevel[];
  asks: BinanceOrderBookLevel[];
  trades: BinanceRecentTrade[];
  candles: BinanceCandle[];
}

/**
 * Loads a compact, read-only technical snapshot for one verified USDT market.
 * Depth, recent trades and candles use public Binance REST endpoints only.
 */
export async function fetchBinanceMarketDetails(
  symbol: string,
): Promise<BinanceMarketDetails> {
  if (!knownUsdtMarkets.has(symbol)) {
    throw new Error("Select a currently trading Binance USDT Spot pair first.");
  }

  const query = "symbol=" + encodeURIComponent(symbol);
  const [depth, candlePayload, tradePayload] = await Promise.all([
    getJson<{ bids?: unknown[]; asks?: unknown[] }>(
      REST_BASE_URL + "/api/v3/depth?" + query + "&limit=20",
    ),
    getJson<unknown>(
      REST_BASE_URL + "/api/v3/klines?" + query + "&interval=1h&limit=24",
    ),
    getJson<unknown>(
      REST_BASE_URL + "/api/v3/trades?" + query + "&limit=10",
    ),
  ]);

  const parseLevels = (rows: unknown[] | undefined): BinanceOrderBookLevel[] => {
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 10).flatMap((row) => {
      if (
        !Array.isArray(row) ||
        typeof row[0] !== "string" ||
        typeof row[1] !== "string" ||
        !Number.isFinite(Number(row[0])) ||
        !Number.isFinite(Number(row[1]))
      ) {
        return [];
      }
      return [{ price: row[0], quantity: row[1] }];
    });
  };

  if (!Array.isArray(candlePayload) || !Array.isArray(tradePayload)) {
    throw new Error("Binance returned incomplete market detail data");
  }

  const candles: BinanceCandle[] = candlePayload.flatMap((row) => {
    if (
      !Array.isArray(row) ||
      typeof row[0] !== "number" ||
      typeof row[1] !== "string" ||
      typeof row[2] !== "string" ||
      typeof row[3] !== "string" ||
      typeof row[4] !== "string" ||
      typeof row[5] !== "string"
    ) {
      return [];
    }
    if (
      !Number.isFinite(Number(row[1])) ||
      !Number.isFinite(Number(row[2])) ||
      !Number.isFinite(Number(row[3])) ||
      !Number.isFinite(Number(row[4])) ||
      !Number.isFinite(Number(row[5]))
    ) {
      return [];
    }
    return [{
      openTime: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4],
      volume: row[5],
    }];
  });

  const trades: BinanceRecentTrade[] = tradePayload.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const trade = row as Record<string, unknown>;
    if (
      typeof trade.id !== "number" ||
      typeof trade.price !== "string" ||
      typeof trade.qty !== "string" ||
      typeof trade.time !== "number" ||
      typeof trade.isBuyerMaker !== "boolean" ||
      !Number.isFinite(Number(trade.price)) ||
      !Number.isFinite(Number(trade.qty))
    ) {
      return [];
    }
    return [{
      id: trade.id,
      price: trade.price,
      quantity: trade.qty,
      time: trade.time,
      buyerIsMaker: trade.isBuyerMaker,
    }];
  });

  return {
    bids: parseLevels(depth.bids),
    asks: parseLevels(depth.asks),
    trades,
    candles,
  };
}
