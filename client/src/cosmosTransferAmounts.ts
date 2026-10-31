const MICRO_UNITS = 1_000_000n;

export function parseScoinAmountToBaseUnits(amount: string): string {
  const value = amount.trim();
  if (!/^(?:0|[1-9]\d{0,24})(?:\.\d{1,6})?$/.test(value)) {
    throw new Error("Enter a positive S Coin amount with up to 6 decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  const baseUnits = BigInt(whole) * MICRO_UNITS +
    BigInt((fraction + "000000").slice(0, 6));
  if (baseUnits <= 0n) {
    throw new Error("The transfer amount must be greater than zero.");
  }
  return baseUnits.toString();
}
