import {
  GasPrice,
  SigningStargateClient,
  calculateFee,
  type DeliverTxResponse,
} from "@cosmjs/stargate";
import type { OfflineSigner } from "@cosmjs/proto-signing";
import { getScoinOfflineSigner } from "./walletAdapters";

const BASE_DENOM = "uscoin";
const DISPLAY_DENOM = "S";
const MICRO_UNITS = 1_000_000n;

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

function parseScoinAmountToBaseUnits(amount: string): string {
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

function formatScoinBaseUnits(value: bigint): string {
  const whole = value / MICRO_UNITS;
  const fraction = (value % MICRO_UNITS).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

function validateAddress(address: string, label: string): void {
  if (!/^scoin1[023456789acdefghjklmnpqrstuvwxyz]{20,}$/.test(address)) {
    throw new Error("Enter a valid S Coin " + label + " address beginning with scoin1.");
  }
}

function getConfiguredCosmosNetwork(expectedChainId: string) {
  if (process.env.EXPO_PUBLIC_SCOIN_COSMOS_SEND_ENABLED !== "true") {
    throw new Error("Native S Coin transfers are disabled in this app build.");
  }
  const configuredChainId = process.env.EXPO_PUBLIC_SCOIN_CHAIN_ID?.trim() ?? "";
  if (!configuredChainId || configuredChainId !== expectedChainId) {
    throw new Error("Set EXPO_PUBLIC_SCOIN_CHAIN_ID to the exact verified network ID before sending S Coin.");
  }
  const rpcUrl = process.env.EXPO_PUBLIC_SCOIN_RPC_URL?.trim() ?? "";
  let parsed: URL;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error("Configure a trusted S Coin CometBFT RPC endpoint in EXPO_PUBLIC_SCOIN_RPC_URL.");
  }
  const localHost = ["localhost", "127.0.0.1", "::1", "10.0.2.2"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost)) {
    throw new Error("S Coin RPC must use HTTPS, except for a local development endpoint.");
  }
  const gasPriceConfig = process.env.EXPO_PUBLIC_SCOIN_GAS_PRICE?.trim() ?? "";
  if (!gasPriceConfig) {
    throw new Error("Configure the chain's approved gas price, for example 0.025uscoin, before sending.");
  }
  let gasPrice: GasPrice;
  try {
    gasPrice = GasPrice.fromString(gasPriceConfig);
  } catch {
    throw new Error("EXPO_PUBLIC_SCOIN_GAS_PRICE must use the format <decimal>uscoin.");
  }
  if (gasPrice.denom !== BASE_DENOM || !Number.isFinite(Number(gasPrice.amount.toString())) || Number(gasPrice.amount.toString()) <= 0) {
    throw new Error("S Coin fees must use the configured uscoin base denomination and a positive gas price.");
  }
  return { chainId: configuredChainId, rpcUrl, gasPrice };
}

function getOfflineSigner(chainId: string): OfflineSigner {
  return getScoinOfflineSigner(chainId) as OfflineSigner;
}

async function connectVerifiedSigner(request: ScoinTransferRequest) {
  const network = getConfiguredCosmosNetwork(request.chainId);
  const signer = getOfflineSigner(network.chainId);
  const accounts = await signer.getAccounts();
  if (!Array.isArray(accounts) || !accounts.some((account) => account.address === request.from)) {
    throw new Error("The connected Keplr account is no longer available. Reconnect the correct account.");
  }

  const client = await SigningStargateClient.connectWithSigner(
    network.rpcUrl,
    signer,
    {
      gasPrice: network.gasPrice,
      broadcastTimeoutMs: 90_000,
      broadcastPollIntervalMs: 3_000,
    },
  );

  try {
    const actualChainId = await client.getChainId();
    if (actualChainId !== network.chainId || actualChainId !== request.chainId) {
      throw new Error("The RPC endpoint reports a different chain ID. No transaction has been signed.");
    }
    return { client, network };
  } catch (error) {
    client.disconnect();
    throw error;
  }
}

