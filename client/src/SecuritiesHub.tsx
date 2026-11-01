import { useMemo } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

type IntegrationCardProps = {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  actionLabel: string;
  url: string;
  tone?: "green" | "blue" | "amber";
};

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function IntegrationCard({
  eyebrow,
  title,
  description,
  status,
  actionLabel,
  url,
  tone = "green",
}: IntegrationCardProps) {
  const enabled = isHttpsUrl(url);
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <View style={styles.statusRow}>
        <View
          style={[
            styles.dot,
            tone === "blue" ? styles.blueDot : tone === "amber" ? styles.amberDot : null,
          ]}
        />
        <Text style={styles.status}>{status}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !enabled }}
        disabled={!enabled}
        onPress={() => {
          void Linking.openURL(url).catch(() =>
            Alert.alert("Could not open service", "Check the configured HTTPS service URL."),
          );
        }}
        style={[styles.button, !enabled && styles.buttonDisabled]}
      >
        <Text style={[styles.buttonText, !enabled && styles.buttonTextDisabled]}>
          {enabled ? actionLabel : "Configure HTTPS service URL"}
        </Text>
        <Text style={[styles.arrow, !enabled && styles.buttonTextDisabled]}>↗</Text>
      </Pressable>
    </View>
  );
}

export function SecuritiesHub() {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const sentinelUrl = process.env.EXPO_PUBLIC_SENTINEL_DASHBOARD_URL ?? "";
  const meridianUrl = process.env.EXPO_PUBLIC_MERIDIAN_ISSUER_PORTAL_URL ?? "";
  const cards = useMemo(
    () => [
      {
        eyebrow: "AI STOCKS & CRYPTO",
        title: "Sentinel AI Trading",
        description:
          "AI-assisted stock, ETF and crypto analysis, market research, risk checks, trade journaling and performance reporting. Alpaca is used for broker connectivity.",
        status: "Integrated service · paper trading by default",
        actionLabel: "Open Sentinel trading desk",
        url: sentinelUrl,
        tone: "blue" as const,
      },
      {
        eyebrow: "SECURITIES EXCHANGE",
        title: "MERIDIAN",
        description:
          "Issuer applications, company registration verification, compliance review, due-diligence workflow and auditable exchange-operator records.",
        status: "Issuer operations integrated · trading disabled",
        actionLabel: "Open MERIDIAN issuer portal",
        url: meridianUrl,
        tone: "green" as const,
      },
    ],
    [sentinelUrl, meridianUrl],
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, compact && styles.contentCompact]}
    >
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>S COIN / SECURITIES</Text>
        <Text style={styles.heroTitle}>Stocks, markets and AI.</Text>
        <Text style={styles.heroDescription}>
          A unified access point for S Coin's securities-market and AI trading
          services, kept separate from crypto-wallet custody and blockchain settlement.
        </Text>
      </View>

      <View style={[styles.grid, compact && styles.gridCompact]}>
        {cards.map((card) => (
          <IntegrationCard key={card.title} {...card} />
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Platform capabilities</Text>
        <Text style={styles.capability}>
          • Stock and ETF analysis, AI research, risk management and trade history.
        </Text>
        <Text style={styles.capability}>
          • Crypto market access remains available in the separate Markets section.
        </Text>
        <Text style={styles.capability}>
          • MERIDIAN issuer admission, company verification and compliance audit trail.
        </Text>
        <Text style={styles.capability}>
          • Future exchange listings, broker connectivity, order management, surveillance,
          clearing and settlement are reserved for the regulated-market release stages.
        </Text>
      </View>

      <View style={styles.warning}>
        <Text style={styles.warningTitle}>Important trading status</Text>
        <Text style={styles.warningText}>
          Sentinel defaults to broker paper trading. MERIDIAN does not currently
          list or trade securities. Do not treat a paper order, issuer application,
          market-data quote or AI recommendation as an executed investment.
        </Text>
      </View>
      <Text style={styles.footnote}>
        Service URLs are public HTTPS endpoints only. Never put API tokens,
        Alpaca credentials, private keys or bank credentials in Expo public variables.
      </Text>
    </ScrollView>
  );
}

const palette = {
  background: "#0D1213",
  panel: "#151E1D",
  panelRaised: "#1B2724",
  border: "#2B3A35",
  text: "#ECF3EE",
  muted: "#A0B0A8",
  green: "#A8D5A0",
  blue: "#8AB8F0",
  amber: "#DDBB72",
  ink: "#0A130C",
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: { width: "100%", maxWidth: 1200, alignSelf: "center", padding: 30, paddingBottom: 50 },
  contentCompact: { padding: 17, paddingBottom: 35 },
  hero: {
    borderRadius: 19,
    padding: 27,
    backgroundColor: "#15231D",
    borderWidth: 1,
    borderColor: "#304639",
    marginBottom: 22,
  },
  heroEyebrow: { color: palette.green, fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  heroTitle: { color: palette.text, fontSize: 32, lineHeight: 39, fontWeight: "800", marginTop: 12 },
  heroDescription: { color: palette.muted, fontSize: 13, lineHeight: 21, marginTop: 10, maxWidth: 720 },
  grid: { flexDirection: "row", alignItems: "stretch", gap: 15 },
  gridCompact: { flexDirection: "column" },
  card: {
    flex: 1,
    minWidth: 0,
    padding: 21,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.panel,
    marginBottom: 15,
  },
  eyebrow: { color: palette.green, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  cardTitle: { color: palette.text, fontSize: 20, fontWeight: "800", marginTop: 12 },
  description: { color: palette.muted, fontSize: 12, lineHeight: 19, marginTop: 10, minHeight: 74 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 17, marginBottom: 16 },
  dot: { width: 7, height: 7, borderRadius: 5, backgroundColor: palette.green },
  blueDot: { backgroundColor: palette.blue },
  amberDot: { backgroundColor: palette.amber },
  status: { color: palette.muted, fontSize: 10, fontWeight: "700" },
  button: {
    minHeight: 43,
    borderRadius: 9,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: palette.green,
  },
  buttonDisabled: { borderWidth: 1, borderColor: palette.border, backgroundColor: "#1B2421" },
  buttonText: { color: palette.ink, fontSize: 11, fontWeight: "800" },
  buttonTextDisabled: { color: palette.muted },
  arrow: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  section: { marginTop: 17, padding: 21, backgroundColor: palette.panel, borderRadius: 15, borderWidth: 1, borderColor: palette.border },
  sectionTitle: { color: palette.text, fontSize: 16, fontWeight: "800", marginBottom: 10 },
  capability: { color: palette.muted, fontSize: 12, lineHeight: 20, marginTop: 5 },
  warning: { marginTop: 14, padding: 17, borderRadius: 13, backgroundColor: "#2A2419", borderWidth: 1, borderColor: "#66512D" },
  warningTitle: { color: palette.amber, fontWeight: "800", fontSize: 12 },
  warningText: { color: "#E8DDC6", fontSize: 11, lineHeight: 18, marginTop: 7 },
  footnote: { color: "#728078", fontSize: 9, lineHeight: 15, textAlign: "center", marginTop: 22 },
});
