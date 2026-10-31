export type WalletKind = "cosmos" | "evm";

export interface WalletConnection {
  kind: WalletKind;
  name: string;
  address: string;
  chainId: string;
  nativeBalance?: string;
  nativeSymbol?: string;
}

interface EvmProvider {
  request(args: {
    method: string;
    params?: unknown[];
  }): Promise<unknown>;
  on?(
    event: "accountsChanged" | "chainChanged",
    listener: (value: unknown) => void,
  ): void;
  removeListener?(
    event: "accountsChanged" | "chainChanged",
    listener: (value: unknown) => void,
  ): void;
}

let activeEvmProvider: EvmProvider | null = null;

export function getActiveEvmProvider(): EvmProvider {
  if (!activeEvmProvider) {
    throw new Error("Connect an EVM wallet before continuing.");
  }
  return activeEvmProvider;
}

const evmNativeSymbols: Record<string, string> = {
  "0x1": "ETH",
  "0xaa36a7": "ETH",
  "0x89": "POL",
  "0xa": "ETH",
  "0xa4b1": "ETH",
  "0x2105": "ETH",
  "0x38": "BNB",
};

function formatEvmNativeBalance(rawBalance: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(rawBalance)) {
    throw new Error("The EVM network returned an invalid native balance.");
  }
  const units = BigInt(rawBalance);
  const scale = 10n ** 18n;
  const whole = units / scale;
  const fraction = ((units % scale) / 10n ** 10n)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return fraction ? whole.toString() + "." + fraction : whole.toString();
}

async function readEvmNativeBalance(
  provider: EvmProvider,
  address: string,
  chainId: string,
): Promise<{ nativeBalance?: string; nativeSymbol: string }> {
  const nativeSymbol = evmNativeSymbols[chainId.toLowerCase()] ?? "NATIVE";
  try {
    const result = await provider.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    });
    if (typeof result !== "string") return { nativeSymbol };
    return {
      nativeBalance: formatEvmNativeBalance(result),
      nativeSymbol,
    };
  } catch {
    // Wallet permission/network issues should not prevent the address connection.
    return { nativeSymbol };
  }
}

interface KeplrKey {
  bech32Address?: string;
}

interface KeplrProvider {
  enable(chainId: string): Promise<void>;
  getKey(chainId: string): Promise<KeplrKey>;
  getOfflineSigner?(chainId: string): unknown;
}

interface WalletWindow extends Window {
  ethereum?: EvmProvider;
  keplr?: KeplrProvider;
}

interface Eip6963Announcement {
  info?: {
    name?: string;
    rdns?: string;
  };
  provider?: EvmProvider;
}

async function discoverEvmProvider(): Promise<{ provider: EvmProvider; name: string }> {
  const walletWindow = getWalletWindow();
  const candidates: Array<{ provider: EvmProvider; name: string; rdns: string }> = [];

  const onAnnouncement = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Announcement>).detail;
    if (
      detail &&
      detail.provider &&
      typeof detail.provider.request === "function" &&
      typeof detail.info?.name === "string"
    ) {
      candidates.push({
        provider: detail.provider,
        name: detail.info.name,
        rdns: detail.info.rdns ?? "",
      });
    }
  };

  walletWindow.addEventListener("eip6963:announceProvider", onAnnouncement);
  walletWindow.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => setTimeout(resolve, 180));
  walletWindow.removeEventListener("eip6963:announceProvider", onAnnouncement);

  const metaMask = candidates.find(
    (candidate) =>
      candidate.rdns.toLowerCase() === "io.metamask" ||
      candidate.name.toLowerCase().includes("metamask"),
  );
  if (metaMask) {
    return { provider: metaMask.provider, name: metaMask.name };
  }

  const firstAvailable = candidates[0];
  if (firstAvailable) {
    return { provider: firstAvailable.provider, name: firstAvailable.name };
  }

  if (walletWindow.ethereum) {
    return { provider: walletWindow.ethereum, name: "Injected EVM wallet" };
  }

  throw new Error(
    "No EVM wallet was detected. Open S Coin in MetaMask or install a compatible browser wallet.",
  );
}

function getWalletWindow(): WalletWindow {
  if (typeof window === "undefined") {
    throw new Error("Wallet extensions are available in a supported web browser.");
  }
  return window as WalletWindow;
}

