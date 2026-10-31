export interface Eip1193TransferProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export interface NativeTransferRequest {
  chainId: string;
  from: string;
  to: string;
  amount: string;
}

export interface NativeTransferPreview extends NativeTransferRequest {
  valueHex: string;
  gasLimitHex: string;
  gasPriceHex: string;
  estimatedGasFee: string;
  availableBalance: string;
  totalRequired: string;
}

export interface EvmTransactionReceipt {
  transactionHash: string;
  status: "success" | "reverted";
  blockNumber: string;
}

const WEI = 10n ** 18n;

function parseHexQuantity(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("The connected network returned an invalid " + field + ".");
  }
  return BigInt(value);
}

function formatWei(value: bigint): string {
  const whole = value / WEI;
  const fraction = (value % WEI).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

export function parseNativeAmountToHex(amount: string): string {
  const normalized = amount.trim();
  if (!/^(?:0|[1-9]\d{0,77})(?:\.\d{1,18})?$/.test(normalized)) {
    throw new Error("Enter a positive amount with no more than 18 decimal places.");
  }
  const [wholePart, fractionalPart = ""] = normalized.split(".");
  const value = BigInt(wholePart) * WEI +
    BigInt((fractionalPart + "0".repeat(18)).slice(0, 18) || "0");
  if (value <= 0n) throw new Error("The transfer amount must be greater than zero.");
  return "0x" + value.toString(16);
}

function validateAddress(value: string, label: string): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error("Enter a valid EVM " + label + " address.");
  }
}

async function assertConnectedAccount(
  provider: Eip1193TransferProvider,
  request: NativeTransferRequest,
): Promise<void> {
  const [chainId, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (typeof chainId !== "string" || chainId.toLowerCase() !== request.chainId.toLowerCase()) {
    throw new Error("The wallet network changed. Reconnect and review the transfer again.");
  }
  if (
    !Array.isArray(accounts) ||
    !accounts.some((account) =>
      typeof account === "string" && account.toLowerCase() === request.from.toLowerCase(),
    )
  ) {
    throw new Error("The transfer account is no longer connected to this wallet session.");
  }
}

export async function createNativeTransferPreview(
  provider: Eip1193TransferProvider,
  request: NativeTransferRequest,
): Promise<NativeTransferPreview> {
  validateAddress(request.from, "sender");
  validateAddress(request.to, "recipient");
  if (request.from.toLowerCase() === request.to.toLowerCase()) {
    throw new Error("Sender and recipient addresses must be different.");
  }

  const valueHex = parseNativeAmountToHex(request.amount);
  await assertConnectedAccount(provider, request);

  const transaction = {
    from: request.from,
    to: request.to,
    value: valueHex,
  };

  const [balanceValue, gasLimitValue, gasPriceValue] = await Promise.all([
    provider.request({
      method: "eth_getBalance",
      params: [request.from, "latest"],
    }),
    provider.request({
      method: "eth_estimateGas",
      params: [transaction],
    }),
    provider.request({ method: "eth_gasPrice" }),
  ]);

  const balance = parseHexQuantity(balanceValue, "native balance");
  const gasLimit = parseHexQuantity(gasLimitValue, "estimated gas limit");
  const gasPrice = parseHexQuantity(gasPriceValue, "gas price");
  if (gasLimit <= 0n || gasPrice <= 0n) {
    throw new Error("The connected network returned an unusable gas estimate.");
  }

  const value = BigInt(valueHex);
  const estimatedFee = gasLimit * gasPrice;
  const totalRequired = value + estimatedFee;
  if (balance < totalRequired) {
    throw new Error(
      "Insufficient native balance. The transfer and estimated network fee require " +
      formatWei(totalRequired) + " native coin.",
    );
  }

  return {
    ...request,
    valueHex,
    gasLimitHex: "0x" + gasLimit.toString(16),
    gasPriceHex: "0x" + gasPrice.toString(16),
    estimatedGasFee: formatWei(estimatedFee),
    availableBalance: formatWei(balance),
    totalRequired: formatWei(totalRequired),
  };
}

/**
 * Requests a native-asset transfer through the connected wallet. MetaMask
 * presents the transaction to the user for explicit approval; this app never
 * receives a private key and cannot sign silently.
 */
export async function submitNativeTransfer(
  provider: Eip1193TransferProvider,
  preview: NativeTransferPreview,
): Promise<string> {
  // Re-check account, chain, balance and fees immediately before the wallet prompt.
  const freshPreview = await createNativeTransferPreview(provider, preview);
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: freshPreview.from,
      to: freshPreview.to,
      value: freshPreview.valueHex,
      gas: freshPreview.gasLimitHex,
      gasPrice: freshPreview.gasPriceHex,
    }],
  });

  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error("The wallet did not return a valid transaction hash.");
  }
  return hash;
}

