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

export { parseScoinAmountToBaseUnits as parseScoinAmountForTests } from "./cosmosTransferAmounts";
