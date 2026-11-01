import { StatusBar } from "expo-status-bar";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import {
  AccountTransaction,
  ChainStatus,
  CoinBalance,
  Validator,
  formatScoin,
  getAccountBalances,
  getAccountTransactions,
  getChainStatus,
  getValidators,
  shorten,
} from "./src/chain";

type Screen = "overview" | "wallet" | "explorer" | "validators" | "settings";

const initialApiUrl =
  process.env.EXPO_PUBLIC_SCOIN_API_URL ??
  (Platform.OS === "web"
    ? "http://127.0.0.1:8787"
    : Platform.OS === "android"
      ? "http://10.0.2.2:1317"
      : "http://127.0.0.1:1317");
const navigation: { id: Screen; label: string; glyph: string }[] = [
  { id: "overview", label: "Overview", glyph: "◈" },
  { id: "wallet", label: "Wallet", glyph: "▣" },
  { id: "explorer", label: "Explorer", glyph: "⌕" },
  { id: "validators", label: "Validators", glyph: "⌘" },
];

export default function App() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [screen, setScreen] = useState<Screen>("overview");
  const [apiUrl, setApiUrl] = useState(initialApiUrl);
  const [apiDraft, setApiDraft] = useState(initialApiUrl);
  const [chain, setChain] = useState<ChainStatus | null>(null);
  const [validators, setValidators] = useState<Validator[]>([]);
  const [address, setAddress] = useState("");
  const [addressDraft, setAddressDraft] = useState("");
  const [balances, setBalances] = useState<CoinBalance[] | null>(null);
  const [transactions, setTransactions] = useState<AccountTransaction[] | null>(
    null,
  );
  const [loadingNetwork, setLoadingNetwork] = useState(true);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refreshNetwork = useCallback(async () => {
    setLoadingNetwork(true);
    setError("");

    try {
      const [nextChain, nextValidators] = await Promise.all([
        getChainStatus(apiUrl),
        getValidators(apiUrl),
      ]);
      setChain(nextChain);
      setValidators(nextValidators);
    } catch (requestError) {
      setChain(null);
      setValidators([]);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not read the S Coin network.",
      );
    } finally {
      setLoadingNetwork(false);
    }
  }, [apiUrl]);

  useEffect(() => {
    void refreshNetwork();
    const timer = setInterval(() => void refreshNetwork(), 15_000);
    return () => clearInterval(timer);
  }, [refreshNetwork]);

  const bondedValidators = useMemo(
    () =>
      validators
        .filter((validator) => validator.status === "BOND_STATUS_BONDED")
        .sort((left, right) => {
          const leftTokens = BigInt(left.tokens || "0");
          const rightTokens = BigInt(right.tokens || "0");
          return leftTokens < rightTokens ? 1 : leftTokens > rightTokens ? -1 : 0;
        }),
    [validators],
  );

  const nativeBalance = useMemo(
    () => balances?.find((coin) => coin.denom === "uscoin")?.amount ?? "0",
    [balances],
  );

  const loadAccount = useCallback(async () => {
    const nextAddress = addressDraft.trim();
    if (!/^scoin1[023456789acdefghjklmnpqrstuvwxyz]{20,}$/.test(nextAddress)) {
      setError("Enter a valid S Coin address beginning with scoin1.");
      return;
    }

    setLoadingAccount(true);
    setError("");
    setNotice("");

    try {
      const [nextBalances, nextTransactions] = await Promise.all([
        getAccountBalances(apiUrl, nextAddress),
        getAccountTransactions(apiUrl, nextAddress),
      ]);
      setAddress(nextAddress);
      setBalances(nextBalances);
      setTransactions(nextTransactions);
      setNotice("Account loaded from the connected chain. This app is read-only.");
    } catch (requestError) {
      setBalances(null);
      setTransactions(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load this account.",
      );
    } finally {
      setLoadingAccount(false);
    }
  }, [addressDraft, apiUrl]);

  function saveEndpoint() {
    const nextUrl = apiDraft.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^/\s]+(?::\d+)?$/i.test(nextUrl)) {
      setError("Enter a valid HTTP or HTTPS API URL, such as http://127.0.0.1:1317.");
      return;
    }
    setApiUrl(nextUrl);
    setApiDraft(nextUrl);
    setAddress("");
    setAddressDraft("");
    setBalances(null);
    setTransactions(null);
    setNotice("API endpoint updated.");
    setError("");
    setScreen("overview");
  }

  const title =
    screen === "overview"
      ? "Your network at a glance"
      : screen === "wallet"
        ? "Read-only wallet"
        : screen === "explorer"
          ? "Network explorer"
          : screen === "validators"
            ? "Validator set"
            : "Connection settings";

  return (
    <View style={styles.app}>
      <StatusBar style="light" />
      <View style={[styles.shell, compact && styles.shellCompact]}>
        <View style={[styles.sidebar, compact && styles.sidebarCompact]}>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <Text style={styles.brandMarkText}>S</Text>
            </View>
            {!compact && (
              <View>
                <Text style={styles.brandName}>S COIN</Text>
                <Text style={styles.brandCaption}>NETWORK PORTAL</Text>
              </View>
            )}
          </View>
          {!compact && (
            <View style={styles.nav}>
              {navigation.map((item) => (
                <NavButton
                  key={item.id}
                  compact={false}
                  active={screen === item.id}
                  label={item.label}
                  glyph={item.glyph}
                  onPress={() => setScreen(item.id)}
                />
              ))}
              <NavButton
                compact={false}
                active={false}
                label="Markets"
                glyph="↗"
                onPress={() => router.push("/markets")}
              />
            </View>
          )}
          {!compact && (
            <View style={styles.sidebarFooter}>
              <View style={styles.sidebarStatusDot} />
              <Text style={styles.sidebarFooterText}>
                {chain ? "CONNECTED TO NODE" : "NODE NOT CONNECTED"}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.content}>
          <View style={[styles.topbar, compact && styles.topbarCompact]}>
            <View>
              <Text style={styles.eyebrow}>S COIN / TESTNET</Text>
              <Text style={[styles.pageTitle, compact && styles.pageTitleSmall]}>
                {title}
              </Text>
            </View>
            <View style={styles.topbarActions}>
              <View style={styles.readOnlyPill}>
                <Text style={styles.readOnlyText}>READ ONLY</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Refresh network data"
                style={styles.refreshButton}
                onPress={() => void refreshNetwork()}
              >
                <Text style={styles.refreshGlyph}>↻</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Connection settings"
                style={styles.refreshButton}
                onPress={() => setScreen("settings")}
              >
                <Text style={styles.settingsGlyph}>⚙</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.page,
              compact && styles.pageCompact,
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {error ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorTitle}>Connection needs attention</Text>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setScreen("settings")}
                >
                  <Text style={styles.errorLink}>Check API settings →</Text>
                </Pressable>
              </View>
            ) : null}
            {notice ? (
              <Text accessibilityRole="alert" style={styles.notice}>
                {notice}
              </Text>
            ) : null}

            {screen === "overview" && (
              <Overview
                compact={compact}
                chain={chain}
                validators={bondedValidators}
                loading={loadingNetwork}
                onNavigate={setScreen}
              />
            )}
            {screen === "wallet" && (
              <Wallet
                compact={compact}
                addressDraft={addressDraft}
                address={address}
                balances={balances}
                nativeBalance={nativeBalance}
                transactions={transactions}
                loading={loadingAccount}
                onAddressChange={setAddressDraft}
                onSubmit={() => void loadAccount()}
              />
            )}
            {screen === "explorer" && (
              <Explorer compact={compact} chain={chain} loading={loadingNetwork} />
            )}
            {screen === "validators" && (
              <Validators
                compact={compact}
                validators={bondedValidators}
                loading={loadingNetwork}
              />
            )}
            {screen === "settings" && (
              <Settings
                compact={compact}
                apiDraft={apiDraft}
                onApiChange={setApiDraft}
                onSave={saveEndpoint}
                onReset={() => {
                  setApiDraft(initialApiUrl);
                  setApiUrl(initialApiUrl);
                  setError("");
                  setNotice("API endpoint reset.");
                }}
              />
            )}

            <Text style={styles.disclaimer}>
              S Coin is a development/testnet project. Test coins have no
              real-world value. Never enter a seed phrase into this app.
            </Text>
          </ScrollView>

          {compact && (
            <View style={styles.bottomNav}>
              {navigation.map((item) => (
                <NavButton
                  key={item.id}
                  compact
                  active={screen === item.id}
                  label={item.label}
                  glyph={item.glyph}
                  onPress={() => setScreen(item.id)}
                />
              ))}
              <NavButton
                compact
                active={false}
                label="Markets"
                glyph="↗"
                onPress={() => router.push("/markets")}
              />
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

function NavButton({
  compact,
  active,
  glyph,
  label,
  onPress,
}: {
  compact: boolean;
  active: boolean;
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.navButton,
        compact && styles.navButtonCompact,
        active && styles.navButtonActive,
      ]}
    >
      <Text style={[styles.navGlyph, active && styles.navTextActive]}>
        {glyph}
      </Text>
      <Text
        numberOfLines={1}
        style={[
          styles.navLabel,
          compact && styles.navLabelCompact,
          active && styles.navTextActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Overview({
  compact,
  chain,
  validators,
  loading,
  onNavigate,
}: {
  compact: boolean;
  chain: ChainStatus | null;
  validators: Validator[];
  loading: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <>
      <View style={[styles.hero, compact && styles.heroCompact]}>
        <View style={styles.heroCopy}>
          <View style={styles.liveLabel}>
            <View style={[styles.liveDot, !chain && styles.liveDotOff]} />
            <Text style={styles.liveLabelText}>
              {chain ? "LOCAL NETWORK LIVE" : "WAITING FOR NODE"}
            </Text>
          </View>
          <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]}>
            S Coin,{`\n`}on-chain.
          </Text>
          <Text style={styles.heroDescription}>
            Explore S Coin network activity, account balances, and validators.
            Connected data is read-only.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onNavigate("wallet")}
            style={styles.heroButton}
          >
            <Text style={styles.heroButtonText}>View an account</Text>
            <Text style={styles.heroButtonArrow}>→</Text>
          </Pressable>
        </View>
        {!compact && (
          <View style={styles.heroArtwork}>
            <View style={[styles.orbit, styles.orbitOuter]} />
            <View style={[styles.orbit, styles.orbitInner]} />
            <View style={styles.orbitCore}>
              <Text style={styles.orbitCoreText}>S</Text>
            </View>
            <View style={styles.orbitBadge}>
              <Text style={styles.orbitBadgeText}>USCOIN</Text>
            </View>
          </View>
        )}
      </View>

      <SectionHeading
        eyebrow="NETWORK PULSE"
        title="The essentials"
        detail="Live chain data from your configured node"
        trailing={
          loading ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.updatedText}>AUTO-REFRESH · 15 SEC</Text>
          )
        }
      />
      <View style={[styles.statsGrid, compact && styles.statsGridCompact]}>
        <StatCard
          label="LATEST BLOCK"
          value={chain ? `#${Number(chain.height).toLocaleString()}` : "—"}
          detail={chain ? "Finalized on chain" : "Connect a node to load"}
          accent
        />
        <StatCard
          label="ACTIVE VALIDATORS"
          value={chain ? validators.length.toString() : "—"}
          detail="Bonded validator set"
        />
        <StatCard
          label="NATIVE ASSET"
          value="S"
          detail="1 S = 1,000,000 uscoin"
        />
      </View>

      <View style={[styles.lowerGrid, compact && styles.lowerGridCompact]}>
        <View style={styles.panel}>
          <SectionHeading
            eyebrow="CHAIN HEALTH"
            title="Network status"
            detail="Consensus and node information"
          />
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Connection</Text>
            <View style={styles.statusValue}>
              <View style={[styles.liveDot, !chain && styles.liveDotOff]} />
              <Text style={styles.statusValueText}>
                {chain ? "Node responding" : "Not connected"}
              </Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Chain ID</Text>
            <Text style={styles.statusValueText}>
              {chain?.chainId ?? "—"}
            </Text>
          </View>
          <View style={[styles.statusRow, styles.statusRowLast]}>
            <Text style={styles.statusLabel}>Sync status</Text>
            <Text style={styles.statusValueText}>
              {chain ? (chain.syncing ? "Catching up" : "In sync") : "—"}
            </Text>
          </View>
        </View>
        <View style={styles.callout}>
          <Text style={styles.calloutEyebrow}>YOUR NEXT STEP</Text>
          <Text style={styles.calloutTitle}>Check a S Coin address</Text>
          <Text style={styles.calloutBody}>
            Look up balances and recent on-chain activity without connecting a
            wallet or sharing a secret.
          </Text>
          <Pressable
            accessibilityRole="button"
            style={styles.textButton}
            onPress={() => onNavigate("wallet")}
          >
            <Text style={styles.textButtonText}>Open read-only wallet →</Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

function Wallet({
  compact,
  addressDraft,
  address,
  balances,
  nativeBalance,
  transactions,
  loading,
  onAddressChange,
  onSubmit,
}: {
  compact: boolean;
  addressDraft: string;
  address: string;
  balances: CoinBalance[] | null;
  nativeBalance: string;
  transactions: AccountTransaction[] | null;
  loading: boolean;
  onAddressChange: (address: string) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <View style={styles.sectionIntro}>
        <Text style={styles.sectionEyebrow}>ACCOUNT LOOKUP</Text>
        <Text style={styles.sectionTitle}>Your coins, clearly.</Text>
        <Text style={styles.sectionDescription}>
          Paste a public S Coin address to read its on-chain balances and
          transactions. No wallet connection or private keys required.
        </Text>
      </View>
      <View style={styles.panel}>
        <Text style={styles.fieldLabel}>S COIN ADDRESS</Text>
        <View style={[styles.inputRow, compact && styles.inputRowCompact]}>
          <TextInput
            accessibilityLabel="S Coin address"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onAddressChange}
            onSubmitEditing={onSubmit}
            placeholder="scoin1…"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={styles.textInput}
            value={addressDraft}
          />
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={onSubmit}
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
          >
            {loading ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <Text style={styles.primaryButtonText}>Look up address</Text>
            )}
          </Pressable>
        </View>
      </View>

      {address ? (
        <>
          <View style={[styles.balanceCard, compact && styles.balanceCardCompact]}>
            <View>
              <Text style={styles.cardEyebrow}>AVAILABLE BALANCE</Text>
              <Text style={styles.balanceAmount}>{formatScoin(nativeBalance)}</Text>
              <Text style={styles.balanceDenom}>S COIN</Text>
            </View>
            <View style={styles.addressSummary}>
              <Text style={styles.cardEyebrow}>ACCOUNT</Text>
              <Text selectable style={styles.addressText}>
                {compact ? shorten(address, 12) : address}
              </Text>
              <Text style={styles.readOnlySubtext}>Read-only · public chain data</Text>
            </View>
          </View>
          <SectionHeading
            eyebrow="ACTIVITY"
            title="Recent transactions"
            detail="Latest incoming and outgoing transfers"
          />
          <TransactionList transactions={transactions} />
          {balances && balances.length > 1 ? (
            <View style={styles.panel}>
              <Text style={styles.fieldLabel}>OTHER ASSETS</Text>
              {balances
                .filter((coin) => coin.denom !== "uscoin")
                .map((coin) => (
                  <View key={coin.denom} style={styles.statusRow}>
                    <Text style={styles.statusLabel}>{coin.denom}</Text>
                    <Text style={styles.statusValueText}>{coin.amount}</Text>
                  </View>
                ))}
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.emptyPanel}>
          <View style={styles.emptyGlyph}>
            <Text style={styles.emptyGlyphText}>▣</Text>
          </View>
          <Text style={styles.emptyTitle}>Look up any S Coin account</Text>
          <Text style={styles.emptyText}>
            Balances and transaction history are read directly from the chain.
            This app never asks for a seed phrase.
          </Text>
        </View>
      )}
    </>
  );
}

