export interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
}

const marketSymbols = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "TRXUSDT",
  "LINKUSDT",
  "AVAXUSDT",
  "LTCUSDT",
  "BCHUSDT",
  "DOTUSDT",
  "UNIUSDT",
  "NEARUSDT",
  "SUIUSDT",
  "TONUSDT",
  "ATOMUSDT",
  "XLMUSDT",
  "ETCUSDT",
  "SHIBUSDT",
  "AAVEUSDT",
  "FILUSDT",
  "APTUSDT",
  "ARBUSDT",
  "OPUSDT",
  "INJUSDT",
  "SEIUSDT",
  "USDCUSDT",
];

const marketDataBaseUrl = "https://data-api.binance.vision";
const requestTimeoutMs = 8000;

/**
 * Reads public Binance Spot market data only.
 * This endpoint does not need an API key and cannot access or trade user funds.
 */
export async function fetchBinanceTickers(): Promise<BinanceTicker[]> {
  const symbols = encodeURIComponent(JSON.stringify(marketSymbols));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(
      marketDataBaseUrl + "/api/v3/ticker/24hr?symbols=" + symbols,
      {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error("Binance market data returned HTTP " + response.status);
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Binance returned an invalid market-data response");
    }

    const tickers = payload.map((value: unknown): BinanceTicker => {
      if (typeof value !== "object" || value === null) {
        throw new Error("Binance returned an invalid ticker");
      }

      const row = value as Record<string, unknown>;
      const required = [
        "symbol",
        "lastPrice",
        "priceChangePercent",
        "quoteVolume",
        "highPrice",
        "lowPrice",
      ];

      for (const field of required) {
        if (typeof row[field] !== "string") {
          throw new Error("Binance ticker is missing " + field);
        }
      }

      const ticker: BinanceTicker = {
        symbol: row.symbol as string,
        lastPrice: row.lastPrice as string,
        priceChangePercent: row.priceChangePercent as string,
        quoteVolume: row.quoteVolume as string,
        highPrice: row.highPrice as string,
        lowPrice: row.lowPrice as string,
      };

      if (
        !/^[A-Z0-9]{3,20}$/.test(ticker.symbol) ||
        !Number.isFinite(Number(ticker.lastPrice)) ||
        !Number.isFinite(Number(ticker.priceChangePercent)) ||
        !Number.isFinite(Number(ticker.quoteVolume)) ||
        Number(ticker.lastPrice) < 0
      ) {
        throw new Error("Binance returned an invalid ticker value");
      }

      return ticker;
    });

    return tickers.sort(
      (left, right) =>
        Number(right.quoteVolume) - Number(left.quoteVolume),
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Binance market-data request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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


export type BinanceStreamStatus = "connecting" | "live" | "reconnecting";

interface BinanceStreamTicker {
  s?: unknown;
  c?: unknown;
  P?: unknown;
  q?: unknown;
  h?: unknown;
  l?: unknown;
}

/**
 * Opens an official public Binance market-data WebSocket stream.
 * This stream is read-only and never authenticates or touches exchange accounts.
 * A single connection is intentionally recycled before Binance's 24-hour limit.
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
  const streams = marketSymbols.map((symbol) => symbol.toLowerCase() + "@ticker");
  const streamUrl =
    "wss://data-stream.binance.vision/stream?streams=" +
    streams.join("/");

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
      const nextSocket = new WebSocket(streamUrl);
      socket = nextSocket;

      nextSocket.onopen = () => {
        if (stopped || socket !== nextSocket) return;
        reconnectAttempt = 0;
        onStatus("live");

        // Binance stream connections are limited to 24 hours.
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
          const payload = (envelope.data ?? parsed) as unknown;
          if (typeof payload !== "object" || payload === null) return;

          const row = payload as BinanceStreamTicker;
          if (
            typeof row.s !== "string" ||
            typeof row.c !== "string" ||
            typeof row.P !== "string" ||
            typeof row.q !== "string" ||
            typeof row.h !== "string" ||
            typeof row.l !== "string"
          ) {
            return;
          }

          const ticker: BinanceTicker = {
            symbol: row.s,
            lastPrice: row.c,
            priceChangePercent: row.P,
            quoteVolume: row.q,
            highPrice: row.h,
            lowPrice: row.l,
          };

          if (
            !marketSymbols.includes(ticker.symbol) ||
            !Number.isFinite(Number(ticker.lastPrice)) ||
            !Number.isFinite(Number(ticker.priceChangePercent)) ||
            !Number.isFinite(Number(ticker.quoteVolume)) ||
            !Number.isFinite(Number(ticker.highPrice)) ||
            !Number.isFinite(Number(ticker.lowPrice))
          ) {
            return;
          }

          latest.set(ticker.symbol, ticker);
          onTickers(
            Array.from(latest.values()).sort(
              (left, right) =>
                Number(right.quoteVolume) - Number(left.quoteVolume),
            ),
          );
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
