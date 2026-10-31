export type WalletKind = "cosmos" | "evm";

export interface WalletConnection {
  kind: WalletKind;
  name: string;
  address: string;
  chainId: string;
}

interface EvmProvider {
  request(args: {
    method: string;
    params?: unknown[];
  }): Promise<unknown>;
}

interface KeplrKey {
  bech32Address?: string;
}

interface KeplrProvider {
  enable(chainId: string): Promise<void>;
  getKey(chainId: string): Promise<KeplrKey>;
}

interface WalletWindow extends Window {
  ethereum?: EvmProvider;
  keplr?: KeplrProvider;
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
  const provider = getWalletWindow().ethereum;
  if (!provider) {
    throw new Error(
      "No EVM wallet was detected. Open S Coin in MetaMask or install a compatible browser wallet.",
    );
  }

  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    !/^0x[a-fA-F0-9]{40}$/.test(accounts[0])
  ) {
    throw new Error("The connected EVM wallet returned an invalid account.");
  }

  const rawChainId = await provider.request({ method: "eth_chainId" });
  if (typeof rawChainId !== "string") {
    throw new Error("The EVM wallet did not return its network identifier.");
  }

  return {
    kind: "evm",
    name: "MetaMask / EVM wallet",
    address: accounts[0],
    chainId: rawChainId,
  };
}

/**
 * Connects to Keplr for the native Cosmos SDK S Coin chain.
 * The chain must already be configured in Keplr with trusted endpoints.
 */
export async function connectScoinWallet(
  chainId: string,
): Promise<WalletConnection> {
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

export function shortenWalletAddress(address: string): string {
  if (address.length <= 18) return address;
  return address.slice(0, 9) + "…" + address.slice(-7);
}