/**
 * Connects to an injected EIP-1193 wallet such as MetaMask.
 * It requests the public account address and network ID only.
 * It never requests a seed phrase or signs/submits a transaction.
 */
export async function connectEvmWallet(): Promise<WalletConnection> {
  const { provider, name } = await discoverEvmProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(accounts[0])
  ) {
    throw new Error("The connected EVM wallet returned an invalid account.");
  }

  const rawChainId = await provider.request({ method: "eth_chainId" });
  if (typeof rawChainId !== "string" || !/^0x[0-9a-fA-F]+$/.test(rawChainId)) {
    throw new Error("The EVM wallet did not return a valid network identifier.");
  }

  activeEvmProvider = provider;
  const nativeBalance = await readEvmNativeBalance(provider, accounts[0], rawChainId);
  return {
    kind: "evm",
    name,
    address: accounts[0],
    chainId: rawChainId,
    ...nativeBalance,
  };
}

export async function refreshConnectedEvmBalance(): Promise<{
  nativeBalance?: string;
  nativeSymbol: string;
}> {
  const provider = getActiveEvmProvider();
  const [chainId, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (
    typeof chainId !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(chainId) ||
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(accounts[0])
  ) {
    throw new Error("The connected wallet session is no longer available.");
  }
  return readEvmNativeBalance(provider, accounts[0], chainId);
}

export async function disconnectEvmWallet(): Promise<void> {
  activeEvmProvider = null;
}

export function subscribeEvmWalletChanges(onChange: () => void): () => void {
  const provider = activeEvmProvider;
  if (!provider?.on) return () => undefined;

  const handleAccountsChanged = () => onChange();
  const handleChainChanged = () => onChange();
  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);

  return () => {
    provider.removeListener?.("accountsChanged", handleAccountsChanged);
    provider.removeListener?.("chainChanged", handleChainChanged);
  };
}

export async function getErc20TokenDecimals(
  tokenAddress: string,
  expectedChainId: string,
): Promise<number> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    throw new Error("Enter a valid ERC-20 token contract address first.");
  }

  const provider = activeEvmProvider;
  if (!provider) {
    throw new Error("Connect an EVM wallet before reading token metadata.");
  }

  const currentChainId = await provider.request({ method: "eth_chainId" });
  if (currentChainId !== expectedChainId) {
    throw new Error("The connected wallet network changed. Reconnect before reading token metadata.");
  }

  const result = await provider.request({
    method: "eth_call",
    params: [{ to: tokenAddress, data: "0x313ce567" }, "latest"],
  });

  if (
    typeof result !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(result)
  ) {
    throw new Error("The token contract returned an invalid decimals value.");
  }

  const decimals = Number(BigInt(result));
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("The token contract returned unsupported decimal precision.");
  }
  return decimals;
}

/**
 * Connects to Keplr for the native Cosmos SDK S Coin chain.
 * The chain must already be configured in Keplr with trusted endpoints.
 */
export async function connectScoinWallet(
  chainId: string,
): Promise<WalletConnection> {
  if (!chainId.trim()) {
    throw new Error(
      "Connect to a trusted S Coin node or configure EXPO_PUBLIC_SCOIN_CHAIN_ID before connecting a wallet.",
    );
  }

  const provider = getWalletWindow().keplr;
  if (!provider) {
    throw new Error(
      "Keplr was not detected. Open S Coin in a browser with the Keplr extension installed.",
    );
  }

  await provider.enable(chainId);
  const key = await provider.getKey(chainId);

  if (
    typeof key?.bech32Address !== "string" ||
    !key.bech32Address.startsWith("scoin1")
  ) {
    throw new Error(
      "Keplr returned an address that does not match the S Coin address prefix.",
    );
  }

  return {
    kind: "cosmos",
    name: "Keplr",
    address: key.bech32Address,
    chainId,
  };
}

export function getScoinOfflineSigner(chainId: string): unknown {
  if (!chainId.trim()) {
    throw new Error("Configure the exact verified S Coin chain ID before signing.");
  }
  const keplr = getWalletWindow().keplr;
  if (!keplr?.getOfflineSigner) {
    throw new Error("Keplr does not expose a signing interface in this browser session.");
  }
  return keplr.getOfflineSigner(chainId);
}

export function shortenWalletAddress(address: string): string {
  if (address.length <= 18) return address;
  return address.slice(0, 9) + "…" + address.slice(-7);
}
