import { Platform } from "react-native";

export interface MarketSecurity {
  symbol: string;
  name: string;
  sector: string;
  currency: string;
  currencyDecimals: number;
  lastPrice: number;
  referencePrice: number;
  changeBps: number;
  tickSize: number;
  status: string;
  synthetic: boolean;
}

export interface MarketBookLevel { price: number; quantity: number; orderCount: number; }
export interface MarketOrderBook { symbol: string; bids: MarketBookLevel[]; asks: MarketBookLevel[]; mode: string; }
export interface MarketPosition {
  symbol: string; name: string; quantity: number; reservedQuantity: number;
  availableQuantity: number; lastPrice: number; marketValue: number; currency: string;
}
export interface MarketPortfolio {
  accountId: string; currency: string; cashBalance: number; reservedCash: number;
  availableCash: number; marketValue: number; totalValue: number;
  positions: MarketPosition[]; mode: string;
}
export interface MarketOrder {
  id: string; accountId: string; symbol: string; side: "BUY" | "SELL"; type: string;
  quantity: number; filledQuantity: number; remainingQuantity: number; limitPrice: number;
  status: "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED";
  createdAt: string; updatedAt: string;
}
export interface MarketFill {
  tradeId: string; symbol: string; price: number; quantity: number; buyerAccount: string;
  sellerAccount: string; buyOrderId: string; sellOrderId: string;
  executedAt: string; simulationOnly: boolean;
}
export interface OrdersResponse { mode: string; orders: MarketOrder[]; fills: MarketFill[]; }
export interface PaperOrderResponse {
  mode: string; paperTrade: boolean; order: MarketOrder; fills: MarketFill[];
  portfolio: MarketPortfolio; warning: string;
}

export const marketApiUrl =
  process.env.EXPO_PUBLIC_MERIDIAN_API_URL ??
  (Platform.OS === "android" ? "http://10.0.2.2:8788" : "http://127.0.0.1:8788");

export const previewSecurities: MarketSecurity[] = [
  { symbol: "DENG", name: "Demo Energy Infrastructure Ltd", sector: "Energy infrastructure", currency: "UGX", currencyDecimals: 0, lastPrice: 125000, referencePrice: 123500, changeBps: 121, tickSize: 1, status: "OPEN", synthetic: true },
  { symbol: "DSOL", name: "Demo Solar Networks Ltd", sector: "Renewable energy", currency: "UGX", currencyDecimals: 0, lastPrice: 85000, referencePrice: 86000, changeBps: -116, tickSize: 1, status: "OPEN", synthetic: true },
  { symbol: "DLOG", name: "Demo Logistics Group Ltd", sector: "Logistics", currency: "UGX", currencyDecimals: 0, lastPrice: 62000, referencePrice: 61500, changeBps: 81, tickSize: 1, status: "OPEN", synthetic: true },
  { symbol: "DWAT", name: "Demo Water Systems Ltd", sector: "Water infrastructure", currency: "UGX", currencyDecimals: 0, lastPrice: 43000, referencePrice: 42000, changeBps: 238, tickSize: 1, status: "OPEN", synthetic: true },
  { symbol: "DAGR", name: "Demo Agro Processing Ltd", sector: "Agro-processing", currency: "UGX", currencyDecimals: 0, lastPrice: 57000, referencePrice: 58000, changeBps: -172, tickSize: 1, status: "OPEN", synthetic: true },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(marketApiUrl + path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | T | null;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { message?: string } }).error?.message
        : undefined;
      throw new Error(message || ("Meridian demo API returned HTTP " + response.status));
    }
    if (payload === null) throw new Error("Meridian demo API returned an empty response.");
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Meridian demo API request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMarketSecurities(): Promise<MarketSecurity[]> {
  const result = await request<{ mode: string; securities: MarketSecurity[] }>("/api/v1/securities");
  if (result.mode !== "SIMULATION" || !Array.isArray(result.securities)) {
    throw new Error("Market API did not identify a valid simulation response.");
  }
  return result.securities;
}
export function getMarketOrderBook(symbol: string) {
  return request<MarketOrderBook>("/api/v1/securities/" + encodeURIComponent(symbol) + "/orderbook");
}
export function getMarketPortfolio() { return request<MarketPortfolio>("/api/v1/account"); }
export function getMarketOrders() { return request<OrdersResponse>("/api/v1/orders"); }
export function placePaperOrder(input: { symbol: string; side: "BUY" | "SELL"; quantity: number; limitPrice: number }) {
  return request<PaperOrderResponse>("/api/v1/orders", { method: "POST", body: JSON.stringify(input) });
}
export function cancelPaperOrder(orderId: string) {
  return request<{ mode: string; order: MarketOrder; paperTrade: boolean }>(
    "/api/v1/orders/" + encodeURIComponent(orderId), { method: "DELETE" },
  );
}
