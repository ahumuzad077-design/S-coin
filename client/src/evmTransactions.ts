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


export interface AllowanceSwapQuote {
  chainId?: number | string;
  taker?: string;
  sellToken?: string;
  buyToken?: string;
  sellAmount?: string;
  buyAmount?: string;
  minBuyAmount?: string;
  liquidityAvailable?: boolean;
  allowanceTarget?: string;
  issues?: {
    simulationIncomplete?: boolean;
    allowance?: { spender?: string; actual?: string; expected?: string };
  };
  transaction: { to: string; data: string; value: string };
}

export interface Erc20ApprovalRequest {
  chainId: string;
  from: string;
  tokenAddress: string;
  spender: string;
  requiredAmount: string;
}

export interface Erc20ApprovalPreview extends Erc20ApprovalRequest {
  currentAllowance: string;
  tokenBalance: string;
  needsApproval: boolean;
  approvalAmount: string;
  gasLimitHex?: string;
  estimatedGasFee?: string;
}

export interface EvmSwapExecutionRequest {
  chainId: string;
  from: string;
  quote: AllowanceSwapQuote;
  receivedAt: number;
  transactionTargets: string[];
  allowanceTargets: string[];
  maxQuoteAgeMs?: number;
}

export interface EvmSwapPreview extends EvmSwapExecutionRequest {
  sellTokenDecimals: number;
  buyTokenDecimals: number;
  sellTokenBalance: string;
  currentAllowance: string;
  gasLimitHex: string;
  valueHex: string;
  estimatedGasFee: string;
  quoteMinBuyAmount: string;
}

function uint256CallData(selector: string, ...values: string[]): string {
  return selector + values.map((value) => {
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value.slice(2).toLowerCase().padStart(64, "0");
    if (!/^\d+$/.test(value)) throw new Error("Invalid contract call argument.");
    return encodeUint256Word(BigInt(value));
  }).join("");
}

async function readContractUint256(
  provider: Eip1193TransferProvider,
  tokenAddress: string,
  data: string,
  label: string,
): Promise<bigint> {
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: tokenAddress, data }, "latest"],
  });
  return decodeUint256(result, label);
}

async function assertContractExists(
  provider: Eip1193TransferProvider,
  contractAddress: string,
  label: string,
): Promise<void> {
  validateAddress(contractAddress, label);
  const code = await provider.request({
    method: "eth_getCode",
    params: [contractAddress, "latest"],
  });
  if (
    typeof code !== "string" ||
    !/^0x[0-9a-fA-F]*$/.test(code) ||
    code === "0x" ||
    /^0x0+$/.test(code)
  ) {
    throw new Error("The " + label + " address does not contain a deployed contract on this network.");
  }
}

async function readTokenDecimals(
  provider: Eip1193TransferProvider,
  tokenAddress: string,
): Promise<number> {
  const value = await readContractUint256(provider, tokenAddress, "0x313ce567", "token decimals");
  if (value > 36n) throw new Error("The token uses unsupported decimal precision.");
  return Number(value);
}

async function readAllowance(
  provider: Eip1193TransferProvider,
  tokenAddress: string,
  owner: string,
  spender: string,
): Promise<bigint> {
  return readContractUint256(
    provider,
    tokenAddress,
    uint256CallData("0xdd62ed3e", owner, spender),
    "token allowance",
  );
}

function assertAllowedContract(address: string, allowlist: string[], label: string): void {
  validateAddress(address, label);
  if (
    !Array.isArray(allowlist) ||
    !allowlist.some((candidate) =>
      typeof candidate === "string" && candidate.toLowerCase() === address.toLowerCase(),
    )
  ) {
    throw new Error("The " + label + " is not present in this app's explicit EVM swap allowlist.");
  }
}

function normalizeChainId(value: string): string {
  if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value).toString();
  if (/^\d+$/.test(value)) return BigInt(value).toString();
  throw new Error("The wallet returned an invalid EVM chain ID.");
}

