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
  subscribeBinanceTickers,
  type BinanceStreamStatus,
} from "./marketData";
import {
  WalletConnection,
  connectEvmWallet,
  connectScoinWallet,
  shortenWalletAddress,
} from "./walletAdapters";
import {
  EvmSwapQuoteResponse,
  formatTokenUnits,
  parseTokenUnits,
  requestEvmSwapQuote,
} from "./swapApi";

interface ExchangeHubProps {
  chainId: string;
  compact: boolean;
}

export function ExchangeHub({ chainId, compact }: ExchangeHubProps) {
  const [tickers, setTickers] = useState<BinanceTicker[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [streamStatus, setStreamStatus] = useState<BinanceStreamStatus>("connecting");
  const [searchTerm, setSearchTerm] = useState("");
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);
  const [evmWallet, setEvmWallet] = useState<WalletConnection | null>(null);
  const [scoinWallet, setScoinWallet] = useState<WalletConnection | null>(null);
  const [walletError, setWalletError] = useState("");
  const [amount, setAmount] = useState("1");
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [sellToken, setSellToken] = useState("");
  const [buyToken, setBuyToken] = useState("");
  const [sellAmount, setSellAmount] = useState("1");
  const [sellDecimals, setSellDecimals] = useState("18");
  const [buyDecimals, setBuyDecimals] = useState("18");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [evmQuote, setEvmQuote] = useState<EvmSwapQuoteResponse | null>(null);

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
    return subscribeBinanceTickers(
      (nextTickers) => setTickers((current) => {
        const merged = new Map(current.map((ticker) => [ticker.symbol, ticker]));
        for (const ticker of nextTickers) merged.set(ticker.symbol, ticker);
        return Array.from(merged.values()).sort(
          (left, right) => Number(right.quoteVolume) - Number(left.quoteVolume),
        );
      }),
      setStreamStatus,
    );
  }, [refreshMarkets]);

  const filteredTickers = useMemo(() => {
    const query = searchTerm.trim().toUpperCase();
    return tickers.filter((ticker) => {
      const matchesSearch =
        !query ||
        ticker.symbol.includes(query) ||
        ticker.symbol.replace(/USDT$/, "").includes(query);
      const matchesWatchlist = !watchlistOnly || watchlist.includes(ticker.symbol);
      return matchesSearch && matchesWatchlist;
    });
  }, [searchTerm, tickers, watchlist, watchlistOnly]);

  const toggleWatchlist = (symbol: string) => {
    setWatchlist((current) =>
      current.includes(symbol)
        ? current.filter((item) => item !== symbol)
        : [...current, symbol],
    );
  };

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
  const swapApiBaseUrl = process.env.EXPO_PUBLIC_SWAP_API_URL ?? "";

  const getEvmQuote = async () => {
    setQuoteLoading(true);
    setQuoteError("");
    setEvmQuote(null);
    try {
      if (!swapApiBaseUrl.trim()) {
        throw new Error("The server-side swap quote service has not been configured for this app.");
      }
      if (!evmWallet) {
        throw new Error("Connect an EVM wallet before requesting a swap quote.");
      }

      const numericChainId = evmWallet.chainId.startsWith("0x")
        ? Number.parseInt(evmWallet.chainId.slice(2), 16).toString()
        : evmWallet.chainId;
      if (!/^\d+$/.test(numericChainId)) {
        throw new Error("The connected EVM wallet returned an invalid network ID.");
      }

      const sellTokenAmount = parseTokenUnits(sellAmount, Number(sellDecimals));
      const quote = await requestEvmSwapQuote(swapApiBaseUrl, {
        chainId: numericChainId,
        sellToken: sellToken.trim(),
        buyToken: buyToken.trim(),
        sellAmount: sellTokenAmount,
        taker: evmWallet.address,
        slippageBps: 100,
      });
      setEvmQuote(quote);
    } catch (error) {
      setQuoteError(
        error instanceof Error ? error.message : "Could not obtain an EVM swap quote.",
      );
    } finally {
      setQuoteLoading(false);
    }
  };

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
                {streamStatus === "live"
                  ? "LIVE · Binance public WebSocket stream"
                  : streamStatus === "reconnecting"
                    ? "Reconnecting to live stream · REST snapshot remains available"
                    : "Connecting to Binance · REST snapshot remains available"}
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

          <View style={styles.marketFilters}>
            <TextInput
              accessibilityLabel="Search cryptocurrency markets"
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={setSearchTerm}
              placeholder="Search BTC, ETH, SOL…"
              placeholderTextColor={palette.muted}
              style={styles.searchInput}
              value={searchTerm}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: watchlistOnly }}
              onPress={() => setWatchlistOnly((current) => !current)}
              style={[styles.watchlistFilter, watchlistOnly && styles.watchlistFilterActive]}
            >
              <Text style={[styles.watchlistFilterText, watchlistOnly && styles.watchlistFilterTextActive]}>
                ★ Watchlist
              </Text>
            </Pressable>
          </View>

          <View style={styles.marketCountRow}>
            <Text style={styles.tableLabel}>{filteredTickers.length} MARKETS</Text>
            <Text style={styles.tableLabel}>{watchlist.length} WATCHLISTED</Text>
          </View>

          {filteredTickers.map((ticker) => {
            const selected = ticker.symbol === selectedSymbol;
            const favorite = watchlist.includes(ticker.symbol);
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={favorite ? "Remove from watchlist" : "Add to watchlist"}
                  onPress={() => toggleWatchlist(ticker.symbol)}
                  hitSlop={8}
                  style={styles.favoriteButton}
                >
                  <Text style={[styles.favoriteGlyph, favorite && styles.favoriteGlyphActive]}>
                    {favorite ? "★" : "☆"}
                  </Text>
                </Pressable>
              </Pressable>
            );
          })}

          {filteredTickers.length === 0 ? (
            <View style={styles.emptyMarkets}>
              <Text style={styles.emptyMarketsTitle}>No matching markets</Text>
              <Text style={styles.muted}>Try another symbol or clear the Watchlist filter.</Text>
            </View>
          ) : null}

          {selectedTicker ? (
            <View style={styles.selectedMarketCard}>
              <View style={styles.selectedMarketHeading}>
                <View>
                  <Text style={styles.eyebrow}>SELECTED MARKET</Text>
                  <Text style={styles.selectedMarketTitle}>
                    {selectedTicker.symbol.replace(/USDT$/, "")} / USDT
                  </Text>
                </View>
                <Text style={[
                  styles.selectedMarketPrice,
                  Number(selectedTicker.priceChangePercent) >= 0 ? styles.positive : styles.negative,
                ]}>
                  {formatMarketPrice(selectedTicker.lastPrice)}
                </Text>
              </View>
              <View style={styles.marketMetricGrid}>
                <View style={styles.marketMetric}>
                  <Text style={styles.marketMetricLabel}>24H CHANGE</Text>
                  <Text style={styles.marketMetricValue}>
                    {formatMarketPercent(selectedTicker.priceChangePercent)}
                  </Text>
                </View>
                <View style={styles.marketMetric}>
                  <Text style={styles.marketMetricLabel}>24H HIGH</Text>
                  <Text style={styles.marketMetricValue}>{formatMarketPrice(selectedTicker.highPrice)}</Text>
                </View>
                <View style={styles.marketMetric}>
                  <Text style={styles.marketMetricLabel}>24H LOW</Text>
                  <Text style={styles.marketMetricValue}>{formatMarketPrice(selectedTicker.lowPrice)}</Text>
                </View>
                <View style={styles.marketMetric}>
                  <Text style={styles.marketMetricLabel}>24H VOLUME</Text>
                  <Text style={styles.marketMetricValue}>
                    {Number(selectedTicker.quoteVolume).toLocaleString(undefined, { maximumFractionDigits: 0 })} USDT
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

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
            <View style={styles.quoteDivider} />
            <Text style={styles.eyebrow}>SERVER-SIDE EVM QUOTE</Text>
            <Text style={styles.muted}>
              Request a firm route quote through the protected S Coin quote
              service. Token addresses must be enabled in the server allowlist.
            </Text>
            <Text style={styles.fieldLabel}>SELL TOKEN CONTRACT</Text>
            <TextInput
              accessibilityLabel="Sell token contract address"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => { setSellToken(value); setEvmQuote(null); }}
              placeholder="0x…"
              placeholderTextColor={palette.muted}
              style={styles.quoteInput}
              value={sellToken}
            />
            <Text style={styles.fieldLabel}>BUY TOKEN CONTRACT</Text>
            <TextInput
              accessibilityLabel="Buy token contract address"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => { setBuyToken(value); setEvmQuote(null); }}
              placeholder="0x…"
              placeholderTextColor={palette.muted}
              style={styles.quoteInput}
              value={buyToken}
            />
            <View style={styles.quoteAmountRow}>
              <View style={styles.quoteAmountColumn}>
                <Text style={styles.fieldLabel}>SELL AMOUNT</Text>
                <TextInput
                  accessibilityLabel="Sell amount"
                  keyboardType="decimal-pad"
                  onChangeText={(value) => { setSellAmount(value); setEvmQuote(null); }}
                  placeholder="1"
                  placeholderTextColor={palette.muted}
                  style={styles.quoteInput}
                  value={sellAmount}
                />
              </View>
              <View style={styles.quoteAmountColumn}>
                <Text style={styles.fieldLabel}>SELL DECIMALS</Text>
                <TextInput
                  accessibilityLabel="Sell token decimals"
                  keyboardType="number-pad"
                  onChangeText={(value) => { setSellDecimals(value); setEvmQuote(null); }}
                  placeholder="18"
                  placeholderTextColor={palette.muted}
                  style={styles.quoteInput}
                  value={sellDecimals}
                />
              </View>
              <View style={styles.quoteAmountColumn}>
                <Text style={styles.fieldLabel}>BUY DECIMALS</Text>
                <TextInput
                  accessibilityLabel="Buy token decimals"
                  keyboardType="number-pad"
                  onChangeText={(value) => { setBuyDecimals(value); setEvmQuote(null); }}
                  placeholder="18"
                  placeholderTextColor={palette.muted}
                  style={styles.quoteInput}
                  value={buyDecimals}
                />
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={quoteLoading || !evmWallet || !swapApiBaseUrl.trim()}
              onPress={() => void getEvmQuote()}
              style={[
                styles.quoteButton,
                (quoteLoading || !evmWallet || !swapApiBaseUrl.trim()) && styles.disabled,
              ]}
            >
              {quoteLoading ? (
                <ActivityIndicator color="#0B130B" size="small" />
              ) : (
                <Text style={styles.quoteButtonText}>Get EVM swap quote</Text>
              )}
            </Pressable>
            {!swapApiBaseUrl.trim() ? (
              <Text style={styles.sourceNote}>
                Configure EXPO_PUBLIC_SWAP_API_URL after deploying the quote service.
                No API key belongs in this app.
              </Text>
            ) : null}
            {quoteError ? (
              <Text accessibilityRole="alert" style={styles.inlineError}>{quoteError}</Text>
            ) : null}
            {evmQuote ? (
              <View style={styles.quoteResult}>
                <Text style={styles.connectedLabel}>0x QUOTE · NOT EXECUTED</Text>
                <Text style={styles.quoteResultValue}>
                  {formatTokenUnits(
                    evmQuote.quote.buyAmount ?? "0",
                    Number(buyDecimals),
                  )} output tokens (estimated)
                </Text>
                <Text style={styles.muted}>
                  Minimum output: {formatTokenUnits(
                    evmQuote.quote.minBuyAmount ?? "0",
                    Number(buyDecimals),
                  )}
                </Text>
                <Text style={styles.quoteResultMeta}>
                  Network: {evmQuote.quote.chainId ?? "verified by provider"}
                </Text>
                {evmQuote.quote.issues?.allowance?.spender ? (
                  <Text style={styles.quoteWarning}>
                    Token approval may be required for spender {shortenWalletAddress(
                      evmQuote.quote.issues.allowance.spender,
                    )}. No approval has been requested.
                  </Text>
                ) : null}
                <Text style={styles.sourceNote}>
                  This is a firm quote response, not a completed swap. The
                  app has not signed, approved or broadcast the transaction.
                  Re-request a fresh quote immediately before any later execution.
                </Text>
              </View>
            ) : null}
            <Text style={styles.sourceNote}>
              Native S Coin needs a registered DEX / IBC route and liquidity.
              EVM execution is not enabled in this release; wallet approvals,
              transaction simulation, chain checks and explicit signing must
              be completed before funds can move.
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
  marketFilters: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 39, borderRadius: 8, borderWidth: 1, borderColor: palette.border, backgroundColor: "#0B1111", color: palette.ink, paddingHorizontal: 11, fontSize: 10 },
  watchlistFilter: { minHeight: 39, borderRadius: 8, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  watchlistFilterActive: { borderColor: "#506B3B", backgroundColor: "#1A2A20" },
  watchlistFilterText: { color: palette.muted, fontSize: 9, fontWeight: "700" },
  watchlistFilterTextActive: { color: palette.accent },
  marketCountRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  favoriteButton: { paddingHorizontal: 6, paddingVertical: 8 },
  favoriteGlyph: { color: palette.muted, fontSize: 14 },
  favoriteGlyphActive: { color: palette.accent },
  emptyMarkets: { alignItems: "center", padding: 24, gap: 7 },
  emptyMarketsTitle: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  selectedMarketCard: { padding: 13, borderRadius: 10, backgroundColor: palette.panelRaised, marginTop: 14, borderWidth: 1, borderColor: palette.border },
  selectedMarketHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  selectedMarketTitle: { color: palette.ink, fontSize: 13, fontWeight: "800", marginTop: 5 },
  selectedMarketPrice: { fontSize: 14, fontWeight: "800" },
  marketMetricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 14 },
  marketMetric: { minWidth: "44%", flexGrow: 1 },
  marketMetricLabel: { color: palette.muted, fontSize: 8, fontWeight: "800", letterSpacing: 0.7 },
  marketMetricValue: { color: palette.ink, fontSize: 10, fontWeight: "700", marginTop: 5 },
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
  quoteDivider: { height: 1, backgroundColor: palette.border, marginVertical: 17 },
  quoteInput: { minHeight: 40, borderRadius: 8, borderWidth: 1, borderColor: "#33413E", backgroundColor: "#0B1111", color: palette.ink, paddingHorizontal: 10, fontSize: 10 },
  quoteAmountRow: { flexDirection: "row", gap: 8 },
  quoteAmountColumn: { flex: 1, minWidth: 0 },
  quoteButton: { minHeight: 44, borderRadius: 8, backgroundColor: palette.accent, alignItems: "center", justifyContent: "center", marginTop: 15, paddingHorizontal: 12 },
  quoteButtonText: { color: "#0B130B", fontSize: 10, fontWeight: "800" },
  quoteResult: { padding: 13, borderRadius: 10, borderWidth: 1, borderColor: "#3A5142", backgroundColor: "#14221A", marginTop: 13, gap: 6 },
  quoteResultValue: { color: palette.ink, fontSize: 15, fontWeight: "800", marginTop: 5 },
  quoteResultMeta: { color: palette.muted, fontSize: 9, marginTop: 3 },
  quoteWarning: { color: palette.warning, fontSize: 9, lineHeight: 15, marginTop: 5 },
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
