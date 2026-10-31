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

  return {
    kind: "evm",
    name,
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

export function shortenWalletAddress(address: string): string {
  if (address.length <= 18) return address;
  return address.slice(0, 9) + "…" + address.slice(-7);
}