export async function createErc20ApprovalPreview(
  provider: Eip1193TransferProvider,
  request: Erc20ApprovalRequest,
): Promise<Erc20ApprovalPreview> {
  validateAddress(request.from, "sender");
  validateAddress(request.tokenAddress, "token contract");
  validateAddress(request.spender, "approval spender");
  if (request.spender === "0x0000000000000000000000000000000000000000") {
    throw new Error("The zero address cannot receive a token approval.");
  }
  if (!/^[1-9]\d{0,77}$/.test(request.requiredAmount)) {
    throw new Error("Approval amount must be a positive integer in token base units.");
  }

  await assertConnectedAccount(provider, {
    chainId: request.chainId,
    from: request.from,
    to: request.spender,
    amount: "1",
  });
  await Promise.all([
    assertContractExists(provider, request.tokenAddress, "sell token contract"),
    assertContractExists(provider, request.spender, "0x allowance spender"),
  ]);

  const [allowance, balance, nativeBalance] = await Promise.all([
    readAllowance(provider, request.tokenAddress, request.from, request.spender),
    readContractUint256(
      provider,
      request.tokenAddress,
      uint256CallData("0x70a08231", request.from),
      "token balance",
    ),
    provider.request({
      method: "eth_getBalance",
      params: [request.from, "latest"],
    }),
  ]);

  const required = BigInt(request.requiredAmount);
  if (balance < required) {
    throw new Error("The connected wallet does not hold enough of the sell token for this swap.");
  }
  if (allowance >= required) {
    return {
      ...request,
      currentAllowance: allowance.toString(),
      tokenBalance: balance.toString(),
      needsApproval: false,
      approvalAmount: "0",
    };
  }

  const nativeUnits = parseHexQuantity(nativeBalance, "native balance");
  const approvalData = uint256CallData(
    "0x095ea7b3",
    request.spender,
    request.requiredAmount,
  );
  const approvalTx = {
    from: request.from,
    to: request.tokenAddress,
    value: "0x0",
    data: approvalData,
  };

  // Simulate the exact, limited allowance before presenting it to the user.
  await provider.request({
    method: "eth_call",
    params: [approvalTx, "latest"],
  });
  const [gasLimitValue, gasPriceValue] = await Promise.all([
    provider.request({ method: "eth_estimateGas", params: [approvalTx] }),
    provider.request({ method: "eth_gasPrice" }),
  ]);
  const gasLimit = parseHexQuantity(gasLimitValue, "approval gas estimate");
  const gasPrice = parseHexQuantity(gasPriceValue, "gas price");
  if (gasLimit <= 0n || gasPrice <= 0n) {
    throw new Error("The network returned an unusable approval gas estimate.");
  }
  const estimatedFee = gasLimit * gasPrice;
  if (nativeUnits < estimatedFee) {
    throw new Error("Insufficient native balance to pay for the token approval fee.");
  }

  return {
    ...request,
    currentAllowance: allowance.toString(),
    tokenBalance: balance.toString(),
    needsApproval: true,
    approvalAmount: required.toString(),
    gasLimitHex: "0x" + gasLimit.toString(16),
    estimatedGasFee: formatWei(estimatedFee),
  };
}

export async function submitErc20Approval(
  provider: Eip1193TransferProvider,
  preview: Erc20ApprovalPreview,
): Promise<string> {
  const refreshed = await createErc20ApprovalPreview(provider, preview);
  if (!refreshed.needsApproval) {
    throw new Error("This token allowance is already sufficient. Request a fresh swap quote.");
  }
  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: refreshed.from,
      to: refreshed.tokenAddress,
      value: "0x0",
      data: uint256CallData(
        "0x095ea7b3",
        refreshed.spender,
        refreshed.approvalAmount,
      ),
      gas: refreshed.gasLimitHex,
    }],
  });
  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error("The wallet did not return a valid approval transaction hash.");
  }
  return hash;
}

