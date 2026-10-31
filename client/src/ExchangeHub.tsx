import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  BinanceTicker,
  fetchBinanceTickers,
  formatMarketPercent,
  formatMarketPrice,
} from "./marketData";
import {
  WalletConnection,
  connectEvmWallet,
  connectScoinWallet,
  shortenWalletAddress,
} from "./walletAdapters";

interface ExchangeHubProps {
  chainId: string;
  compact: boolean;
}

export function ExchangeHub({ chainId, compact }: ExchangeHubProps) {
  const [tickers, setTickers] = useState<BinanceTicker[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [evmWallet, setEvmWallet] = useState<WalletConnection | null>(null);
  const [scoinWallet, setScoinWallet] = useState<WalletConnection | null>(null);
  const [walletError, setWalletError] = useState("");
  const [amount, setAmount] = useState("1");
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");

  const refreshMarkets = useCallback(async () => {
    setRefreshing(true);
    setMarketError("");
    try {
      const nextTickers = await fetchBinanceTickers();
      setTickers(nextTickers);
    } catch (error) {
      setMarketError(
        error instanceof Error
          ? error.message
          : "Could not load Binance market data.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshMarkets();
    const timer = setInterval(() => void refreshMarkets(), 15000);
    return () => clearInterval(timer);
  }, [refreshMarkets]);

  const selectedTicker = useMemo(
    () => tickers.find((ticker) => ticker.symbol === selectedSymbol) ?? null,
    [selectedSymbol, tickers],
  );

  const indicativeValue = useMemo(() => {
    const quantity = Number(amount);
    const price = Number(selectedTicker?.lastPrice ?? "0");
    if (
      !Number.isFinite(quantity) ||
      quantity < 0 ||
      !Number.isFinite(price)
    ) {
      return "—";
    }
    return (quantity * price).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [amount, selectedTicker]);

  const connectScoin = async () => {
    setWalletError("");
    try {
      const connection = await connectScoinWallet(chainId);
      setScoinWallet(connection);
    } catch (error) {
      setWalletError(
        error instanceof Error ? error.message : "Could not connect Keplr.",
      );
    }
  };

  const connectEvm = async () => {
    setWalletError("");
    try {
      const connection = await connectEvmWallet();
      setEvmWallet(connection);
    } catch (error) {
      setWalletError(
        error instanceof Error
          ? error.message
          : "Could not connect the EVM wallet.",
      );
    }
  };

  const browserWalletsAvailable = Platform.OS === "web";

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.heroTag}>
          <View style={styles.heroDot} />
          <Text style={styles.heroTagText}>S COIN · MARKETS & WALLET</Text>
        </View>
        <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]}>
          One place for crypto markets.
        </Text>
        <Text style={styles.heroBody}>
          Monitor major crypto pairs, connect an external wallet, and follow
          S Coin network development. Market prices are informational only.
        </Text>
      </View>

      <View style={[styles.columns, compact && styles.columnsCompact]}>
        <View style={[styles.panel, styles.marketPanel]}>
          <View style={styles.panelHeading}>
            <View style={styles.panelHeadingCopy}>
              <Text style={styles.eyebrow}>BINANCE SPOT · PUBLIC DATA</Text>
              <Text style={styles.panelTitle}>Market watch</Text>
              <Text style={styles.muted}>
                Selected USDⓈ-quoted pairs · refreshes every 15 seconds
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={refreshing}
              onPress={() => void refreshMarkets()}
              style={[styles.refreshButton, refreshing && styles.disabled]}
            >
              {refreshing ? (
                <ActivityIndicator color={palette.accent} size="small" />
              ) : (
                <Text style={styles.refreshText}>↻ Refresh</Text>
              )}
            </Pressable>
          </View>

          {marketError ? (
            <View style={styles.warning}>
              <Text style={styles.warningTitle}>Market feed unavailable</Text>
              <Text style={styles.warningBody}>{marketError}</Text>
            </View>
          ) : null}

          {tickers.length === 0 && !marketError ? (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.accent} />
              <Text style={styles.muted}>Loading public market data…</Text>
            </View>
          ) : null}

          {tickers.map((ticker) => {
            const selected = ticker.symbol === selectedSymbol;
            const positive = Number(ticker.priceChangePercent) >= 0;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={ticker.symbol}
                onPress={() => setSelectedSymbol(ticker.symbol)}
                style={[
                  styles.marketRow,
                  selected && styles.marketRowSelected,
                ]}
              >
                <View style={styles.coinMark}>
                  <Text style={styles.coinMarkText}>
                    {ticker.symbol.slice(0, ticker.symbol.length - 4).slice(0, 1)}
                  </Text>
                </View>
                <View style={styles.marketIdentity}>
                  <Text style={styles.marketSymbol}>
                    {ticker.symbol.slice(0, ticker.symbol.length - 4)}
                  </Text>
                  <Text style={styles.marketPair}>{ticker.symbol}</Text>
                </View>
                <View style={styles.marketNumbers}>
                  <Text style={styles.marketPrice}>
                    {formatMarketPrice(ticker.lastPrice)}
                  </Text>
                  <Text
                    style={[
                      styles.marketChange,
                      positive ? styles.positive : styles.negative,
                    ]}
                  >
                    {formatMarketPercent(ticker.priceChangePercent)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <Text style={styles.sourceNote}>
            Source: Binance public market-data API. Prices can differ from an
            executable quote and may be delayed by network conditions.
          </Text>
        </View>

        <View style={styles.rightColumn}>
          <View style={styles.panel}>
            <Text style={styles.eyebrow}>NON-CUSTODIAL CONNECTIONS</Text>
            <Text style={styles.panelTitle}>Connect a wallet</Text>
            <Text style={styles.muted}>
              S Coin is a Cosmos chain. Use Keplr for S Coin; use MetaMask or
              another EVM wallet for Ethereum-compatible networks.
            </Text>

            {!browserWalletsAvailable ? (
              <View style={styles.warning}>
                <Text style={styles.warningTitle}>Mobile wallet session not configured</Text>
                <Text style={styles.warningBody}>
                  This build currently detects browser-injected wallets. A
                  native WalletConnect / MetaMask Connect session must be
                  configured before in-app mobile wallet pairing is available.
                </Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              disabled={!browserWalletsAvailable}
              onPress={() => void connectScoin()}
              style={[
                styles.walletButton,
                !browserWalletsAvailable && styles.disabled,
              ]}
            >
              <Text style={styles.walletButtonTitle}>Connect Keplr · S Coin</Text>
              <Text style={styles.walletButtonSub}>Native Cosmos account</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={!browserWalletsAvailable}
              onPress={() => void connectEvm()}
              style={[
                styles.walletButton,
                styles.walletButtonSecondary,
                !browserWalletsAvailable && styles.disabled,
              ]}
            >
              <Text style={styles.walletButtonTitle}>Connect MetaMask / EVM</Text>
              <Text style={styles.walletButtonSub}>Ethereum-compatible accounts</Text>
            </Pressable>

            {scoinWallet ? (
              <View style={styles.connectedWallet}>
                <Text style={styles.connectedLabel}>S COIN · CONNECTED</Text>
                <Text style={styles.connectedAddress}>
                  {shortenWalletAddress(scoinWallet.address)}
                </Text>
                <Text style={styles.connectedMeta}>
                  {scoinWallet.name} · {scoinWallet.chainId}
                </Text>
                <Pressable onPress={() => setScoinWallet(null)}>
                  <Text style={styles.disconnectText}>Clear local display</Text>
                </Pressable>
              </View>
            ) : null}

            {evmWallet ? (
              <View style={styles.connectedWallet}>
                <Text style={styles.connectedLabel}>EVM · CONNECTED</Text>
                <Text style={styles.connectedAddress}>
                  {shortenWalletAddress(evmWallet.address)}
                </Text>
                <Text style={styles.connectedMeta}>
                  {evmWallet.name} · {evmWallet.chainId}
                </Text>
                <Pressable onPress={() => setEvmWallet(null)}>
                  <Text style={styles.disconnectText}>Clear local display</Text>
                </Pressable>
              </View>
            ) : null}

            {walletError ? (
              <Text accessibilityRole="alert" style={styles.inlineError}>
                {walletError}
              </Text>
            ) : null}

            <Text style={styles.sourceNote}>
              S Coin never asks for a seed phrase here. Connecting displays a
              public address only; this first stage does not sign or send funds.
            </Text>
          </View>

          <View style={styles.panel}>
            <View style={styles.swapHeading}>
              <View>
                <Text style={styles.eyebrow}>CONVERSION PREVIEW</Text>
                <Text style={styles.panelTitle}>Swap workspace</Text>
              </View>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>NOT LIVE</Text>
              </View>
            </View>
            <Text style={styles.muted}>
              Indicative price conversion for the selected Binance pair. This
              is not a swap quote and does not execute a trade.
            </Text>
            <Text style={styles.fieldLabel}>ASSET QUANTITY</Text>
            <TextInput
              accessibilityLabel="Asset quantity for indicative conversion"
              keyboardType="decimal-pad"
              onChangeText={setAmount}
              placeholder="1"
              placeholderTextColor={palette.muted}
              style={styles.amountInput}
              value={amount}
            />
            <View style={styles.conversionBox}>
              <Text style={styles.conversionLabel}>
                {selectedTicker ? selectedTicker.symbol : selectedSymbol}
              </Text>
              <Text style={styles.conversionValue}>
                {selectedTicker
                  ? "$" + indicativeValue + " USDT (indicative)"
                  : "Waiting for market price"}
              </Text>
            </View>
            <View style={styles.lockedButton}>
              <Text style={styles.lockedButtonText}>
                Instant swaps unlock after route and security setup
              </Text>
            </View>
            <Text style={styles.sourceNote}>
              Native S Coin needs a live DEX / IBC route. EVM swaps need a
              supported chain, a server-side aggregator key, and an external
              wallet to review and sign the transaction.
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const palette = {
  panel: "#121A19",
  panelRaised: "#17221F",
  border: "#263331",
  ink: "#ECF2EE",
  muted: "#91A19A",
  accent: "#C7E36B",
  positive: "#9DD889",
  negative: "#F28B82",
  warning: "#F4C46B",
};

const styles = StyleSheet.create({
  container: { gap: 18 },
  hero: {
    padding: 26,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#344334",
    backgroundColor: "#17251E",
    marginBottom: 4,
  },
  heroTag: { flexDirection: "row", alignItems: "center", gap: 8 },
  heroDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.accent,
  },
  heroTagText: {
    color: palette.accent,
    fontSize: 9,
    letterSpacing: 1.3,
    fontWeight: "800",
  },
  heroTitle: {
    color: palette.ink,
    fontSize: 28,
    lineHeight: 35,
    fontWeight: "800",
    marginTop: 16,
  },
  heroTitleCompact: { fontSize: 24, lineHeight: 30 },
  heroBody: {
    color: "#B7C3BC",
    fontSize: 12,
    lineHeight: 19,
    marginTop: 9,
    maxWidth: 620,
  },
  columns: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  columnsCompact: { flexDirection: "column" },
  panel: {
    flex: 1,
    minWidth: 0,
    padding: 19,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.panel,
    marginBottom: 16,
  },
  marketPanel: { flex: 1.05 },
  rightColumn: { flex: 0.95, minWidth: 0 },
  panelHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  panelHeadingCopy: { flex: 1, minWidth: 0 },
  eyebrow: {
    color: palette.accent,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  panelTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 6,
    marginBottom: 6,
  },
  muted: { color: palette.muted, fontSize: 10, lineHeight: 16 },
  refreshButton: {
    minHeight: 35,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshText: { color: palette.accent, fontSize: 10, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  warning: {
    padding: 12,
    borderRadius: 9,
    backgroundColor: "#2C2619",
    borderWidth: 1,
    borderColor: "#51452A",
    marginTop: 11,
    marginBottom: 7,
  },
  warningTitle: { color: palette.warning, fontSize: 11, fontWeight: "800" },
  warningBody: { color: "#D2C7A8", fontSize: 10, lineHeight: 16, marginTop: 5 },
  loading: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  marketRow: {
    minHeight: 61,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#202B29",
    borderRadius: 8,
  },
  marketRowSelected: { backgroundColor: "#1A2821" },
  coinMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#26352C",
  },
  coinMarkText: { color: palette.accent, fontSize: 14, fontWeight: "800" },
  marketIdentity: { flex: 1, minWidth: 0 },
  marketSymbol: { color: palette.ink, fontSize: 11, fontWeight: "800" },
  marketPair: { color: palette.muted, fontSize: 9, marginTop: 3 },
  marketNumbers: { alignItems: "flex-end" },
  marketPrice: { color: palette.ink, fontSize: 11, fontWeight: "700" },
  marketChange: { fontSize: 9, fontWeight: "700", marginTop: 4 },
  positive: { color: palette.positive },
  negative: { color: palette.negative },
  sourceNote: {
    color: "#687771",
    fontSize: 9,
    lineHeight: 15,
    marginTop: 13,
  },
  walletButton: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 9,
    backgroundColor: "#25372D",
    borderWidth: 1,
    borderColor: "#415B48",
    marginTop: 13,
    justifyContent: "center",
  },
  walletButtonSecondary: {
    backgroundColor: "#1D2729",
    borderColor: "#3A494A",
  },
  walletButtonTitle: { color: palette.ink, fontSize: 11, fontWeight: "800" },
  walletButtonSub: { color: palette.muted, fontSize: 9, marginTop: 4 },
  connectedWallet: {
    padding: 12,
    borderRadius: 9,
    backgroundColor: "#15241C",
    borderWidth: 1,
    borderColor: "#354C3D",
    marginTop: 12,
  },
  connectedLabel: {
    color: palette.accent,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1,
  },
  connectedAddress: {
    color: palette.ink,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 7,
  },
  connectedMeta: { color: palette.muted, fontSize: 9, marginTop: 5 },
  disconnectText: { color: palette.accent, fontSize: 9, marginTop: 8 },
  inlineError: {
    color: palette.negative,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 10,
  },
  swapHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 9,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#352B1D",
  },
  statusPillText: { color: palette.warning, fontSize: 8, fontWeight: "800" },
  fieldLabel: {
    color: palette.muted,
    fontSize: 8,
    letterSpacing: 1,
    fontWeight: "800",
    marginTop: 16,
    marginBottom: 7,
  },
  amountInput: {
    minHeight: 43,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#33413E",
    backgroundColor: "#0B1111",
    color: palette.ink,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  conversionBox: {
    padding: 13,
    borderRadius: 9,
    backgroundColor: palette.panelRaised,
    marginTop: 11,
  },
  conversionLabel: { color: palette.muted, fontSize: 9, fontWeight: "700" },
  conversionValue: { color: palette.ink, fontSize: 14, fontWeight: "800", marginTop: 5 },
  lockedButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: "#2B2A21",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 11,
    marginTop: 12,
  },
  lockedButtonText: {
    color: palette.warning,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
  },
});
