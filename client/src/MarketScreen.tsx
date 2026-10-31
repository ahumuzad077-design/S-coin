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
  cancelPaperOrder,
  getMarketOrderBook,
  getMarketOrders,
  getMarketPortfolio,
  getMarketSecurities,
  marketApiUrl,
  MarketOrder,
  MarketOrderBook,
  MarketPortfolio,
  MarketSecurity,
  placePaperOrder,
  previewSecurities,
} from "./markets";

type Props = { compact: boolean };
type Side = "BUY" | "SELL";

const C = {
  bg: "#080B0D", panel: "#111719", raised: "#161F20", border: "#253031",
  text: "#F1F7F2", muted: "#849493", accent: "#B7F36B", danger: "#FF8D82",
  buy: "#B7F36B", sell: "#FF9B91",
};

function money(value: number, currency = "UGX") {
  return new Intl.NumberFormat("en-UG", { maximumFractionDigits: 0 }).format(value) + " " + currency;
}
function pct(bps: number) {
  const v = bps / 100;
  return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
}

export function MarketScreen({ compact }: Props) {
  const [securities, setSecurities] = useState<MarketSecurity[]>(previewSecurities);
  const [symbol, setSymbol] = useState("DENG");
  const [book, setBook] = useState<MarketOrderBook | null>(null);
  const [portfolio, setPortfolio] = useState<MarketPortfolio | null>(null);
  const [orders, setOrders] = useState<MarketOrder[]>([]);
  const [side, setSide] = useState<Side>("BUY");
  const [quantity, setQuantity] = useState("10");
  const [limitPrice, setLimitPrice] = useState("125000");
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selected = useMemo(
    () => securities.find((item) => item.symbol === symbol) ?? securities[0],
    [securities, symbol],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSecurities, nextPortfolio, nextOrders] = await Promise.all([
        getMarketSecurities(), getMarketPortfolio(), getMarketOrders(),
      ]);
      setSecurities(nextSecurities);
      setPortfolio(nextPortfolio);
      setOrders(nextOrders.orders);
      setConnected(nextOrders.mode === "SIMULATION" && nextPortfolio.mode === "SIMULATION");
      setSymbol((current) => nextSecurities.some((item) => item.symbol === current) ? current : (nextSecurities[0]?.symbol ?? ""));
    } catch (err) {
      setConnected(false);
      setPortfolio(null);
      setOrders([]);
      setBook(null);
      setSecurities(previewSecurities);
      setError(err instanceof Error ? err.message : "Could not connect to the local Meridian simulator.");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshBook = useCallback(async () => {
    if (!connected || !symbol) return;
    try {
      setBook(await getMarketOrderBook(symbol));
    } catch (err) {
      setBook(null);
      setError(err instanceof Error ? err.message : "Could not load the simulated order book.");
    }
  }, [connected, symbol]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (selected) setLimitPrice(String(selected.lastPrice));
  }, [selected?.symbol, selected?.lastPrice]);
  useEffect(() => { void refreshBook(); }, [refreshBook]);

  async function submitOrder() {
    if (!selected) return;
    const qty = Number(quantity);
    const price = Number(limitPrice);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000000) {
      setError("Enter a whole-share quantity from 1 to 1,000,000.");
      return;
    }
    if (!Number.isSafeInteger(price) || price < 1) {
      setError("Enter a valid positive limit price in UGX.");
      return;
    }
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result = await placePaperOrder({ symbol: selected.symbol, side, quantity: qty, limitPrice: price });
      if (!result.paperTrade || result.mode !== "SIMULATION") throw new Error("The server did not confirm simulation-only mode.");
      const filled = result.fills.reduce((sum, fill) => sum + fill.quantity, 0);
      setNotice(filled > 0 ? "Paper order " + result.order.id + ": " + filled + " shares simulated across " + result.fills.length + " fill(s)." : "Paper order " + result.order.id + " posted to the simulated order book.");
      await refresh();
      setBook(await getMarketOrderBook(selected.symbol));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The simulated order could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelOrder(order: MarketOrder) {
    try {
      await cancelPaperOrder(order.id);
      setNotice("Simulated order " + order.id + " cancelled.");
      await refresh();
      await getMarketOrderBook(order.symbol).then(setBook);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The simulated order could not be cancelled.");
    }
  }

  const openOrders = orders.filter((o) => o.status === "OPEN" || o.status === "PARTIALLY_FILLED").length;
  const estimatedOrderValue = (Number(quantity) || 0) * (Number(limitPrice) || 0);

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>MERIDIAN · EAST AFRICA DEMO MARKET</Text>
          <Text style={s.title}>Markets, in motion.</Text>
          <Text style={s.sub}>A closed securities-market simulator embedded in S Coin. Every issuer, price, account and order is synthetic.</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => void refresh()} style={s.refresh}>
          {loading ? <ActivityIndicator color={C.accent} /> : <Text style={s.refreshText}>↻ Refresh</Text>}
        </Pressable>
      </View>

      <View style={s.warning}>
        <Text style={s.warningTitle}>SIMULATION ONLY · NOT A REGULATED EXCHANGE</Text>
        <Text style={s.warningText}>No real securities, deposits, withdrawals, investment money or settlement. Orders use fictional demo accounts.</Text>
      </View>

      {notice ? <Text accessibilityRole="alert" style={s.notice}>{notice}</Text> : null}
      {error ? <View style={s.error}><Text style={s.errorTitle}>{connected ? "Market request needs attention" : "Local market engine unavailable"}</Text><Text style={s.errorText}>{error}</Text><Text style={s.help}>Start the local API: cd exchange && go run ./cmd/meridian-demo</Text></View> : null}

      <View style={[s.stats, compact && s.stack]}>
        <Metric label="SYNTHETIC LISTINGS" value={String(securities.length)} detail="Fictional demo issuers" />
        <Metric label="OPEN PAPER ORDERS" value={connected ? String(openOrders) : "—"} detail="Demo investor only" />
        <Metric label="AVAILABLE PAPER CASH" value={portfolio ? money(portfolio.availableCash) : "—"} detail="Not withdrawable" accent />
      </View>

      <View style={[s.grid, compact && s.stack]}>
        <View style={[s.panel, s.universe]}>
          <Heading eyebrow="ISSUER UNIVERSE" title="Demo securities" detail="Select a synthetic instrument to inspect its market." />
          {securities.map((item) => {
            const active = item.symbol === symbol;
            return (
              <Pressable key={item.symbol} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setSymbol(item.symbol)} style={[s.security, active && s.securityActive]}>
                <View style={s.symbolIcon}><Text style={s.symbolIconText}>{item.symbol.slice(0, 1)}</Text></View>
                <View style={s.identity}>
                  <Text style={s.symbol}>{item.symbol}</Text>
                  <Text numberOfLines={1} style={s.name}>{item.name}</Text>
                  <Text style={s.sector}>{item.sector}</Text>
                </View>
                <View style={s.priceWrap}>
                  <Text style={s.price}>{money(item.lastPrice)}</Text>
                  <Text style={[s.change, item.changeBps >= 0 ? s.positive : s.negative]}>{pct(item.changeBps)}</Text>
                </View>
              </Pressable>
            );
          })}
          <Text style={s.footnote}>DEMO SYMBOLS ONLY · NOT LISTED SECURITIES</Text>
        </View>

        <View style={[s.right, compact && s.full]}>
          <View style={s.instrument}>
            <Text style={s.instrumentSymbol}>{selected?.symbol ?? "—"}</Text>
            <Text style={s.name}>{selected?.name ?? "Select a demo security"}</Text>
            <Text style={s.bigPrice}>{selected ? money(selected.lastPrice) : "—"}</Text>
            <Text style={[s.change, (selected?.changeBps ?? 0) >= 0 ? s.positive : s.negative]}>{selected ? pct(selected.changeBps) + " from reference" : "—"}</Text>
            <Text style={s.tag}>PAPER MARKET</Text>
          </View>
          <View style={s.panel}>
            <Heading eyebrow="PRICE DISCOVERY" title="Order book" detail="Best bids and asks · simulated price-time matching." />
            {!connected ? <Text style={s.empty}>Connect the local demo engine to load paper orders.</Text> : book ? (
              <View style={[s.bookGrid, compact && s.stack]}>
                <BookSide title="BIDS · BUYERS" rows={book.bids} positive />
                <BookSide title="ASKS · SELLERS" rows={book.asks} positive={false} />
              </View>
            ) : <ActivityIndicator color={C.accent} />}
          </View>
        </View>
      </View>

      <View style={[s.grid, compact && s.stack]}>
        <View style={[s.panel, s.trade]}>
          <Heading eyebrow="ORDER ENTRY" title="Place a paper order" detail="Limit orders only. No real money or shares are involved." />
          <View style={s.toggle}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: side === "BUY" }} onPress={() => setSide("BUY")} style={[s.side, side === "BUY" && s.buySelected]}><Text style={[s.sideText, side === "BUY" && s.buyText]}>BUY</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: side === "SELL" }} onPress={() => setSide("SELL")} style={[s.side, side === "SELL" && s.sellSelected]}><Text style={[s.sideText, side === "SELL" && s.sellText]}>SELL</Text></Pressable>
          </View>
          <Text style={s.label}>QUANTITY · WHOLE SHARES</Text>
          <TextInput accessibilityLabel="Order quantity in whole shares" keyboardType="number-pad" value={quantity} onChangeText={setQuantity} style={s.input} placeholder="10" placeholderTextColor={C.muted} />
          <Text style={s.label}>LIMIT PRICE · UGX PER SHARE</Text>
          <TextInput accessibilityLabel="Limit price in Ugandan shillings per share" keyboardType="number-pad" value={limitPrice} onChangeText={setLimitPrice} style={s.input} placeholder="125000" placeholderTextColor={C.muted} />
          <View style={s.estimate}><Text style={s.label}>ESTIMATED ORDER VALUE</Text><Text style={s.estimateValue}>{money(estimatedOrderValue)}</Text></View>
          <Pressable accessibilityRole="button" disabled={!connected || submitting || !selected} onPress={() => void submitOrder()} style={[s.submit, side === "SELL" && s.submitSell, (!connected || submitting) && s.disabled]}>
            {submitting ? <ActivityIndicator color={C.bg} /> : <Text style={s.submitText}>{connected ? "Simulate " + side.toLowerCase() + " order" : "Start simulator to trade"}</Text>}
          </Pressable>
          <Text style={s.footnote}>Orders are held in memory and reset when the demo server restarts.</Text>
        </View>

        <View style={[s.panel, s.trade]}>
          <Heading eyebrow="DEMO INVESTOR" title="Paper portfolio" detail="Synthetic cash and holdings · not withdrawable or redeemable." />
          {portfolio ? <>
            <View style={s.estimate}><Text style={s.label}>TOTAL INDICATIVE VALUE</Text><Text style={s.total}>{money(portfolio.totalValue)}</Text><Text style={s.footnote}>Cash + demo positions at the simulator's last price</Text></View>
            <CashRow label="Cash balance" value={money(portfolio.cashBalance)} />
            <CashRow label="Reserved cash" value={money(portfolio.reservedCash)} />
            <CashRow label="Available cash" value={money(portfolio.availableCash)} />
            <Text style={s.label}>POSITIONS</Text>
            {portfolio.positions.filter((p) => p.quantity > 0).map((p) => <View key={p.symbol} style={s.position}><View style={{ flex: 1 }}><Text style={s.symbol}>{p.symbol}</Text><Text style={s.sector}>{p.quantity.toLocaleString()} shares · {p.availableQuantity.toLocaleString()} available</Text></View><Text style={s.positionValue}>{money(p.marketValue)}</Text></View>)}
          </> : <Text style={s.empty}>Start the local market engine to load the demo portfolio.</Text>}
        </View>
      </View>

      <View style={s.panel}>
        <Heading eyebrow="ORDER MANAGEMENT" title="Recent paper orders" detail="Open orders can be cancelled. Completed fills remain in the session history." />
        {!connected ? <Text style={s.empty}>Order history appears when the local simulator is running.</Text> : orders.length ? orders.slice(0, 12).map((o) => <View key={o.id} style={s.orderRow}>
          <Text style={[s.orderSide, o.side === "BUY" ? s.buyText : s.sellText]}>{o.side}</Text>
          <View style={{ flex: 1 }}><Text style={s.symbol}>{o.symbol} · {o.id}</Text><Text style={s.sector}>{o.filledQuantity}/{o.quantity} filled · limit {money(o.limitPrice)} · {o.status}</Text></View>
          {(o.status === "OPEN" || o.status === "PARTIALLY_FILLED") ? <Pressable accessibilityRole="button" onPress={() => void cancelOrder(o)} style={s.cancel}><Text style={s.sellText}>Cancel</Text></Pressable> : null}
        </View>) : <Text style={s.empty}>No paper orders have been placed in this session.</Text>}
      </View>

      <View style={s.footer}>
        <Text style={s.footerTitle}>Market operator status: prototype only</Text>
        <Text style={s.footerText}>MERIDIAN is not licensed or approved to operate a securities exchange. This demo has no real issuers, order routing, broker membership, custody, central depository, clearing or settlement. Never enter wallet seeds, payment details or private keys.</Text>
        <Text style={s.footnote}>LOCAL DEMO API · {marketApiUrl}</Text>
      </View>
    </View>
  );
}