function Explorer({
  compact,
  chain,
  loading,
}: {
  compact: boolean;
  chain: ChainStatus | null;
  loading: boolean;
}) {
  return (
    <>
      <View style={styles.sectionIntro}>
        <Text style={styles.sectionEyebrow}>ON-CHAIN DATA</Text>
        <Text style={styles.sectionTitle}>A clearer view of S Coin.</Text>
        <Text style={styles.sectionDescription}>
          Inspect the latest committed block and confirm which chain your app is
          reading.
        </Text>
      </View>
      <View style={[styles.statsGrid, compact && styles.statsGridCompact]}>
        <StatCard
          label="LATEST HEIGHT"
          value={chain ? `#${Number(chain.height).toLocaleString()}` : "—"}
          detail="Latest block reported by the node"
          accent
        />
        <StatCard
          label="NETWORK"
          value={chain?.chainId ?? (loading ? "Loading" : "Unavailable")}
          detail="Chain identifier"
        />
        <StatCard
          label="LAST BLOCK TIME"
          value={
            chain?.blockTime
              ? new Date(chain.blockTime).toLocaleTimeString()
              : "—"
          }
          detail={
            chain?.blockTime
              ? new Date(chain.blockTime).toLocaleDateString()
              : "Waiting for node data"
          }
        />
      </View>
      <View style={styles.panel}>
        <SectionHeading
          eyebrow="LATEST BLOCK"
          title={chain ? `Block ${chain.height}` : "Waiting for a node"}
          detail={
            chain?.blockTime
              ? new Date(chain.blockTime).toLocaleString()
              : "Connect a node to view the latest block."
          }
        />
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Block height</Text>
          <Text style={styles.statusValueText}>{chain?.height ?? "—"}</Text>
        </View>
        <View style={[styles.statusRow, styles.statusRowLast]}>
          <Text style={styles.statusLabel}>Syncing</Text>
          <Text style={styles.statusValueText}>
            {chain ? (chain.syncing ? "Yes" : "No") : "—"}
          </Text>
        </View>
      </View>
      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>Testnet explorer</Text>
        <Text style={styles.noteBody}>
          This app reads chain height and public account activity. Full block
          history and network-wide transaction search are not implemented yet.
        </Text>
      </View>
    </>
  );
}

