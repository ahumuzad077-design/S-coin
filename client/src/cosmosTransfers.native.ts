export interface ScoinTransferRequest {
  chainId: string;
  from: string;
  to: string;
  amount: string;
  memo?: string;
}

export interface ScoinTransferPreview extends ScoinTransferRequest {
  amountBaseUnits: string;
  feeAmount: string;
  feeDenom: string;
  gasLimit: number;
  availableBalance: string;
  totalRequired: string;
}

export interface ScoinTransferResult {
  transactionHash: string;
  height: number;
  code: number;
  gasUsed: string;
  gasWanted: string;
}

export async function createScoinTransferPreview(
  _request: ScoinTransferRequest,
): Promise<ScoinTransferPreview> {
  throw new Error("Native Keplr / Cosmos mobile wallet pairing is not configured. Use the S Coin web app with Keplr browser extension.");
}

export async function submitScoinTransfer(
  _preview: ScoinTransferPreview,
): Promise<ScoinTransferResult> {
  throw new Error("Native Keplr / Cosmos mobile wallet pairing is not configured.");
}

export function parseScoinAmountForTests(amount: string): string {
  const value = amount.trim();
  if (!/^(?:0|[1-9]\d{0,24})(?:\.\d{1,6})?$/.test(value)) {
    throw new Error("Enter a positive S Coin amount with up to 6 decimal places.");
  }
  const [whole, fraction = ""] = value.split(".");
  const base = BigInt(whole) * 1_000_000n + BigInt((fraction + "000000").slice(0, 6));
  if (base <= 0n) throw new Error("The transfer amount must be greater than zero.");
  return base.toString();
}