export async function createEvmSwapPreview(
  provider: Eip1193TransferProvider,
  request: EvmSwapExecutionRequest,
): Promise<EvmSwapPreview> {
  const quote = request.quote;
  const sellToken = quote.sellToken;
  const buyToken = quote.buyToken;
  const sellAmountText = quote.sellAmount;
  const buyAmountText = quote.buyAmount;
  const minBuyAmountText = quote.minBuyAmount;
  validateAddress(request.from, "wallet");
  if (typeof sellToken !== "string" || typeof buyToken !== "string") {
    throw new Error("The swap quote does not identify both token contracts.");
  }
  validateAddress(sellToken, "sell token");
  validateAddress(buyToken, "buy token");
  if (typeof sellAmountText !== "string" || !/^[1-9]\d{0,77}$/.test(sellAmountText)) {
    throw new Error("The swap quote contains an invalid sell amount.");
  }
  if (typeof buyAmountText !== "string" || !/^[1-9]\d{0,77}$/.test(buyAmountText)) {
    throw new Error("The swap quote contains an invalid buy amount.");
  }
  if (typeof minBuyAmountText !== "string" || !/^[1-9]\d{0,77}$/.test(minBuyAmountText)) {
    throw new Error("The swap quote contains an invalid minimum output.");
  }
  if (BigInt(minBuyAmountText) > BigInt(buyAmountText)) {
    throw new Error("The swap quote minimum output exceeds its estimated output.");
  }
  if (quote.liquidityAvailable !== true || quote.issues?.simulationIncomplete === true) {
    throw new Error("The liquidity provider did not return a fully simulated liquid route.");
  }
  if (
    typeof quote.taker !== "string" ||
    quote.taker.toLowerCase() !== request.from.toLowerCase()
  ) {
    throw new Error("The swap quote is not addressed to the currently connected wallet.");
  }
  if (normalizeChainId(String(quote.chainId ?? "")) !== normalizeChainId(request.chainId)) {
    throw new Error("The swap quote belongs to a different EVM network.");
  }
  if (!Number.isFinite(request.receivedAt) || Date.now() - request.receivedAt > (request.maxQuoteAgeMs ?? 20_000)) {
    throw new Error("This swap quote has expired. Request a fresh quote before proceeding.");
  }

  const transaction = quote.transaction;
  if (
    !transaction ||
    !/^0x[a-fA-F0-9]{40}$/.test(transaction.to) ||
    !/^0x(?:[a-fA-F0-9]{2})*$/.test(transaction.data) ||
    !/^\d+$/.test(transaction.value)
  ) {
    throw new Error("The swap quote does not contain a valid transaction.");
  }

  const allowanceTarget = quote.issues?.allowance?.spender ?? quote.allowanceTarget ?? "";
  assertAllowedContract(transaction.to, request.transactionTargets, "swap transaction target");
  assertAllowedContract(allowanceTarget, request.allowanceTargets, "0x allowance target");
  if (
    quote.issues?.allowance?.spender &&
    quote.allowanceTarget &&
    quote.issues.allowance.spender.toLowerCase() !== quote.allowanceTarget.toLowerCase()
  ) {
    throw new Error("The 0x quote returned conflicting allowance target addresses.");
  }

  await assertConnectedAccount(provider, {
    chainId: request.chainId,
    from: request.from,
    to: transaction.to,
    amount: "1",
  });
  await Promise.all([
    assertContractExists(provider, sellToken, "sell token contract"),
    assertContractExists(provider, buyToken, "buy token contract"),
    assertContractExists(provider, transaction.to, "0x swap transaction target"),
    assertContractExists(provider, allowanceTarget, "0x allowance spender"),
  ]);

  const [sellDecimals, buyDecimals] = await Promise.all([
    readTokenDecimals(provider, sellToken),
    readTokenDecimals(provider, buyToken),
  ]);
  const sellAmount = BigInt(sellAmountText);
  const buyAmount = BigInt(buyAmountText);
  const minBuyAmount = BigInt(minBuyAmountText);

  const [sellBalance, allowance] = await Promise.all([
    readContractUint256(
      provider,
      sellToken,
      uint256CallData("0x70a08231", request.from),
      "sell token balance",
    ),
    readAllowance(provider, sellToken, request.from, allowanceTarget),
  ]);
  if (sellBalance < sellAmount) {
    throw new Error("The connected wallet has insufficient sell-token balance.");
  }
  if (allowance < sellAmount) {
    throw new Error("Token approval is required. Approve only the exact sell amount, then request a fresh quote.");
  }

  const value = BigInt(transaction.value);
  const valueHex = "0x" + value.toString(16);
  const tx = {
    from: request.from,
    to: transaction.to,
    data: transaction.data,
    value: valueHex,
  };

  // A quote is only a proposal. Simulate the exact transaction against the
  // connected network and estimate its fee before showing the final review.
  await provider.request({
    method: "eth_call",
    params: [tx, "latest"],
  });
  const [gasLimitValue, gasPriceValue, nativeBalanceValue] = await Promise.all([
    provider.request({ method: "eth_estimateGas", params: [tx] }),
    provider.request({ method: "eth_gasPrice" }),
    provider.request({ method: "eth_getBalance", params: [request.from, "latest"] }),
  ]);
  const gasLimit = parseHexQuantity(gasLimitValue, "swap gas estimate");
  const gasPrice = parseHexQuantity(gasPriceValue, "gas price");
  const nativeBalance = parseHexQuantity(nativeBalanceValue, "native balance");
  if (gasLimit <= 0n || gasPrice <= 0n) {
    throw new Error("The network returned an unusable swap gas estimate.");
  }
  const estimatedFee = gasLimit * gasPrice;
  if (nativeBalance < value + estimatedFee) {
    throw new Error("The connected wallet does not have enough native coin for the swap and estimated gas fee.");
  }

  return {
    ...request,
    sellTokenDecimals: sellDecimals,
    buyTokenDecimals: buyDecimals,
    sellTokenBalance: formatTokenUnitsForEvm(sellBalance, sellDecimals),
    currentAllowance: allowance.toString(),
    gasLimitHex: "0x" + gasLimit.toString(16),
    valueHex,
    estimatedGasFee: formatWei(estimatedFee),
    quoteMinBuyAmount: minBuyAmount.toString(),
  };
}

function formatTokenUnitsForEvm(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

export async function submitEvmSwap(
  provider: Eip1193TransferProvider,
  preview: EvmSwapPreview,
): Promise<string> {
  const fresh = await createEvmSwapPreview(provider, preview);
  if (
    fresh.quote.transaction.to.toLowerCase() !== preview.quote.transaction.to.toLowerCase() ||
    fresh.quote.transaction.data !== preview.quote.transaction.data ||
    fresh.quote.transaction.value !== preview.quote.transaction.value ||
    fresh.quote.sellAmount !== preview.quote.sellAmount ||
    fresh.quote.minBuyAmount !== preview.quote.minBuyAmount
  ) {
    throw new Error("The swap transaction changed during final validation. Request and review a fresh quote.");
  }

  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [{
      from: fresh.from,
      to: fresh.quote.transaction.to,
      data: fresh.quote.transaction.data,
      value: fresh.valueHex,
      gas: fresh.gasLimitHex,
    }],
  });
  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error("The wallet did not return a valid swap transaction hash.");
  }
  return hash;
}