function Validators({
  compact,
  validators,
  loading,
}: {
  compact: boolean;
  validators: Validator[];
  loading: boolean;
}) {
  return (
    <>
      <View style={styles.sectionIntro}>
        <Text style={styles.sectionEyebrow}>CONSENSUS</Text>
        <Text style={styles.sectionTitle}>The people securing S Coin.</Text>
        <Text style={styles.sectionDescription}>
          Bonded validators reported by your connected node. This page is
          informational; it does not delegate or move funds.
        </Text>
      </View>
      <View style={styles.panel}>
        <View style={styles.validatorHeader}>
          <View>
            <Text style={styles.fieldLabel}>BONDED VALIDATORS</Text>
            <Text style={styles.panelSubhead}>
              {loading ? "Refreshing…" : `${validators.length} active`}
            </Text>
          </View>
          <Text style={styles.tableLabel}>STAKE · COMMISSION</Text>
        </View>
        {validators.length ? (
          validators.map((validator, index) => (
            <View key={validator.operator_address} style={styles.validatorRow}>
              <View style={styles.validatorIdentity}>
                <View style={styles.validatorAvatar}>
                  <Text style={styles.validatorAvatarText}>
                    {(validator.description?.moniker ?? "V")
                      .slice(0, 1)
                      .toUpperCase()}
                  </Text>
                </View>
                <View style={styles.validatorNameWrap}>
                  <Text numberOfLines={1} style={styles.validatorName}>
                    {validator.description?.moniker ?? "Unnamed validator"}
                  </Text>
                  <Text selectable style={styles.validatorAddress}>
                    {compact
                      ? shorten(validator.operator_address, 8)
                      : shorten(validator.operator_address, 12)}
                  </Text>
                </View>
              </View>
              <View style={styles.validatorMetrics}>
                <Text style={styles.validatorStake}>
                  {formatScoin(validator.tokens ?? "0")} S
                </Text>
                <Text style={styles.validatorCommission}>
                  {Number(validator.commission?.commission_rates?.rate ?? 0) *
                    100}
                  % commission
                </Text>
              </View>
              <Text style={styles.validatorRank}>
                {String(index + 1).padStart(2, "0")}
              </Text>
            </View>
          ))
        ) : (
          <View style={styles.emptyInline}>
            <Text style={styles.emptyText}>
              {loading
                ? "Loading validator data…"
                : "No bonded validators were returned. Check the API connection."}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.smallPrint}>
        Staking details are informational only. Validator rewards use the
        chain's current parameters and are not a promised return.
      </Text>
    </>
  );
}

function Settings({
  compact,
  apiDraft,
  onApiChange,
  onSave,
  onReset,
}: {
  compact: boolean;
  apiDraft: string;
  onApiChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <View style={styles.sectionIntro}>
        <Text style={styles.sectionEyebrow}>NODE CONNECTION</Text>
        <Text style={styles.sectionTitle}>Choose your API endpoint.</Text>
        <Text style={styles.sectionDescription}>
          Enter the Cosmos SDK REST API for your local node. The default works
          when the app and node run on the same computer.
        </Text>
      </View>
      <View style={styles.panel}>
        <Text style={styles.fieldLabel}>REST API URL</Text>
        <TextInput
          accessibilityLabel="REST API URL"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={onApiChange}
          placeholder="http://127.0.0.1:1317"
          placeholderTextColor={colors.muted}
          style={[styles.textInput, styles.settingsInput]}
          value={apiDraft}
        />
        <View style={[styles.buttonRow, compact && styles.buttonRowCompact]}>
          <Pressable
            accessibilityRole="button"
            onPress={onSave}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>Save and connect</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onReset}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Reset endpoint</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>Protect your node and your keys</Text>
        <Text style={styles.noteBody}>
          Use only a trusted API endpoint. Never expose a validator's RPC or
          REST port publicly without appropriate access controls. This app does
          not request, store, or sign with private keys.
        </Text>
      </View>
    </>
  );
}

