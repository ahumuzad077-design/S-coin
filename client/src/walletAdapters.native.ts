import { createEVMClient } from "@metamask/connect-evm";
import { Linking } from "react-native";

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

type MetaMaskConnectClient = Awaited<ReturnType<typeof createEVMClient>>;
let nativeMetaMaskClient: MetaMaskConnectClient | null = null;
let nativeMetaMaskClientPromise: ReturnType<typeof createEVMClient> | null = null;

const defaultEvmNetworks: Record<string, string> = {
  "0x1": "https://ethereum-rpc.publicnode.com",
  "0xaa36a7": "https://ethereum-sepolia-rpc.publicnode.com",
  "0x89": "https://polygon-bor-rpc.publicnode.com",
  "0xa": "https://optimism-rpc.publicnode.com",
  "0xa4b1": "https://arbitrum-one-rpc.publicnode.com",
  "0x2105": "https://base-rpc.publicnode.com",
  "0x38": "https://bsc-rpc.publicnode.com",
};

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

function getSupportedEvmNetworks(): Record<string, string> {
  const configured = process.env.EXPO_PUBLIC_METAMASK_SUPPORTED_NETWORKS_JSON;
  if (!configured?.trim()) return defaultEvmNetworks;

  let parsed: unknown;
  try {
    parsed = JSON.parse(configured);
  } catch {
    throw new Error("EXPO_PUBLIC_METAMASK_SUPPORTED_NETWORKS_JSON must be valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("MetaMask supported networks must be a JSON object of chain IDs and HTTPS RPC URLs.");
  }

  const networks: Record<string, string> = {};
  for (const [chainId, rpcUrl] of Object.entries(parsed)) {
    if (
      !/^0x[0-9a-fA-F]+$/.test(chainId) ||
      typeof rpcUrl !== "string" ||
      !/^https:\/\/[^\s]+$/i.test(rpcUrl)
    ) {
      throw new Error("Each MetaMask network must use a hex chain ID and trusted HTTPS RPC URL.");
    }
    networks[chainId.toLowerCase()] = rpcUrl;
  }

  if (Object.keys(networks).length === 0) {
    throw new Error("Configure at least one EVM network before connecting MetaMask.");
  }
  return networks;
}

async function getNativeMetaMaskClient(): Promise<MetaMaskConnectClient> {
  if (nativeMetaMaskClient) return nativeMetaMaskClient;
  if (!nativeMetaMaskClientPromise) {
    const supportedNetworks = getSupportedEvmNetworks();
    const appUrl =
      process.env.EXPO_PUBLIC_SCOIN_DAPP_URL ??
      "https://github.com/ahumuzad077-design/S-coin";

    if (!/^https:\/\/[^\s]+$/i.test(appUrl)) {
      throw new Error("EXPO_PUBLIC_SCOIN_DAPP_URL must be a public HTTPS URL.");
    }

    nativeMetaMaskClientPromise = createEVMClient({
      dapp: {
        name: "S Coin",
        url: appUrl,
      },
      api: {
        supportedNetworks,
      },
      ui: {
        preferExtension: false,
      },
      mobile: {
        preferredOpenLink: (deeplink: string) => Linking.openURL(deeplink),
      },
    });
  }

  try {
    nativeMetaMaskClient = await nativeMetaMaskClientPromise;
    return nativeMetaMaskClient;
  } catch (error) {
    nativeMetaMaskClientPromise = null;
    throw error;
  }
}

export async function connectEvmWallet(): Promise<WalletConnection> {
  const client = await getNativeMetaMaskClient();
  const result = await client.connect({
    chainIds: Object.keys(getSupportedEvmNetworks()) as `0x${string}`[],
  });

  if (
    !Array.isArray(result.accounts) ||
    typeof result.accounts[0] !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(result.accounts[0]) ||
    typeof result.chainId !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(result.chainId)
  ) {
    throw new Error("MetaMask Connect returned an invalid account or chain ID.");
  }

  nativeMetaMaskClient = client;
  const provider = client.getProvider() as unknown as EvmProvider;
  activeEvmProvider = provider;
  const nativeBalance = await readEvmNativeBalance(
    provider,
    result.accounts[0],
    result.chainId,
  );
  return {
    kind: "evm",
    name: "MetaMask Connect",
    address: result.accounts[0],
    chainId: result.chainId,
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
  const client = nativeMetaMaskClient;
  nativeMetaMaskClient = null;
  activeEvmProvider = null;

  if (client) {
    await client.disconnect();
  }
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

export async function connectScoinWallet(
  chainId: string,
): Promise<WalletConnection> {
  if (!chainId.trim()) {
    throw new Error(
      "Configure the exact trusted S Coin chain ID before connecting a Cosmos wallet.",
    );
  }
  throw new Error(
    "Native Keplr/Cosmos mobile pairing is not configured yet. Use the S Coin web app with Keplr browser extension for now.",
  );
}

export function shortenWalletAddress(address: string): string {
  if (address.length <= 18) return address;
  return address.slice(0, 9) + "…" + address.slice(-7);
}