export async function getEvmTransactionReceipt(
  provider: Eip1193TransferProvider,
  expectedChainId: string,
  transactionHash: string,
): Promise<EvmTransactionReceipt | null> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
    throw new Error("The transaction hash is invalid.");
  }
  const chainId = await provider.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || chainId.toLowerCase() !== expectedChainId.toLowerCase()) {
    throw new Error("Wallet network changed while checking the transaction.");
  }

  const receipt = await provider.request({
    method: "eth_getTransactionReceipt",
    params: [transactionHash],
  });
  if (receipt === null) return null;
  if (typeof receipt !== "object") {
    throw new Error("The network returned an invalid transaction receipt.");
  }

  const value = receipt as Record<string, unknown>;
  if (
    typeof value.transactionHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(value.transactionHash) ||
    typeof value.status !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(value.status) ||
    typeof value.blockNumber !== "string"
  ) {
    throw new Error("The network returned an incomplete transaction receipt.");
  }

  return {
    transactionHash: value.transactionHash,
    status: BigInt(value.status) === 1n ? "success" : "reverted",
    blockNumber: value.blockNumber,
  };
}

export async function waitForEvmTransactionReceipt(
  provider: Eip1193TransferProvider,
  expectedChainId: string,
  transactionHash: string,
  timeoutMs = 90_000,
): Promise<EvmTransactionReceipt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const receipt = await getEvmTransactionReceipt(
      provider,
      expectedChainId,
      transactionHash,
    );
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error("Transaction is still pending. Keep the hash and check the explorer later.");
}


export interface Erc20TransferRequest {
  chainId: string;
  from: string;
  to: string;
  tokenAddress: string;
  amount: string;
}

export interface Erc20TransferPreview extends Erc20TransferRequest {
  decimals: number;
  amountBaseUnits: string;
  tokenBalance: string;
  nativeBalance: string;
  gasLimitHex: string;
  gasPriceHex: string;
  estimatedGasFee: string;
}

function parseTokenAmount(amount: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("The token contract returned unsupported decimal precision.");
  }
  const normalized = amount.trim();
  const pattern = decimals === 0
    ? /^(?:0|[1-9]\d{0,77})$/
    : new RegExp("^(?:0|[1-9]\\d{0,77})(?:\\.\\d{1," + decimals + "})?$");
  if (!pattern.test(normalized)) {
    throw new Error("Enter a positive token amount using no more than " + decimals + " decimal places.");
  }
  const [wholePart, fractionPart = ""] = normalized.split(".");
  const scale = 10n ** BigInt(decimals);
  const fraction = BigInt((fractionPart + "0".repeat(decimals)).slice(0, decimals) || "0");
  const value = BigInt(wholePart) * scale + fraction;
  if (value <= 0n) {
    throw new Error("The token transfer amount must be greater than zero.");
  }
  if (value >= 1n << 256n) {
    throw new Error("The token transfer amount is too large.");
  }
  return value;
}

function decodeUint256(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("The token contract returned an invalid " + label + ".");
  }
  return BigInt(value);
}