function TransactionList({
  transactions,
}: {
  transactions: AccountTransaction[] | null;
}) {
  if (transactions === null) {
    return (
      <View style={styles.emptyInline}>
        <Text style={styles.emptyText}>
          Account activity will appear here after lookup.
        </Text>
      </View>
    );
  }
  if (transactions.length === 0) {
    return (
      <View style={styles.emptyInline}>
        <Text style={styles.emptyText}>
          No indexed transactions were found for this account.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      {transactions.map((transaction, index) => (
        <View
          key={transaction.txhash}
          style={[
            styles.transactionRow,
            index === transactions.length - 1 && styles.statusRowLast,
          ]}
        >
          <View style={styles.transactionIcon}>
            <Text style={styles.transactionIconText}>
              {transaction.code === 0 ? "↗" : "!"}
            </Text>
          </View>
          <View style={styles.transactionDetails}>
            <Text style={styles.transactionHash}>
              {shorten(transaction.txhash, 9)}
            </Text>
            <Text style={styles.transactionMeta}>
              Block {transaction.height}
              {transaction.timestamp
                ? ` · ${new Date(transaction.timestamp).toLocaleString()}`
                : ""}
            </Text>
          </View>
          <View
            style={[
              styles.txStatus,
              transaction.code !== 0 && styles.txStatusFailed,
            ]}
          >
            <Text style={styles.txStatusText}>
              {transaction.code === 0 ? "SUCCESS" : "FAILED"}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function SectionHeading({
  eyebrow,
  title,
  detail,
  trailing,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={styles.sectionHeading}>
      <View>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionHeadingTitle}>{title}</Text>
        {detail ? <Text style={styles.sectionHeadingDetail}>{detail}</Text> : null}
      </View>
      {trailing ? <View style={styles.sectionTrailing}>{trailing}</View> : null}
    </View>
  );
}

function StatCard({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <View style={[styles.statCard, accent && styles.statCardAccent]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text numberOfLines={1} style={[styles.statValue, accent && styles.statValueAccent]}>
        {value}
      </Text>
      <Text style={styles.statDetail}>{detail}</Text>
    </View>
  );
}

const colors = {
  background: "#080B0D",
  panel: "#111719",
  panelRaised: "#161F20",
  border: "#253031",
  ink: "#F1F7F2",
  muted: "#849493",
  accent: "#B7F36B",
  accentDark: "#192418",
  danger: "#FF8D82",
};

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background },
  shell: {
    flex: 1,
    flexDirection: "row",
    alignSelf: "center",
    width: "100%",
    maxWidth: 1600,
    backgroundColor: colors.background,
  },
  shellCompact: { flexDirection: "column" },
  sidebar: {
    width: 248,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 22,
    backgroundColor: "#0D1213",
    borderRightWidth: 1,
    borderRightColor: "#182121",
  },
  sidebarCompact: {
    width: "100%",
    height: 64,
    paddingHorizontal: 18,
    paddingVertical: 0,
    flexDirection: "row",
    alignItems: "center",
    borderRightWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#182121",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 48 },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  brandMarkText: { color: "#0C130B", fontSize: 26, fontWeight: "900" },
  brandName: { color: colors.ink, fontSize: 14, fontWeight: "900", letterSpacing: 2 },
  brandCaption: { color: colors.muted, fontSize: 9, letterSpacing: 1.6, marginTop: 3 },
  nav: { gap: 7 },
  navButton: {
    minHeight: 47,
    borderRadius: 12,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  navButtonCompact: {
    flex: 1,
    minHeight: 45,
    paddingHorizontal: 6,
    justifyContent: "center",
    flexDirection: "column",
    gap: 2,
  },
  navButtonActive: { backgroundColor: colors.accentDark },
  navGlyph: { color: colors.muted, fontSize: 19, width: 22, textAlign: "center" },
  navLabel: { color: "#A6B1AF", fontSize: 13, fontWeight: "600" },
  navLabelCompact: { fontSize: 9, fontWeight: "600" },
  navTextActive: { color: colors.accent },
  sidebarFooter: {
    marginTop: "auto",
    borderTopColor: "#202B2C",
    borderTopWidth: 1,
    paddingTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  sidebarStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  sidebarFooterText: { color: colors.muted, fontSize: 9, letterSpacing: 1.2 },
  content: { flex: 1, minWidth: 0 },
  topbar: {
    minHeight: 94,
    paddingHorizontal: 38,
    paddingVertical: 17,
    borderBottomWidth: 1,
    borderBottomColor: "#182121",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  topbarCompact: { minHeight: 74, paddingHorizontal: 18, paddingVertical: 10 },
  eyebrow: { color: colors.accent, fontSize: 9, letterSpacing: 1.8, fontWeight: "700" },
  pageTitle: { color: colors.ink, fontSize: 21, fontWeight: "700", marginTop: 5 },
  pageTitleSmall: { fontSize: 17 },
  topbarActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  readOnlyPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#2A3A32",
    backgroundColor: "#111A17",
  },
  readOnlyText: { color: colors.accent, fontSize: 9, letterSpacing: 1, fontWeight: "800" },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  refreshGlyph: { color: colors.ink, fontSize: 21 },
  settingsGlyph: { color: colors.ink, fontSize: 16 },
  scroll: { flex: 1 },
  page: { width: "100%", maxWidth: 1260, alignSelf: "center", padding: 38, paddingBottom: 64 },
  pageCompact: { padding: 18, paddingBottom: 28 },
  errorBanner: {
    padding: 16,
    borderRadius: 13,
    marginBottom: 18,
    backgroundColor: "#281A1A",
    borderWidth: 1,
    borderColor: "#5B302D",
    gap: 6,
  },
  errorTitle: { color: colors.danger, fontSize: 13, fontWeight: "800" },
  errorText: { color: "#E8C3C0", fontSize: 12, lineHeight: 18 },
  errorLink: { color: colors.accent, fontSize: 12, fontWeight: "700", marginTop: 3 },
  notice: { color: colors.accent, fontSize: 12, marginBottom: 14 },
  hero: {
    minHeight: 320,
    borderRadius: 22,
    backgroundColor: "#15201D",
    borderWidth: 1,
    borderColor: "#26352F",
    paddingHorizontal: 38,
    paddingVertical: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
    marginBottom: 36,
  },
  heroCompact: { minHeight: 340, paddingHorizontal: 23, paddingVertical: 25 },
  heroCopy: { maxWidth: 590, zIndex: 1 },
  liveLabel: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 19 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  liveDotOff: { backgroundColor: colors.danger },
  liveLabelText: { color: colors.accent, fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  heroTitle: { color: colors.ink, fontSize: 50, lineHeight: 56, fontWeight: "800", letterSpacing: -1.5 },
  heroTitleCompact: { fontSize: 38, lineHeight: 43 },
  heroDescription: { color: "#A8B5AF", fontSize: 14, lineHeight: 22, maxWidth: 460, marginTop: 15 },
  heroButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 9,
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.accent,
  },
  heroButtonText: { color: "#0B130B", fontSize: 12, fontWeight: "800" },
  heroButtonArrow: { color: "#0B130B", fontSize: 16, fontWeight: "800" },
  heroArtwork: { width: 280, height: 250, alignItems: "center", justifyContent: "center", marginRight: 20 },
  orbit: { position: "absolute", borderWidth: 1, borderColor: "#3A5140", borderRadius: 200 },
  orbitOuter: { width: 246, height: 246 },
  orbitInner: { width: 176, height: 176, borderColor: "#516A4C" },
  orbitCore: {
    width: 98,
    height: 98,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "45deg" }],
    backgroundColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.25,
    shadowRadius: 35,
  },
  orbitCoreText: { color: "#10180D", fontSize: 46, fontWeight: "900", transform: [{ rotate: "-45deg" }] },
  orbitBadge: { position: "absolute", right: 0, bottom: 30, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, backgroundColor: "#0A100E", borderColor: "#425645", borderWidth: 1 },
  orbitBadgeText: { color: colors.accent, fontSize: 8, letterSpacing: 1.4, fontWeight: "800" },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 15,
  },
  sectionEyebrow: { color: colors.accent, fontSize: 9, fontWeight: "800", letterSpacing: 1.4 },
  sectionHeadingTitle: { color: colors.ink, fontSize: 17, fontWeight: "700", marginTop: 5 },
  sectionHeadingDetail: { color: colors.muted, fontSize: 11, marginTop: 4, lineHeight: 16 },
  sectionTrailing: { alignItems: "flex-end" },
  updatedText: { color: colors.muted, fontSize: 8, letterSpacing: 1 },
  statsGrid: { flexDirection: "row", gap: 14, marginBottom: 30 },
  statsGridCompact: { flexDirection: "column", gap: 10 },
  statCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 140,
    padding: 19,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  statCardAccent: { backgroundColor: "#141E18", borderColor: "#344D37" },
  statLabel: { color: colors.muted, fontSize: 9, letterSpacing: 1.1, fontWeight: "700" },
  statValue: { color: colors.ink, fontSize: 25, fontWeight: "800", marginTop: 20 },
  statValueAccent: { color: colors.accent },
  statDetail: { color: "#879492", fontSize: 10, marginTop: 6, lineHeight: 15 },
  lowerGrid: { flexDirection: "row", alignItems: "stretch", gap: 14 },
  lowerGridCompact: { flexDirection: "column" },
  panel: { padding: 20, borderRadius: 15, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border, marginBottom: 15 },
  statusRow: {
    minHeight: 43,
    borderBottomWidth: 1,
    borderBottomColor: "#202B2C",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  statusRowLast: { borderBottomWidth: 0 },
  statusLabel: { color: colors.muted, fontSize: 11 },
  statusValue: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusValueText: { color: colors.ink, fontSize: 11, fontWeight: "600" },
  callout: { flex: 1, minWidth: 240, padding: 22, borderRadius: 15, backgroundColor: colors.panelRaised, borderWidth: 1, borderColor: colors.border },
  calloutEyebrow: { color: colors.accent, fontSize: 9, letterSpacing: 1.3, fontWeight: "800" },
  calloutTitle: { color: colors.ink, fontSize: 18, fontWeight: "700", marginTop: 15 },
  calloutBody: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 9 },
  textButton: { marginTop: 18 },
  textButtonText: { color: colors.accent, fontSize: 11, fontWeight: "800" },
  sectionIntro: { maxWidth: 680, marginBottom: 24 },
  sectionTitle: { color: colors.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.5, marginTop: 9 },
  sectionDescription: { color: colors.muted, fontSize: 13, lineHeight: 21, marginTop: 9 },
  fieldLabel: { color: colors.muted, fontSize: 9, letterSpacing: 1.2, fontWeight: "800", marginBottom: 11 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  inputRowCompact: { alignItems: "stretch", flexDirection: "column" },
  textInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "#334040",
    backgroundColor: "#0B1011",
    color: colors.ink,
    paddingHorizontal: 14,
    fontSize: 13,
  },
  primaryButton: { minHeight: 46, paddingHorizontal: 17, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  primaryButtonText: { color: "#0B130B", fontSize: 11, fontWeight: "800" },
  buttonDisabled: { opacity: 0.65 },
  balanceCard: {
    padding: 26,
    borderRadius: 17,
    backgroundColor: "#15201D",
    borderWidth: 1,
    borderColor: "#304238",
    marginBottom: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 18,
  },
  balanceCardCompact: { alignItems: "flex-start", flexDirection: "column" },
  cardEyebrow: { color: "#A4B3AA", fontSize: 9, letterSpacing: 1.2, fontWeight: "800" },
  balanceAmount: { color: colors.ink, fontSize: 39, fontWeight: "800", marginTop: 11 },
  balanceDenom: { color: colors.accent, fontSize: 10, letterSpacing: 1.6, fontWeight: "800", marginTop: 4 },
  addressSummary: { maxWidth: 420, alignItems: "flex-end" },
  addressText: { color: colors.ink, fontSize: 11, marginTop: 10 },
  readOnlySubtext: { color: colors.muted, fontSize: 10, marginTop: 6 },
  emptyPanel: { alignItems: "center", justifyContent: "center", paddingVertical: 48, paddingHorizontal: 25, borderWidth: 1, borderStyle: "dashed", borderColor: "#31403E", borderRadius: 15 },
  emptyGlyph: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#18231D" },
  emptyGlyphText: { color: colors.accent, fontSize: 22 },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: "700", marginTop: 17 },
  emptyText: { color: colors.muted, fontSize: 12, lineHeight: 19, textAlign: "center", maxWidth: 430, marginTop: 7 },
  emptyInline: { paddingVertical: 20, paddingHorizontal: 6 },
  transactionRow: { minHeight: 65, borderBottomWidth: 1, borderBottomColor: "#202B2C", flexDirection: "row", alignItems: "center", gap: 12 },
  transactionIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#1A2821" },
  transactionIconText: { color: colors.accent, fontSize: 18, fontWeight: "800" },
  transactionDetails: { flex: 1, minWidth: 0 },
  transactionHash: { color: colors.ink, fontSize: 11, fontWeight: "700" },
  transactionMeta: { color: colors.muted, fontSize: 9, marginTop: 5 },
  txStatus: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 6, backgroundColor: "#1B2A20" },
  txStatusFailed: { backgroundColor: "#321E1D" },
  txStatusText: { color: colors.accent, fontSize: 8, fontWeight: "800", letterSpacing: 0.5 },
  validatorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  panelSubhead: { color: colors.ink, fontSize: 13, fontWeight: "700", marginTop: 4 },
  tableLabel: { color: colors.muted, fontSize: 8, letterSpacing: 0.9 },
  validatorRow: { minHeight: 72, borderTopWidth: 1, borderTopColor: "#202B2C", flexDirection: "row", alignItems: "center", gap: 12 },
  validatorIdentity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  validatorAvatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#1B2820", alignItems: "center", justifyContent: "center" },
  validatorAvatarText: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  validatorNameWrap: { flex: 1, minWidth: 0 },
  validatorName: { color: colors.ink, fontSize: 11, fontWeight: "700" },
  validatorAddress: { color: colors.muted, fontSize: 9, marginTop: 5 },
  validatorMetrics: { alignItems: "flex-end" },
  validatorStake: { color: colors.ink, fontSize: 11, fontWeight: "700" },
  validatorCommission: { color: colors.muted, fontSize: 9, marginTop: 5 },
  validatorRank: { width: 21, color: "#62706D", textAlign: "right", fontSize: 9 },
  smallPrint: { color: colors.muted, fontSize: 10, lineHeight: 16, marginTop: 4 },
  noteCard: { padding: 19, borderRadius: 14, backgroundColor: "#121919", borderWidth: 1, borderColor: colors.border, marginTop: 5 },
  noteTitle: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  noteBody: { color: colors.muted, fontSize: 11, lineHeight: 18, marginTop: 8 },
  settingsInput: { width: "100%", marginBottom: 14 },
  buttonRow: { flexDirection: "row", gap: 10 },
  buttonRowCompact: { flexDirection: "column" },
  secondaryButton: { minHeight: 46, paddingHorizontal: 17, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.ink, fontSize: 11, fontWeight: "700" },
  disclaimer: { color: "#64716F", textAlign: "center", fontSize: 9, lineHeight: 15, marginTop: 27 },
  bottomNav: { minHeight: 65, paddingHorizontal: 8, paddingTop: 5, borderTopWidth: 1, borderTopColor: "#182121", backgroundColor: "#0D1213", flexDirection: "row" },
});
