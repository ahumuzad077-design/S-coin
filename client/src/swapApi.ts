export interface EvmSwapQuoteRequest {
  chainId: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  taker: string;
  slippageBps?: number;
}

export interface EvmSwapQuote {
  chainId?: number | string;
  sellToken?: string;
  buyToken?: string;
  sellAmount?: string;
  buyAmount?: string;
  minBuyAmount?: string;
  allowanceTarget?: string;
  taker?: string;
  liquidityAvailable?: boolean;
  issues?: {
    simulationIncomplete?: boolean;
    allowance?: {
      spender?: string;
      actual?: string;
      expected?: string;
    };
  };
  transaction: {
    to: string;
    data: string;
    value: string;
    gas?: string;
    gasPrice?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  };
}

export interface EvmSwapQuoteResponse {
  provider: "0x";
  quote: EvmSwapQuote;
  executionEnabled: boolean;
  notice: string;
  receivedAt?: number;
}

export function parseTokenUnits(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("Token decimals must be between 0 and 36.");
  }
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d*)?$/.test(normalized)) {
    throw new Error("Enter a positive token amount using digits and an optional decimal point.");
  }

  const [wholePart, fractionPart = ""] = normalized.split(".");
  if (fractionPart.length > decimals) {
    throw new Error("The entered amount has more decimal places than this token supports.");
  }

  const whole = BigInt(wholePart);
  const fraction = BigInt((fractionPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  const baseUnits = whole * 10n ** BigInt(decimals) + fraction;
  if (baseUnits <= 0n) {
    throw new Error("Amount must be greater than zero.");
  }
  return baseUnits.toString();
}

export function formatTokenUnits(amount: string, decimals: number): string {
  if (
    !/^\d+$/.test(amount) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 36
  ) {
    return "—";
  }

  const value = BigInt(amount);
  if (decimals === 0) return value.toString();

  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fractional = (value % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fractional ? whole.toString() + "." + fractional : whole.toString();
}

export async function requestEvmSwapQuote(
  baseUrl: string,
  request: EvmSwapQuoteRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<EvmSwapQuoteResponse> {
  const normalizedUrl = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+$/i.test(normalizedUrl)) {
    throw new Error("Configure the swap quote service using a trusted HTTPS URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetchImpl(normalizedUrl + "/v1/evm/quote", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    const payload: unknown = await response.json();
    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "The swap quote service could not return a quote.";
      throw new Error(message);
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("provider" in payload) ||
      payload.provider !== "0x" ||
      !("quote" in payload) ||
      typeof payload.quote !== "object" ||
      payload.quote === null
    ) {
      throw new Error("The swap service returned an invalid quote response.");
    }

    const quote = payload.quote as EvmSwapQuote;
    const normalizeChainId = (value: string | number): string => {
      const text = String(value);
      return /^0x[0-9a-fA-F]+$/.test(text)
        ? BigInt(text).toString()
        : /^\d+$/.test(text)
          ? BigInt(text).toString()
          : "";
    };
    if (
      normalizeChainId(quote.chainId ?? "") !== normalizeChainId(request.chainId) ||
      typeof quote.sellToken !== "string" ||
      quote.sellToken.toLowerCase() !== request.sellToken.toLowerCase() ||
      typeof quote.buyToken !== "string" ||
      quote.buyToken.toLowerCase() !== request.buyToken.toLowerCase() ||
      quote.sellAmount !== request.sellAmount ||
      typeof quote.taker !== "string" ||
      quote.taker.toLowerCase() !== request.taker.toLowerCase() ||
      quote.liquidityAvailable !== true ||
      typeof quote.buyAmount !== "string" ||
      !/^[1-9]\d*$/.test(quote.buyAmount) ||
      typeof quote.minBuyAmount !== "string" ||
      !/^[1-9]\d*$/.test(quote.minBuyAmount) ||
      BigInt(quote.minBuyAmount) > BigInt(quote.buyAmount) ||
      typeof quote.transaction !== "object" ||
      quote.transaction === null ||
      typeof quote.transaction.to !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(quote.transaction.to) ||
      typeof quote.transaction.data !== "string" ||
      !/^0x(?:[a-fA-F0-9]{2})*$/.test(quote.transaction.data) ||
      typeof quote.transaction.value !== "string" ||
      !/^\d+$/.test(quote.transaction.value) ||
      typeof (payload as Record<string, unknown>).executionEnabled !== "boolean"
    ) {
      throw new Error("The swap service returned a quote that does not match this wallet request or contains invalid fields.");
    }

    const allowanceSpender = quote.issues?.allowance?.spender ?? quote.allowanceTarget;
    if (allowanceSpender !== undefined && !/^0x[a-fA-F0-9]{40}$/.test(allowanceSpender)) {
      throw new Error("The swap service returned an invalid token allowance target.");
    }

    const responseQuote = payload as EvmSwapQuoteResponse;
    return { ...responseQuote, receivedAt: Date.now() };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The swap quote request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}


export interface CosmosRoutePreviewRequest {
  sourceAssetChainId: string;
  sourceAssetDenom: string;
  destAssetChainId: string;
  destAssetDenom: string;
  amountIn: string;
}

export interface CosmosRoutePreview {
  estimated_amount_out?: string;
  min_amount_out?: string;
  summary?: string;
  chain_ids?: string[];
  does_swap?: boolean;
  swap_price_impact_percent?: string;
  estimated_route_duration_seconds?: number;
  estimated_fees?: Array<{
    amount?: string;
    denom?: string;
    chain_id?: string;
  }>;
}

export interface CosmosRoutePreviewResponse {
  provider: "Skip Go";
  route: CosmosRoutePreview;
  executionEnabled: false;
  notice: string;
}

export async function requestCosmosRoutePreview(
  baseUrl: string,
  request: CosmosRoutePreviewRequest,
): Promise<CosmosRoutePreviewResponse> {
  const normalizedUrl = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+$/i.test(normalizedUrl)) {
    throw new Error("Configure the swap quote service using a trusted HTTPS URL.");
  }
  if (!/^[1-9]\d{0,77}$/.test(request.amountIn)) {
    throw new Error("Route amount must be a positive integer in base units.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(normalizedUrl + "/v1/cosmos/route-preview", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    const payload: unknown = await response.json();
    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "The Cosmos route service could not return a route.";
      throw new Error(message);
    }

    if (
      typeof payload !== "object" ||
      payload === null ||
      !("provider" in payload) ||
      payload.provider !== "Skip Go" ||
      !("route" in payload) ||
      typeof payload.route !== "object" ||
      payload.route === null
    ) {
      throw new Error("The Cosmos route service returned an invalid response.");
    }

    const route = payload.route as CosmosRoutePreview;
    if (
      typeof route.estimated_amount_out !== "string" ||
      !/^\d+$/.test(route.estimated_amount_out)
    ) {
      throw new Error("The Cosmos route response did not include a valid output amount.");
    }

    return payload as CosmosRoutePreviewResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The Cosmos route request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
