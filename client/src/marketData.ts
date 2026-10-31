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