function encodeAddressWord(address: string): string {
  validateAddress(address, "recipient");
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function encodeUint256Word(value: bigint): string {
  const encoded = value.toString(16);
  if (encoded.length > 64) throw new Error("Token amount exceeds uint256.");
  return encoded.padStart(64, "0");
}

/**
 * Prepares a standard ERC-20 transfer. It verifies that the token address has
 * contract code, reads decimals and balanceOf from that contract, estimates
 * the native gas fee, and rechecks the active wallet account/network. A token
 * address is still user-supplied and must be independently verified.
 */
export async function createErc20TransferPreview(
  provider: Eip1193TransferProvider,
  request: Erc20TransferRequest,
): Promise<Erc20TransferPreview> {
  validateAddress(request.from, "sender");
  validateAddress(request.to, "recipient");
  validateAddress(request.tokenAddress, "token contract");
  if (request.from.toLowerCase() === request.to.toLowerCase()) {
    throw new Error("Sender and recipient addresses must be different.");
  }
  if (request.to.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    throw new Error("The zero address cannot be used as a token recipient.");
  }

  await assertConnectedAccount(provider, request);
  const code = await provider.request({
    method: "eth_getCode",
    params: [request.tokenAddress, "latest"],
  });
  if (typeof code !== "string" || !/^0x[0-9a-fA-F]*$/.test(code) || code === "0x" || /^0x0+$/.test(code)) {
    throw new Error("The token address does not contain a deployed contract.");
  }

  const [decimalsResult, balanceResult] = await Promise.all([
    provider.request({
      method: "eth_call",
      params: [{ to: request.tokenAddress, data: "0x313ce567" }, "latest"],
    }),
    provider.request({
      method: "eth_call",
      params: [{
        to: request.tokenAddress,
        data: "0x70a08231" + encodeAddressWord(request.from),
      }, "latest"],
    }),
  ]);

  const decimalsValue = decodeUint256(decimalsResult, "decimals");
  if (decimalsValue > 36n) {
    throw new Error("The token contract returned unsupported decimal precision.");
  }
  const decimals = Number(decimalsValue);
  const tokenBalance = decodeUint256(balanceResult, "token balance");
  const amountBaseUnits = parseTokenAmount(request.amount, decimals);
  if (tokenBalance < amountBaseUnits) {
    throw new Error("Insufficient token balance for this transfer.");
  }

  const transferData = "0xa9059cbb" +
    encodeAddressWord(request.to) +
    encodeUint256Word(amountBaseUnits);
  const transaction = {
    from: request.from,
    to: request.tokenAddress,
    value: "0x0",
    data: transferData,
  };

  const [nativeBalanceValue, gasLimitValue, gasPriceValue] = await Promise.all([
    provider.request({
      method: "eth_getBalance",
      params: [request.from, "latest"],
    }),
    provider.request({
      method: "eth_estimateGas",
      params: [transaction],
    }),
    provider.request({ method: "eth_gasPrice" }),
  ]);

  const nativeBalance = parseHexQuantity(nativeBalanceValue, "native balance");
  const gasLimit = parseHexQuantity(gasLimitValue, "estimated gas limit");
  const gasPrice = parseHexQuantity(gasPriceValue, "gas price");
  if (gasLimit <= 0n || gasPrice <= 0n) {
    throw new Error("The connected network returned an unusable gas estimate.");
  }
  const estimatedFee = gasLimit * gasPrice;
  if (nativeBalance < estimatedFee) {
    throw new Error(
      "Insufficient native balance for the estimated network fee of " +
      formatWei(estimatedFee) + ".",
    );
  }

  return {
    ...request,
    decimals,
    amountBaseUnits: amountBaseUnits.toString(),
    tokenBalance: formatWei(tokenBalance * WEI / (10n ** BigInt(decimals))),
    nativeBalance: formatWei(nativeBalance),
    gasLimitHex: "0x" + gasLimit.toString(16),
    gasPriceHex: "0x" + gasPrice.toString(16),
    estimatedGasFee: formatWei(estimatedFee),
  };
}

export async function submitErc20Transfer(
  provider: Eip1193TransferProvider,
  preview: Erc20TransferPreview,
): Promise<string> {
  const refreshed = await createErc20TransferPreview(provider, preview);
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: refreshed.from,
      to: refreshed.tokenAddress,
      value: "0x0",
      data: "0xa9059cbb" +
        encodeAddressWord(refreshed.to) +
        encodeUint256Word(BigInt(refreshed.amountBaseUnits)),
      gas: refreshed.gasLimitHex,
      gasPrice: refreshed.gasPriceHex,
    }],
  });
  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error("The wallet did not return a valid transaction hash.");
  }
  return hash;
}
