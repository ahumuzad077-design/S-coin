import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  cancelBinanceTestnetOrder,
  getBinanceTestnetAccount,
  getBinanceTestnetOpenOrders,
  getBinanceTestnetOrderHistory,
  placeBinanceTestnetOrder,
  validateBinanceTestnetOrder,
  type BinanceTestnetAccount,
  type BinanceTestnetOpenOrder,
  type BinanceTestnetOrder,
  type BinanceTestnetOrderRequest,
} from "./binanceTestnet";
import {
  clearBinanceTestnetCredentials,
  loadBinanceTestnetCredentials,
  saveBinanceTestnetCredentials,
  type BinanceTestnetCredentials,
} from "./binanceCredentialStore";

interface BinanceTestnetPanelProps {
  selectedMarket?: string;
}

const colors = {
  accent: "#B7D98B",
  background: "#101718",
  border: "#293536",
  ink: "#E5EDEA",
  muted: "#93A09D",
  red: "#EF8E83",
  panel: "#121A1B",
  panelRaised: "#182322",
};

export function BinanceTestnetPanel({ selectedMarket = "BTCUSDT" }: BinanceTestnetPanelProps) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [connected, setConnected] = useState(false);
  const [credentials, setCredentials] = useState<BinanceTestnetCredentials | null>(null);
  const [account, setAccount] = useState<BinanceTestnetAccount | null>(null);
  const [openOrders, setOpenOrders] = useState<BinanceTestnetOpenOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<BinanceTestnetOrder[]>([]);
  const [symbol, setSymbol] = useState(selectedMarket);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("0.001");
  const [price, setPrice] = useState("");
  const [validatedOrder, setValidatedOrder] = useState<BinanceTestnetOrderRequest | null>(null);
  const [lastOrder, setLastOrder] = useState<BinanceTestnetOrder | null>(null);
  const [pendingCancel, setPendingCancel] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSymbol(selectedMarket.toUpperCase());
  }, [selectedMarket]);

  const refreshAccount = useCallback(async (providedCredentials?: BinanceTestnetCredentials) => {
    const activeCredentials = providedCredentials ?? credentials;
    if (!activeCredentials) {
      setError("Connect a Binance Spot Testnet API key first.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const nextAccount = await getBinanceTestnetAccount(activeCredentials);
      setAccount(nextAccount);
      setConnected(true);
      const [orders, history] = await Promise.all([
        getBinanceTestnetOpenOrders(symbol.trim() || undefined, activeCredentials),
        symbol.trim() ? getBinanceTestnetOrderHistory(symbol.trim(), activeCredentials) : Promise.resolve([]),
      ]);
      setOpenOrders(orders);
      setOrderHistory(history.slice(-10).reverse());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not connect to Binance Spot Testnet.",
      );
    } finally {
      setLoading(false);
    }
  }, [symbol, credentials]);

  useEffect(() => {
    let active = true;
    void loadBinanceTestnetCredentials()
      .then((savedCredentials) => {
        if (active && savedCredentials) {
          setCredentials(savedCredentials);
          setConnected(true);
        }
      })
      .catch((storageError) => {
        if (active) setError(
          storageError instanceof Error
            ? storageError.message
            : "Could not read the locally stored testnet credentials.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (connected && credentials) {
      void refreshAccount(credentials);
    }
  }, [connected, credentials, symbol, refreshAccount]);

  const nonZeroBalances = useMemo(
    () => (account?.balances ?? []).filter(
      (balance) => Number(balance.free) > 0 || Number(balance.locked) > 0,
    ).slice(0, 12),
    [account],
  );

  const connect = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const nextCredentials = { apiKey, apiSecret };
      await saveBinanceTestnetCredentials(nextCredentials);
      setCredentials(nextCredentials);
      setApiKey("");
      setApiSecret("");
      setConnected(true);
      setNotice("Credentials saved locally. Verifying your Binance Spot Testnet account…");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not validate these Binance Spot Testnet credentials.",
      );
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    setLoading(true);
    try {
      await clearBinanceTestnetCredentials();
      setCredentials(null);
      setConnected(false);
      setAccount(null);
      setOpenOrders([]);
      setOrderHistory([]);
      setValidatedOrder(null);
      setLastOrder(null);
      setNotice("Testnet API credentials were removed from this app.");
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not clear testnet credentials.");
    } finally {
      setLoading(false);
    }
  };

  const currentOrder = (): BinanceTestnetOrderRequest => ({
    symbol,
    side,
    type: orderType,
    quantity,
    ...(orderType === "LIMIT" ? { price } : {}),
  });

  const testOrder = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    setValidatedOrder(null);
    setLastOrder(null);
    try {
      const order = currentOrder();
      if (!credentials) throw new Error("Connect a Binance Spot Testnet API key first.");
      const result = await validateBinanceTestnetOrder(order, credentials);
      if (!result.accepted) throw new Error(result.message);
      setValidatedOrder(order);
      setNotice("Order test passed. No order has been placed. Review the order and submit it separately.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Binance Testnet rejected the order validation.",
      );
    } finally {
      setLoading(false);
    }
  };

  const placeOrder = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      if (!credentials) throw new Error("Connect a Binance Spot Testnet API key first.");
      if (!validatedOrder) throw new Error("Test the order first and review its parameters.");
      const order = await placeBinanceTestnetOrder(validatedOrder, credentials);
      setLastOrder(order);
      setValidatedOrder(null);
      setNotice("Simulated Spot Testnet order submitted. No production funds were used.");
      const [nextAccount, nextOrders, history] = await Promise.all([
        getBinanceTestnetAccount(credentials),
        getBinanceTestnetOpenOrders(symbol.trim(), credentials),
        getBinanceTestnetOrderHistory(symbol.trim(), credentials),
      ]);
      setAccount(nextAccount);
      setOpenOrders(nextOrders);
      setOrderHistory(history.slice(-10).reverse());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not place the simulated testnet order.",
      );
    } finally {
      setLoading(false);
    }
  };

  const cancelOrder = async () => {
    setLoading(true);
    setError("");
    try {
      if (!credentials) throw new Error("Connect a Binance Spot Testnet API key first.");
      if (pendingCancel === null) throw new Error("Select an open order to cancel.");
      await cancelBinanceTestnetOrder(symbol.trim(), pendingCancel, credentials);
      setPendingCancel(null);
      setNotice("Testnet cancellation request submitted.");
      setOpenOrders(await getBinanceTestnetOpenOrders(symbol.trim(), credentials));
      setOrderHistory((await getBinanceTestnetOrderHistory(symbol.trim(), credentials)).slice(-10).reverse());
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not cancel the testnet order.",
      );
    } finally {
      setLoading(false);
    }
  };

  const updateOrderField = (update: () => void) => {
    update();
    setValidatedOrder(null);
    setLastOrder(null);
    setNotice("");
  };

  return (
    <View style={styles.panel}>
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>BINANCE SPOT · TEST NETWORK</Text>
          <Text style={styles.title}>Testnet trading desk</Text>
          <Text style={styles.muted}>Practice account balances, MARKET/LIMIT orders and cancellations. No production funds.</Text>
        </View>
        <View style={styles.testnetBadge}>
          <Text style={styles.testnetBadgeText}>TESTNET ONLY</Text>
        </View>
      </View>

      {!connected ? (
        <>
          <Text style={styles.label}>SPOT TESTNET API KEY</Text>
          <TextInput
            accessibilityLabel="Binance Spot Testnet API key"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setApiKey}
            placeholder="Paste your testnet API key"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={apiKey}
          />
          <Text style={styles.label}>SPOT TESTNET SECRET</Text>
          <TextInput
            accessibilityLabel="Binance Spot Testnet API secret"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setApiSecret}
            placeholder="Paste your testnet API secret"
            placeholderTextColor={colors.muted}
            secureTextEntry
            style={styles.input}
            value={apiSecret}
          />
          <Pressable
            accessibilityRole="button"
            disabled={loading || !apiKey.trim() || !apiSecret.trim()}
            onPress={() => void connect()}
            style={[styles.primaryButton, (loading || !apiKey.trim() || !apiSecret.trim()) && styles.disabled]}
          >
            {loading ? <ActivityIndicator color="#0B130B" /> : <Text style={styles.primaryButtonText}>Connect Spot Testnet</Text>}
          </Pressable>
          <Text style={styles.smallPrint}>
            Create a key at testnet.binance.vision. Keys are stored in the device secure store on Android/iOS; in a browser they remain in memory for this session only. They are never sent to S Coin's servers.
          </Text>
        </>
      ) : (
        <>
          <View style={styles.accountRow}>
            <View>
              <Text style={styles.label}>TESTNET ACCOUNT</Text>
              <Text style={styles.accountState}>
                {account?.canTrade ? "TRADING PERMISSION ACTIVE" : "CONNECTED"}
              </Text>
            </View>
            <View style={styles.actions}>
              <Pressable onPress={() => void refreshAccount()} disabled={loading} style={styles.textButton}>
                <Text style={styles.textButtonText}>Refresh</Text>
              </Pressable>
              <Pressable onPress={() => void disconnect()} disabled={loading} style={styles.textButton}>
                <Text style={styles.textButtonDanger}>Disconnect</Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Available testnet balances</Text>
          {nonZeroBalances.length ? nonZeroBalances.map((balance) => (
            <View key={balance.asset} style={styles.balanceRow}>
              <Text style={styles.balanceAsset}>{balance.asset}</Text>
              <Text style={styles.balanceValue}>{Number(balance.free).toLocaleString(undefined, { maximumFractionDigits: 8 })}</Text>
              {Number(balance.locked) > 0 ? (
                <Text style={styles.balanceLocked}>{Number(balance.locked).toLocaleString(undefined, { maximumFractionDigits: 8 })} locked</Text>
              ) : null}
            </View>
          )) : (
            <Text style={styles.smallPrint}>No non-zero Spot Testnet balances were returned for this account.</Text>
          )}

          <View style={styles.separator} />
          <Text style={styles.sectionTitle}>Place a simulated spot order</Text>
          <Text style={styles.label}>SYMBOL</Text>
          <TextInput
            accessibilityLabel="Binance testnet order symbol"
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={(value) => updateOrderField(() => setSymbol(value.toUpperCase()))}
            placeholder="BTCUSDT"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={symbol}
          />
          <View style={styles.choiceRow}>
            <Pressable onPress={() => updateOrderField(() => setSide("BUY"))} style={[styles.choice, side === "BUY" && styles.choiceActive]}>
              <Text style={[styles.choiceText, side === "BUY" && styles.choiceTextActive]}>BUY</Text>
            </Pressable>
            <Pressable onPress={() => updateOrderField(() => setSide("SELL"))} style={[styles.choice, side === "SELL" && styles.choiceActive]}>
              <Text style={[styles.choiceText, side === "SELL" && styles.choiceTextActive]}>SELL</Text>
            </Pressable>
            <Pressable onPress={() => updateOrderField(() => setOrderType("MARKET"))} style={[styles.choice, orderType === "MARKET" && styles.choiceActive]}>
              <Text style={[styles.choiceText, orderType === "MARKET" && styles.choiceTextActive]}>MARKET</Text>
            </Pressable>
            <Pressable onPress={() => updateOrderField(() => setOrderType("LIMIT"))} style={[styles.choice, orderType === "LIMIT" && styles.choiceActive]}>
              <Text style={[styles.choiceText, orderType === "LIMIT" && styles.choiceTextActive]}>LIMIT</Text>
            </Pressable>
          </View>
          <Text style={styles.label}>QUANTITY</Text>
          <TextInput
            accessibilityLabel="Binance Spot Testnet order quantity"
            keyboardType="decimal-pad"
            onChangeText={(value) => updateOrderField(() => setQuantity(value))}
            placeholder="0.001"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={quantity}
          />
          {orderType === "LIMIT" ? (
            <>
              <Text style={styles.label}>LIMIT PRICE</Text>
              <TextInput
                accessibilityLabel="Binance Spot Testnet limit price"
                keyboardType="decimal-pad"
                onChangeText={(value) => updateOrderField(() => setPrice(value))}
                placeholder="Price in quote asset"
                placeholderTextColor={colors.muted}
                style={styles.input}
                value={price}
              />
            </>
          ) : null}
          {validatedOrder ? (
            <View style={styles.review}>
              <Text style={styles.reviewTitle}>TEST ORDER ACCEPTED</Text>
              <Text style={styles.smallPrint}>
                {validatedOrder.side} {validatedOrder.type} {validatedOrder.quantity} {validatedOrder.symbol}
                {validatedOrder.price ? " @ " + validatedOrder.price : ""}
              </Text>
              <Text style={styles.smallPrint}>This test endpoint validates the parameters only. It has not placed an order.</Text>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={loading || !symbol.trim() || !quantity.trim()}
            onPress={() => void testOrder()}
            style={[styles.secondaryButton, (loading || !symbol.trim() || !quantity.trim()) && styles.disabled]}
          >
            {loading && !validatedOrder ? <ActivityIndicator color={colors.ink} /> : <Text style={styles.secondaryButtonText}>Validate order on Testnet</Text>}
          </Pressable>
          {validatedOrder ? (
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={() => void placeOrder()}
              style={[styles.primaryButton, loading && styles.disabled]}
            >
              {loading ? <ActivityIndicator color="#0B130B" /> : <Text style={styles.primaryButtonText}>Place simulated Testnet order</Text>}
            </Pressable>
          ) : null}

          {lastOrder ? (
            <View style={styles.review}>
              <Text style={styles.reviewTitle}>ORDER #{lastOrder.orderId} · {lastOrder.status}</Text>
              <Text style={styles.smallPrint}>
                {lastOrder.side} {lastOrder.type} · executed {lastOrder.executedQty} / {lastOrder.origQty}
              </Text>
            </View>
          ) : null}

          <View style={styles.separator} />
          <Text style={styles.sectionTitle}>Open orders · {symbol}</Text>
          {openOrders.length ? openOrders.map((order) => (
            <View key={order.orderId} style={styles.orderRow}>
              <View style={styles.orderDetails}>
                <Text style={styles.orderTitle}>#{order.orderId} · {order.side} {order.type}</Text>
                <Text style={styles.smallPrint}>{order.origQty} @ {order.price} · {order.status}</Text>
              </View>
              <Pressable onPress={() => setPendingCancel(order.orderId)} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </View>
          )) : (
            <Text style={styles.smallPrint}>No open orders reported for this symbol.</Text>
          )}
          {pendingCancel !== null ? (
            <View style={styles.review}>
              <Text style={styles.reviewTitle}>CANCEL ORDER #{pendingCancel}?</Text>
              <Text style={styles.smallPrint}>This cancel request applies only to the Binance Spot Testnet.</Text>
              <View style={styles.choiceRow}>
                <Pressable onPress={() => setPendingCancel(null)} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Keep order</Text>
                </Pressable>
                <Pressable onPress={() => void cancelOrder()} style={styles.cancelButton}>
                  <Text style={styles.cancelButtonText}>Confirm cancellation</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          <Text style={styles.sectionTitle}>Recent orders · {symbol}</Text>
          {orderHistory.length ? orderHistory.slice(0, 8).map((order) => (
            <View key={order.orderId} style={styles.orderRow}>
              <View style={styles.orderDetails}>
                <Text style={styles.orderTitle}>#{order.orderId} · {order.side} {order.type}</Text>
                <Text style={styles.smallPrint}>{order.executedQty} / {order.origQty} · {order.status}</Text>
              </View>
            </View>
          )) : (
            <Text style={styles.smallPrint}>No recent testnet orders found.</Text>
          )}
          <Text style={styles.smallPrint}>
            This integration is hard-pinned to testnet.binance.vision. It has no production API host, withdrawal, margin or futures routes.
          </Text>
        </>
      )}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    padding: 20,
    marginBottom: 15,
  },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 18 },
  headingCopy: { flex: 1, gap: 6 },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  title: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  testnetBadge: { borderWidth: 1, borderColor: "#526A40", backgroundColor: "#1D2A1B", borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6 },
  testnetBadgeText: { color: colors.accent, fontSize: 8, fontWeight: "800", letterSpacing: 0.7 },
  label: { color: colors.muted, fontSize: 9, letterSpacing: 1.1, fontWeight: "800", marginTop: 12, marginBottom: 7 },
  input: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: "#0B1112", color: colors.ink, paddingHorizontal: 12, fontSize: 12 },
  primaryButton: { minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, marginTop: 12 },
  primaryButtonText: { color: "#0B130B", fontSize: 10, fontWeight: "800" },
  secondaryButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, marginTop: 10 },
  secondaryButtonText: { color: colors.ink, fontSize: 10, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  smallPrint: { color: colors.muted, fontSize: 9, lineHeight: 15, marginTop: 8 },
  accountRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 },
  accountState: { color: colors.accent, fontSize: 10, fontWeight: "800", marginTop: 4 },
  actions: { flexDirection: "row", gap: 12 },
  textButton: { paddingVertical: 8 },
  textButtonText: { color: colors.accent, fontSize: 10, fontWeight: "800" },
  textButtonDanger: { color: colors.red, fontSize: 10, fontWeight: "800" },
  sectionTitle: { color: colors.ink, fontSize: 12, fontWeight: "800", marginTop: 14, marginBottom: 6 },
  balanceRow: { minHeight: 33, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center", gap: 10 },
  balanceAsset: { color: colors.ink, fontSize: 10, fontWeight: "800", width: 55 },
  balanceValue: { color: colors.ink, fontSize: 10, flex: 1, textAlign: "right" },
  balanceLocked: { color: colors.muted, fontSize: 8, width: 70, textAlign: "right" },
  separator: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: 7, paddingVertical: 8, paddingHorizontal: 12 },
  choiceActive: { backgroundColor: "#293D2A", borderColor: colors.accent },
  choiceText: { color: colors.muted, fontSize: 9, fontWeight: "800" },
  choiceTextActive: { color: colors.accent },
  review: { backgroundColor: colors.panelRaised, borderRadius: 9, borderWidth: 1, borderColor: "#475D3E", padding: 12, marginTop: 12 },
  reviewTitle: { color: colors.accent, fontSize: 10, fontWeight: "800" },
  orderRow: { minHeight: 45, flexDirection: "row", alignItems: "center", gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  orderDetails: { flex: 1 },
  orderTitle: { color: colors.ink, fontSize: 10, fontWeight: "700" },
  cancelButton: { backgroundColor: "#492825", borderRadius: 7, paddingHorizontal: 10, paddingVertical: 8, marginTop: 8 },
  cancelButtonText: { color: "#FFC0B6", fontSize: 9, fontWeight: "800" },
  notice: { color: colors.accent, fontSize: 10, lineHeight: 16, marginTop: 12 },
  error: { color: colors.red, fontSize: 10, lineHeight: 16, marginTop: 12 },
});
