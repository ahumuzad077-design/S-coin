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
  issues?: {
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
  executionEnabled: false;
  notice: string;
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
): Promise<EvmSwapQuoteResponse> {
  const normalizedUrl = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+$/i.test(normalizedUrl)) {
    throw new Error("Configure the swap quote service using a trusted HTTPS URL.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(normalizedUrl + "/v1/evm/quote", {
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
    if (
      typeof quote.buyAmount !== "string" ||
      !/^[1-9]\d*$/.test(quote.buyAmount) ||
      typeof quote.minBuyAmount !== "string" ||
      !/^\d+$/.test(quote.minBuyAmount) ||
      typeof quote.transaction !== "object" ||
      quote.transaction === null ||
      typeof quote.transaction.to !== "string" ||
      !/^0x[a-fA-F0-9]{40}$/.test(quote.transaction.to) ||
      typeof quote.transaction.data !== "string" ||
      !/^0x(?:[a-fA-F0-9]{2})*$/.test(quote.transaction.data) ||
      typeof quote.transaction.value !== "string" ||
      !/^\d+$/.test(quote.transaction.value)
    ) {
      throw new Error("The swap service returned an incomplete or invalid transaction quote.");
    }

    return payload as EvmSwapQuoteResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("The swap quote request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