export async function createScoinTransferPreview(
  request: ScoinTransferRequest,
): Promise<ScoinTransferPreview> {
  validateAddress(request.from, "sender");
  validateAddress(request.to, "recipient");
  if (request.from === request.to) {
    throw new Error("Sender and recipient addresses must be different.");
  }
  const amountBaseUnits = parseScoinAmountToBaseUnits(request.amount);
  const memo = request.memo?.trim() ?? "";
  if (memo.length > 256) throw new Error("Memo is too long; use no more than 256 characters.");

  const { client, network } = await connectVerifiedSigner(request);
  try {
    const [balance, gasEstimate] = await Promise.all([
      client.getBalance(request.from, BASE_DENOM),
      client.simulate(
        request.from,
        [{
          typeUrl: "/cosmos.bank.v1beta1.MsgSend",
          value: {
            fromAddress: request.from,
            toAddress: request.to,
            amount: [{ denom: BASE_DENOM, amount: amountBaseUnits }],
          },
        }],
        memo,
      ),
    ]);

    if (!/^\d+$/.test(balance.amount)) {
      throw new Error("The S Coin RPC returned an invalid uscoin balance.");
    }
    const available = BigInt(balance.amount);
    const transferAmount = BigInt(amountBaseUnits);
    if (available < transferAmount) {
      throw new Error("The connected S Coin account does not have enough balance for this transfer.");
    }
    if (!Number.isFinite(gasEstimate) || gasEstimate <= 0) {
      throw new Error("The S Coin network returned an invalid gas simulation.");
    }

    const gasLimit = Math.ceil(gasEstimate * 1.3);
    const fee = calculateFee(gasLimit, network.gasPrice);
    if (fee.amount.length !== 1 || fee.amount[0].denom !== BASE_DENOM) {
      throw new Error("The configured S Coin fee calculation returned an unexpected denomination.");
    }
    const feeAmount = BigInt(fee.amount[0].amount);
    if (available < transferAmount + feeAmount) {
      throw new Error(
        "Insufficient S Coin balance for the transfer and estimated fee. Estimated fee: " +
        formatScoinBaseUnits(feeAmount) + " S.",
      );
    }

    return {
      ...request,
      memo,
      amountBaseUnits,
      feeAmount: feeAmount.toString(),
      feeDenom: BASE_DENOM,
      gasLimit,
      availableBalance: balance.amount,
      totalRequired: (transferAmount + feeAmount).toString(),
    };
  } finally {
    client.disconnect();
  }
}

export async function submitScoinTransfer(
  preview: ScoinTransferPreview,
): Promise<ScoinTransferResult> {
  // Re-simulate against the current chain, account and balance before opening
  // the Keplr sign-and-broadcast prompt.
  const refreshed = await createScoinTransferPreview(preview);
  if (
    refreshed.amountBaseUnits !== preview.amountBaseUnits ||
    refreshed.from !== preview.from ||
    refreshed.to !== preview.to ||
    refreshed.chainId !== preview.chainId
  ) {
    throw new Error("The S Coin transfer changed during final validation. Prepare and review it again.");
  }

  const { client } = await connectVerifiedSigner(preview);
  try {
    const response: DeliverTxResponse = await client.sendTokens(
      refreshed.from,
      refreshed.to,
      [{ denom: BASE_DENOM, amount: refreshed.amountBaseUnits }],
      {
        gas: String(refreshed.gasLimit),
        amount: [{ denom: refreshed.feeDenom, amount: refreshed.feeAmount }],
      },
      refreshed.memo ?? "",
    );

    if (response.code !== 0) {
      throw new Error(
        "The S Coin network rejected the transaction with code " + response.code +
        ". Transaction hash: " + response.transactionHash,
      );
    }
    return {
      transactionHash: response.transactionHash,
      height: response.height,
      code: response.code,
      gasUsed: response.gasUsed.toString(),
      gasWanted: response.gasWanted.toString(),
    };
  } finally {
    client.disconnect();
  }
}

export function parseScoinAmountForTests(amount: string): string {
  return parseScoinAmountToBaseUnits(amount);
}