function Metric({ label, value, detail, accent = false }: { label: string; value: string; detail: string; accent?: boolean }) {
  return <View style={[s.metric, accent && s.metricAccent]}><Text style={s.label}>{label}</Text><Text style={[s.metricValue, accent && s.positive]}>{value}</Text><Text style={s.sector}>{detail}</Text></View>;
}
function Heading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return <View style={s.heading}><Text style={s.eyebrow}>{eyebrow}</Text><Text style={s.headingTitle}>{title}</Text>{detail ? <Text style={s.sector}>{detail}</Text> : null}</View>;
}
function CashRow({ label, value }: { label: string; value: string }) {
  return <View style={s.cashRow}><Text style={s.sector}>{label}</Text><Text style={s.positionValue}>{value}</Text></View>;
}
function BookSide({ title, rows, positive }: { title: string; rows: { price: number; quantity: number; orderCount: number }[]; positive: boolean }) {
  return <View style={{ flex: 1, minWidth: 0 }}><Text style={[s.bookTitle, positive ? s.buyText : s.sellText]}>{title}</Text><View style={s.bookRow}><Text style={s.sector}>PRICE</Text><Text style={s.sector}>SHARES</Text></View>{rows.slice(0, 5).map((row) => <View key={title + row.price} style={s.bookRow}><Text style={[s.positionValue, positive ? s.buyText : s.sellText]}>{money(row.price)}</Text><Text style={s.positionValue}>{row.quantity.toLocaleString()}</Text></View>)}{!rows.length ? <Text style={s.sector}>No resting orders</Text> : null}</View>;
}

