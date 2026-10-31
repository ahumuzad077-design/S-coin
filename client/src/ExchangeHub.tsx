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
  fetchBinanceMarketDetails,
  fetchBinanceTickers,
  formatMarketPercent,
  formatMarketPrice,
  subscribeBinanceTickers,
  type BinanceCandle,
  type BinanceMarketDetails,
  type BinanceStreamStatus,
} from "./marketData";
import {
  WalletConnection,
  connectEvmWallet,
  connectScoinWallet,
  disconnectEvmWallet,
  getErc20TokenDecimals,
  shortenWalletAddress,
  subscribeEvmWalletChanges,
} from "./walletAdapters";
import {
  formatTokenUnits,
  parseTokenUnits,
  requestCosmosRoutePreview,
  requestEvmSwapQuote,
  type CosmosRoutePreviewResponse,
} from "./swapApi";
import type { EvmSwapQuoteResponse } from "./swapApi";
import {
  CoinBalance,
  formatScoin,
  getAccountBalances,
} from "./chain";

interface ExchangeHubProps {
  chainId: string;
  compact: boolean;
  apiUrl: string;
}

export function ExchangeHub({ chainId, compact, apiUrl }: ExchangeHubProps) {
  const [tickers, setTickers] = useState<BinanceTicker[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [streamStatus, setStreamStatus] = useState<BinanceStreamStatus>("connecting");
  const [searchTerm, setSearchTerm] = useState("");
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);
  const [evmWallet, setEvmWallet] = useState<WalletConnection | null>(null);
  const [scoinWallet, setScoinWallet] = useState<WalletConnection | null>(null);
  const [scoinBalances, setScoinBalances] = useState<CoinBalance[] | null>(null);
  const [scoinBalanceError, setScoinBalanceError] = useState("");
  const [walletError, setWalletError] = useState("");
  const [amount, setAmount] = useState("1");
  const [selectedSymbol, setSelectedSymbol] = useState("BTCUSDT");
  const [marketDetails, setMarketDetails] = useState<BinanceMarketDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [sellToken, setSellToken] = useState("");
  const [buyToken, setBuyToken] = useState("");
  const [sellAmount, setSellAmount] = useState("1");
  const [sellDecimals, setSellDecimals] = useState("18");
  const [buyDecimals, setBuyDecimals] = useState("18");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [evmQuote, setEvmQuote] = useState<EvmSwapQuoteResponse | null>(null);
  const [cosmosSourceChainId, setCosmosSourceChainId] = useState("");
  const [cosmosDestChainId, setCosmosDestChainId] = useState("");
  const [cosmosSourceDenom, setCosmosSourceDenom] = useState("");
  const [cosmosDestDenom, setCosmosDestDenom] = useState("");
  const [cosmosAmountIn, setCosmosAmountIn] = useState("1000000");
  const [cosmosRouteLoading, setCosmosRouteLoading] = useState(false);
  const [cosmosRouteError, setCosmosRouteError] = useState("");
  const [cosmosRoute, setCosmosRoute] = useState<CosmosRoutePreviewResponse | null>(null);

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
    const snapshotTimer = setInterval(() => void refreshMarkets(), 5 * 60 * 1000);
    const unsubscribe = subscribeBinanceTickers(
      (nextTickers) => setTickers((current) => {
        const merged = new Map<string, BinanceTicker>();
        for (const ticker of current) merged.set(ticker.symbol, ticker);
        for (const ticker of nextTickers) merged.set(ticker.symbol, ticker);
        return Array.from(merged.values()).sort(
          (left, right) => Number(right.quoteVolume) - Number(left.quoteVolume),
        );
      }),
      setStreamStatus,
    );

    return () => {
      clearInterval(snapshotTimer);
      unsubscribe();
    };
  }, [refreshMarkets]);

  useEffect(() => {
    if (!scoinWallet) {
      setScoinBalances(null);
      setScoinBalanceError("");
      return undefined;
    }

    let cancelled = false;
    setScoinBalances(null);
    setScoinBalanceError("");

    void getAccountBalances(apiUrl, scoinWallet.address)
      .then((balances) => {
        if (!cancelled) setScoinBalances(balances);
      })
      .catch((error) => {
        if (!cancelled) {
          setScoinBalanceError(
            error instanceof Error
              ? error.message
              : "Could not read this S Coin account balance.",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiUrl, scoinWallet]);

  useEffect(() => {
    if (!evmWallet) return undefined;
    return subscribeEvmWalletChanges(() => {
      setEvmWallet(null);
      setEvmQuote(null);
      setQuoteError("Your EVM wallet account or network changed. Reconnect and request a fresh quote.");
    });
  }, [evmWallet]);

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

  const visibleTickers = useMemo(
    () => (searchTerm.trim() ? filteredTickers : filteredTickers.slice(0, 100)),
    [filteredTickers, searchTerm],
  );

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

  useEffect(() => {
    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError("");
    setMarketDetails(null);

    void fetchBinanceMarketDetails(selectedSymbol)
      .then((details) => {
        if (!cancelled) setMarketDetails(details);
      })
      .catch((error) => {
        if (!cancelled) {
          setDetailsError(
            error instanceof Error ? error.message : "Could not load order book and recent trades.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  const candleRange = useMemo(() => {
    const values = marketDetails?.candles.map((candle) => Number(candle.close)) ?? [];
    if (values.length === 0) return { min: 0, max: 0 };
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [marketDetails]);


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

  const clearEvmWallet = async () => {
    try {
      await disconnectEvmWallet();
      setEvmWallet(null);
      setEvmQuote(null);
      setQuoteError("");
      setWalletError("");
    } catch (error) {
      setWalletError(
        error instanceof Error ? error.message : "Could not disconnect the EVM wallet.",
      );
    }
  };

  const getCosmosRoutePreview = async () => {
    setCosmosRouteLoading(true);
    setCosmosRouteError("");
    setCosmosRoute(null);
    try {
      if (!swapApiBaseUrl.trim()) {
        throw new Error("The server-side swap quote service has not been configured for this app.");
      }
      const route = await requestCosmosRoutePreview(swapApiBaseUrl, {
        sourceAssetChainId: cosmosSourceChainId.trim(),
        sourceAssetDenom: cosmosSourceDenom.trim(),
        destAssetChainId: cosmosDestChainId.trim(),
        destAssetDenom: cosmosDestDenom.trim(),
        amountIn: cosmosAmountIn.trim(),
      });
      setCosmosRoute(route);
    } catch (error) {
      setCosmosRouteError(
        error instanceof Error ? error.message : "Could not obtain a Cosmos/IBC route preview.",
      );
    } finally {
      setCosmosRouteLoading(false);
    }
  };

  const detectTokenDecimals = async (
    tokenAddress: string,
    setDecimals: (value: string) => void,
    label: string,
  ) => {
    setQuoteError("");
    setEvmQuote(null);
    try {
      if (!evmWallet) {
        throw new Error("Connect an EVM wallet before reading token metadata.");
      }
      const decimals = await getErc20TokenDecimals(tokenAddress.trim(), evmWallet.chainId);
      setDecimals(String(decimals));
    } catch (error) {
      setQuoteError(
        error instanceof Error ? error.message : "Could not read " + label + " decimals.",
      );
    }
  };

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
            <Text style={styles.tableLabel}>
              {searchTerm.trim() || watchlistOnly
                ? visibleTickers.length + " MATCHES"
                : "TOP " + visibleTickers.length + " OF " + filteredTickers.length + " USDT PAIRS"}
            </Text>
            <Text style={styles.tableLabel}>{watchlist.length} WATCHLISTED</Text>
          </View>

          {visibleTickers.map((ticker) => {
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

          {selectedTicker ? (
            <View style={styles.marketDetailsPanel}>
              <View style={styles.detailHeader}>
                <View>
                  <Text style={styles.eyebrow}>MARKET MICROSTRUCTURE</Text>
                  <Text style={styles.detailTitle}>{selectedTicker.symbol} · live market details</Text>
                </View>
                {detailsLoading ? (
                  <ActivityIndicator color={palette.accent} size="small" />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setDetailsLoading(true);
                      setDetailsError("");
                      void fetchBinanceMarketDetails(selectedSymbol)
                        .then(setMarketDetails)
                        .catch((error) => setDetailsError(
                          error instanceof Error ? error.message : "Could not refresh market details.",
                        ))
                        .finally(() => setDetailsLoading(false));
                    }}
                    style={styles.refreshButton}
                  >
                    <Text style={styles.refreshText}>↻ Refresh</Text>
                  </Pressable>
                )}
              </View>

              {detailsError ? (
                <Text accessibilityRole="alert" style={styles.inlineError}>{detailsError}</Text>
              ) : null}

              {marketDetails ? (
                <>
                  <Text style={styles.detailSectionLabel}>24 × 1H CANDLES · CLOSE PRICE HISTORY</Text>
                  <View style={styles.candleChart}>
                    {marketDetails.candles.map((candle: BinanceCandle) => {
                      const close = Number(candle.close);
                      const spread = Math.max(candleRange.max - candleRange.min, Math.abs(close) * 0.000001, 0.00000001);
                      const barHeight = Math.max(5, ((close - candleRange.min) / spread) * 54 + 5);
                      const rising = Number(candle.close) >= Number(candle.open);
                      return (
                        <View
                          key={candle.openTime}
                          style={[
                            styles.candleBar,
                            { height: barHeight },
                            rising ? styles.candleBarUp : styles.candleBarDown,
                          ]}
                        />
                      );
                    })}
                  </View>

                  <View style={styles.orderBookGrid}>
                    <View style={styles.orderBookColumn}>
                      <Text style={styles.detailSectionLabel}>TOP BIDS</Text>
                      {marketDetails.bids.slice(0, 8).map((level, index) => (
                        <View key={"bid-" + index} style={styles.orderBookRow}>
                          <Text style={styles.orderBookBid}>{formatMarketPrice(level.price)}</Text>
                          <Text style={styles.orderBookQuantity}>{Number(level.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</Text>
                        </View>
                      ))}
                    </View>
                    <View style={styles.orderBookColumn}>
                      <Text style={styles.detailSectionLabel}>TOP ASKS</Text>
                      {marketDetails.asks.slice(0, 8).map((level, index) => (
                        <View key={"ask-" + index} style={styles.orderBookRow}>
                          <Text style={styles.orderBookAsk}>{formatMarketPrice(level.price)}</Text>
                          <Text style={styles.orderBookQuantity}>{Number(level.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}</Text>
                        </View>
                      ))}
                    </View>
                  </View>

                  <Text style={styles.detailSectionLabel}>RECENT TRADES</Text>
                  {marketDetails.trades.slice(0, 8).map((trade) => (
                    <View key={trade.id} style={styles.recentTradeRow}>
                      <Text style={trade.buyerIsMaker ? styles.orderBookAsk : styles.orderBookBid}>
                        {trade.buyerIsMaker ? "SELL" : "BUY"}
                      </Text>
                      <Text style={styles.recentTradePrice}>{formatMarketPrice(trade.price)}</Text>
                      <Text style={styles.orderBookQuantity}>
                        {Number(trade.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </Text>
                      <Text style={styles.tradeTime}>
                        {new Date(trade.time).toLocaleTimeString()}
                      </Text>
                    </View>
                  ))}
                  <Text style={styles.sourceNote}>
                    Public order-book snapshot and recent trades from Binance.
                    This is market information only, not an executable order.
                  </Text>
                </>
              ) : detailsLoading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={palette.accent} />
                  <Text style={styles.muted}>Loading market depth and trade history…</Text>
                </View>
              ) : null}
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
                <Text style={styles.warningTitle}>Keplr is currently browser-only</Text>
                <Text style={styles.warningBody}>
                  MetaMask Connect is enabled for native Android and iOS
                  builds. Keplr still needs a supported mobile Cosmos wallet
                  session and a verified S Coin chain configuration.
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
              onPress={() => void connectEvm()}
              style={[styles.walletButton, styles.walletButtonSecondary]}
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
                {scoinBalances ? (
                  <View style={styles.scoinBalanceList}>
                    {scoinBalances.length > 0 ? scoinBalances.map((coin) => (
                      <View key={coin.denom} style={styles.scoinBalanceRow}>
                        <Text style={styles.scoinBalanceValue}>
                          {coin.denom === "uscoin" ? formatScoin(coin.amount) : coin.amount}
                        </Text>
                        <Text style={styles.scoinBalanceDenom}>
                          {coin.denom === "uscoin" ? "S" : coin.denom}
                        </Text>
                      </View>
                    )) : (
                      <Text style={styles.walletBalanceMuted}>No bank balances reported for this account.</Text>
                    )}
                  </View>
                ) : scoinBalanceError ? (
                  <Text style={styles.walletBalanceMuted}>
                    Balance unavailable: {scoinBalanceError}
                  </Text>
                ) : (
                  <Text style={styles.walletBalanceMuted}>Reading S Coin balance from the connected node…</Text>
                )}
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
                {typeof evmWallet.nativeBalance === "string" ? (
                  <Text style={styles.walletBalance}>
                    {evmWallet.nativeBalance} {evmWallet.nativeSymbol ?? "NATIVE"} available
                  </Text>
                ) : (
                  <Text style={styles.walletBalanceMuted}>
                    Native balance unavailable from this RPC
                  </Text>
                )}
                <Pressable onPress={() => void clearEvmWallet()}>
                  <Text style={styles.disconnectText}>
                    {evmWallet.name === "MetaMask Connect"
                      ? "Disconnect MetaMask session"
                      : "Clear connected address"}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {walletError ? (
              <Text accessibilityRole="alert" style={styles.inlineError}>
                {walletError}
              </Text>
            ) : null}

            <Text style={styles.sourceNote}>
              S Coin never asks for a recovery phrase here. Connecting displays
              a public address only; this release does not sign or send funds.
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
            <Pressable
              accessibilityRole="button"
              disabled={!evmWallet || !sellToken.trim()}
              onPress={() => void detectTokenDecimals(sellToken, setSellDecimals, "sell token")}
              style={[styles.detectButton, (!evmWallet || !sellToken.trim()) && styles.disabled]}
            >
              <Text style={styles.detectButtonText}>Read sell token decimals from contract</Text>
            </Pressable>
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
            <Pressable
              accessibilityRole="button"
              disabled={!evmWallet || !buyToken.trim()}
              onPress={() => void detectTokenDecimals(buyToken, setBuyDecimals, "buy token")}
              style={[styles.detectButton, (!evmWallet || !buyToken.trim()) && styles.disabled]}
            >
              <Text style={styles.detectButtonText}>Read buy token decimals from contract</Text>
            </Pressable>
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

          <View style={styles.panel}>
            <Text style={styles.eyebrow}>COSMOS · IBC ROUTE PREVIEW</Text>
            <Text style={styles.panelTitle}>Interchain swap route</Text>
            <Text style={styles.muted}>
              Preview routes supported by Skip Go. The provider must recognise
              both chain IDs and assets. S Coin is not enabled by default.
            </Text>
            <Text style={styles.fieldLabel}>SOURCE CHAIN ID</Text>
            <TextInput
              accessibilityLabel="Cosmos source chain ID"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => { setCosmosSourceChainId(value); setCosmosRoute(null); }}
              placeholder="e.g. osmosis-1"
              placeholderTextColor={palette.muted}
              style={styles.quoteInput}
              value={cosmosSourceChainId}
            />
            <Text style={styles.fieldLabel}>SOURCE DENOM</Text>
            <TextInput
              accessibilityLabel="Cosmos source denomination"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => { setCosmosSourceDenom(value); setCosmosRoute(null); }}
              placeholder="e.g. uosmo or ibc/…"
              placeholderTextColor={palette.muted}
              style={styles.quoteInput}
              value={cosmosSourceDenom}
            />
            <Text style={styles.fieldLabel}>DESTINATION CHAIN ID</Text>
            <TextInput
              accessibilityLabel="Cosmos destination chain ID"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => { setCosmosDestChainId(value); setCosmosRoute(null); }}
              placeholder="e.g. cosmoshub-4"
              placeholderTextColor={palette.muted}
              style={styles.quoteInput}
              value={cosmosDestChainId}
            />
            <Text style={styles.fieldLabel}>DESTINATION DENOM</Text>
            <TextInput
              accessibilityLabel="Cosmos destination denomination"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={(value) => { setCosmosDestDenom(value); setCosmosRoute(null); }}
              placeholder="e.g. uatom"
              placeholderTextColor={palette.muted}
              style={styles.quoteInput}
              value={cosmosDestDenom}
            />
            <Text style={styles.fieldLabel}>AMOUNT IN BASE UNITS</Text>
            <TextInput
              accessibilityLabel="Cosmos source amount in base units"
              keyboardType="number-pad"
              onChangeText={(value) => { setCosmosAmountIn(value); setCosmosRoute(null); }}
              placeholder="1000000"
              placeholderTextColor={palette.muted}
              style={styles.quoteInput}
              value={cosmosAmountIn}
            />
            <Pressable
              accessibilityRole="button"
              disabled={cosmosRouteLoading || !swapApiBaseUrl.trim()}
              onPress={() => void getCosmosRoutePreview()}
              style={[
                styles.quoteButton,
                (cosmosRouteLoading || !swapApiBaseUrl.trim()) && styles.disabled,
              ]}
            >
              {cosmosRouteLoading ? (
                <ActivityIndicator color="#0B130B" size="small" />
              ) : (
                <Text style={styles.quoteButtonText}>Preview Cosmos / IBC route</Text>
              )}
            </Pressable>
            {cosmosRouteError ? (
              <Text accessibilityRole="alert" style={styles.inlineError}>
                {cosmosRouteError}
              </Text>
            ) : null}
            {cosmosRoute ? (
              <View style={styles.quoteResult}>
                <Text style={styles.connectedLabel}>SKIP GO · ROUTE PREVIEW</Text>
                <Text style={styles.quoteResultValue}>
                  Estimated output: {cosmosRoute.route.estimated_amount_out}
                </Text>
                {cosmosRoute.route.summary ? (
                  <Text style={styles.muted}>{cosmosRoute.route.summary}</Text>
                ) : null}
                {cosmosRoute.route.chain_ids?.length ? (
                  <Text style={styles.quoteResultMeta}>
                    Route: {cosmosRoute.route.chain_ids.join(" → ")}
                  </Text>
                ) : null}
                {cosmosRoute.route.swap_price_impact_percent ? (
                  <Text style={styles.quoteResultMeta}>
                    Price impact: {cosmosRoute.route.swap_price_impact_percent}%
                  </Text>
                ) : null}
                {typeof cosmosRoute.route.estimated_route_duration_seconds === "number" ? (
                  <Text style={styles.quoteResultMeta}>
                    Estimated route time: {cosmosRoute.route.estimated_route_duration_seconds}s
                  </Text>
                ) : null}
                <Text style={styles.sourceNote}>
                  Route only. No Cosmos messages were generated, signed,
                  broadcast, or relayed.
                </Text>
              </View>
            ) : null}
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
  tableLabel: { color: palette.muted, fontSize: 8, fontWeight: "800", letterSpacing: 0.7 },
  favoriteButton: { paddingHorizontal: 6, paddingVertical: 8 },
  favoriteGlyph: { color: palette.muted, fontSize: 14 },
  favoriteGlyphActive: { color: palette.accent },
  emptyMarkets: { alignItems: "center", padding: 24, gap: 7 },
  emptyMarketsTitle: { color: palette.ink, fontSize: 12, fontWeight: "800" },
  marketDetailsPanel: { padding: 14, borderRadius: 10, backgroundColor: "#0F1715", borderWidth: 1, borderColor: palette.border, marginTop: 12 },
  detailHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  detailTitle: { color: palette.ink, fontSize: 11, fontWeight: "800", marginTop: 5 },
  detailSectionLabel: { color: palette.muted, fontSize: 8, fontWeight: "800", letterSpacing: 0.8, marginTop: 14, marginBottom: 7 },
  candleChart: { height: 66, flexDirection: "row", alignItems: "flex-end", gap: 3, paddingHorizontal: 3 },
  candleBar: { flex: 1, borderRadius: 2, minWidth: 2 },
  candleBarUp: { backgroundColor: "#88C47A" },
  candleBarDown: { backgroundColor: "#C86F67" },
  orderBookGrid: { flexDirection: "row", gap: 12, marginTop: 2 },
  orderBookColumn: { flex: 1, minWidth: 0 },
  orderBookRow: { minHeight: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4 },
  orderBookBid: { color: palette.positive, fontSize: 8, fontWeight: "700" },
  orderBookAsk: { color: palette.negative, fontSize: 8, fontWeight: "700" },
  orderBookQuantity: { color: palette.muted, fontSize: 8 },
  recentTradeRow: { minHeight: 26, flexDirection: "row", alignItems: "center", gap: 8, borderTopWidth: 1, borderTopColor: "#202B29" },
  recentTradePrice: { flex: 1, color: palette.ink, textAlign: "right", fontSize: 8, fontWeight: "700" },
  tradeTime: { color: palette.muted, fontSize: 7, minWidth: 55, textAlign: "right" },
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
  walletBalance: { color: palette.positive, fontSize: 10, fontWeight: "800", marginTop: 8 },
  walletBalanceMuted: { color: palette.muted, fontSize: 9, marginTop: 8 },
  scoinBalanceList: { gap: 6, marginTop: 8 },
  scoinBalanceRow: { flexDirection: "row", alignItems: "baseline", gap: 7 },
  scoinBalanceValue: { color: palette.positive, fontSize: 12, fontWeight: "800" },
  scoinBalanceDenom: { color: palette.muted, fontSize: 9, fontWeight: "700" },
  disconnectText: { color: palette.accent, fontSize: 9, marginTop: 8 },
  inlineError: {
    color: palette.negative,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 10,
  },
  quoteDivider: { height: 1, backgroundColor: palette.border, marginVertical: 17 },
  detectButton: { minHeight: 32, alignSelf: "flex-start", paddingHorizontal: 9, justifyContent: "center", borderRadius: 7, borderWidth: 1, borderColor: palette.border, marginTop: 7 },
  detectButtonText: { color: palette.accent, fontSize: 8, fontWeight: "700" },
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