const s = StyleSheet.create({
  wrap: { gap: 16 },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  eyebrow: { color: C.accent, fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  title: { color: C.text, fontSize: 28, fontWeight: "800", marginTop: 7 },
  sub: { color: C.muted, fontSize: 11, lineHeight: 18, marginTop: 7, maxWidth: 700 },
  refresh: { minHeight: 38, borderColor: C.border, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, justifyContent: "center" },
  refreshText: { color: C.text, fontSize: 10, fontWeight: "700" },
  warning: { backgroundColor: "#251E13", borderWidth: 1, borderColor: "#594523", borderRadius: 11, padding: 13, gap: 5 },
  warningTitle: { color: "#F1C56A", fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  warningText: { color: "#C8B99C", fontSize: 10, lineHeight: 16 },
  notice: { color: C.accent, backgroundColor: "#111A14", borderRadius: 8, padding: 10, fontSize: 10 },
  error: { backgroundColor: "#281A1A", borderRadius: 10, borderWidth: 1, borderColor: "#5B302D", padding: 13, gap: 5 },
  errorTitle: { color: C.danger, fontSize: 11, fontWeight: "800" },
  errorText: { color: "#E8C3C0", fontSize: 10, lineHeight: 16 },
  help: { color: C.accent, fontSize: 9, marginTop: 3 },
  stats: { flexDirection: "row", gap: 11 },
  stack: { flexDirection: "column" },
  metric: { flex: 1, minWidth: 0, borderRadius: 11, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, padding: 14, minHeight: 95 },
  metricAccent: { backgroundColor: "#141E18", borderColor: "#344D37" },
  metricValue: { color: C.text, fontSize: 20, fontWeight: "800", marginTop: 14 },
  grid: { flexDirection: "row", alignItems: "flex-start", gap: 13 },
  panel: { backgroundColor: C.panel, borderRadius: 13, borderWidth: 1, borderColor: C.border, padding: 16 },
  universe: { flex: 1.05, minWidth: 0 },
  right: { flex: 1.2, minWidth: 0, gap: 13 },
  full: { width: "100%" },
  heading: { marginBottom: 12 },
  headingTitle: { color: C.text, fontSize: 15, fontWeight: "700", marginTop: 5 },
  label: { color: C.muted, fontSize: 8, fontWeight: "800", letterSpacing: 0.8, marginTop: 10 },
  sector: { color: C.muted, fontSize: 8, marginTop: 3 },
  security: { minHeight: 67, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "#202B2C", paddingVertical: 8, paddingHorizontal: 4, gap: 8, borderRadius: 7 },
  securityActive: { backgroundColor: "#18231D" },
  symbolIcon: { width: 29, height: 29, borderRadius: 8, backgroundColor: "#1B2820", alignItems: "center", justifyContent: "center" },
  symbolIconText: { color: C.accent, fontSize: 12, fontWeight: "900" },
  identity: { flex: 1, minWidth: 0 },
  symbol: { color: C.text, fontSize: 10, fontWeight: "800" },
  name: { color: "#B2BFBA", fontSize: 8, marginTop: 3 },
  priceWrap: { alignItems: "flex-end", maxWidth: 104 },
  price: { color: C.text, fontSize: 9, fontWeight: "800" },
  change: { fontSize: 9, fontWeight: "800", marginTop: 4 },
  positive: { color: C.accent },
  negative: { color: C.danger },
  footnote: { color: "#66736F", fontSize: 7, letterSpacing: 0.4, marginTop: 10, lineHeight: 12 },
  instrument: { backgroundColor: "#15201D", borderWidth: 1, borderColor: "#304238", borderRadius: 13, padding: 16 },
  instrumentSymbol: { color: C.text, fontSize: 18, fontWeight: "900" },
  bigPrice: { color: C.text, fontSize: 27, fontWeight: "900", marginTop: 16 },
  tag: { color: C.accent, fontSize: 7, fontWeight: "900", marginTop: 12 },
  bookGrid: { flexDirection: "row", gap: 11 },
  bookTitle: { fontSize: 8, fontWeight: "900", marginBottom: 8 },
  bookRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#202B2C", gap: 5 },
  empty: { color: C.muted, fontSize: 10, lineHeight: 16, paddingVertical: 12 },
  trade: { flex: 1, minWidth: 0 },
  toggle: { flexDirection: "row", gap: 8, marginBottom: 12 },
  side: { flex: 1, minHeight: 36, borderRadius: 7, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  buySelected: { backgroundColor: "#1A2B1C", borderColor: "#496E43" },
  sellSelected: { backgroundColor: "#2B1D1B", borderColor: "#71413A" },
  sideText: { color: C.muted, fontSize: 9, fontWeight: "900" },
  buyText: { color: C.buy },
  sellText: { color: C.sell },
  input: { minHeight: 42, borderRadius: 7, borderWidth: 1, borderColor: "#334040", backgroundColor: "#0B1011", color: C.text, paddingHorizontal: 11, fontSize: 11, marginTop: 6 },
  estimate: { marginTop: 12, marginBottom: 12, borderRadius: 8, backgroundColor: "#0C1212", padding: 10 },
  estimateValue: { color: C.text, fontSize: 14, fontWeight: "800", marginTop: 5 },
  submit: { minHeight: 42, borderRadius: 7, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  submitSell: { backgroundColor: "#F0A096" },
  submitText: { color: "#0B130B", fontSize: 9, fontWeight: "900" },
  disabled: { opacity: 0.5 },
  total: { color: C.text, fontSize: 22, fontWeight: "900", marginTop: 5 },
  cashRow: { minHeight: 31, borderBottomWidth: 1, borderBottomColor: "#202B2C", flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  position: { minHeight: 43, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderTopColor: "#202B2C" },
  positionValue: { color: C.text, fontSize: 8, fontWeight: "700" },
  orderRow: { minHeight: 55, flexDirection: "row", alignItems: "center", borderTopWidth: 1, borderTopColor: "#202B2C", gap: 9, paddingVertical: 7 },
  orderSide: { width: 38, textAlign: "center", fontSize: 8, fontWeight: "900" },
  cancel: { borderWidth: 1, borderColor: "#69413D", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 },
  footer: { padding: 14, borderRadius: 10, backgroundColor: "#101516", borderWidth: 1, borderColor: C.border },
  footerTitle: { color: C.text, fontSize: 10, fontWeight: "800" },
  footerText: { color: C.muted, fontSize: 8, lineHeight: 14, marginTop: 6 },
});
