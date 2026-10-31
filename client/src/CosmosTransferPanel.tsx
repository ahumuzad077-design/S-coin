import { useState } from "react";
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
  createScoinTransferPreview,
  submitScoinTransfer,
  type ScoinTransferPreview,
} from "./cosmosTransfers";
import type { WalletConnection } from "./walletAdapters";
import { formatScoin } from "./chain";

interface ScoinTransferPanelProps {
  chainId: string;
  wallet: WalletConnection | null;
  onTransferComplete?: () => Promise<void> | void;
}

const colors = {
  accent: "#B7D98B",
  border: "#293536",
  ink: "#E5EDEA",
  muted: "#93A09D",
  red: "#EF8E83",
  panel: "#121A1B",
  panelRaised: "#182322",
};

export function ScoinTransferPanel({
  chainId,
  wallet,
  onTransferComplete,
}: ScoinTransferPanelProps) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("1");
  const [memo, setMemo] = useState("");
  const [preview, setPreview] = useState<ScoinTransferPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [transactionHeight, setTransactionHeight] = useState<number | null>(null);

  const enabled =
    Platform.OS === "web" &&
    process.env.EXPO_PUBLIC_SCOIN_COSMOS_SEND_ENABLED === "true" &&
    Boolean(process.env.EXPO_PUBLIC_SCOIN_RPC_URL?.trim()) &&
    Boolean(process.env.EXPO_PUBLIC_SCOIN_CHAIN_ID?.trim()) &&
    Boolean(process.env.EXPO_PUBLIC_SCOIN_GAS_PRICE?.trim());

  const prepare = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    setPreview(null);
    setTransactionHash("");
    setTransactionHeight(null);
    try {
      if (!wallet || wallet.kind !== "cosmos") {
        throw new Error("Connect the S Coin account with Keplr before preparing a transfer.");
      }
      if (!enabled) {
        throw new Error("S Coin sending is disabled. The operator must configure a verified RPC, exact chain ID, approved gas price and enable the feature.");
      }
      const nextPreview = await createScoinTransferPreview({
        chainId,
        from: wallet.address,
        to: recipient.trim(),
        amount: amount.trim(),
        memo: memo.trim(),
      });
      setPreview(nextPreview);
      setNotice("Transfer simulated successfully. Review the amount and estimated fee before asking Keplr to sign.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not prepare this S Coin transfer.",
      );
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    setLoading(true);
    setError("");
    try {
      if (!wallet || wallet.kind !== "cosmos" || !preview) {
        throw new Error("Prepare and review a transfer before continuing.");
      }
      const result = await submitScoinTransfer(preview);
      setTransactionHash(result.transactionHash);
      setTransactionHeight(result.height);
      setPreview(null);
      setNotice("S Coin transfer confirmed in a block. The transaction was signed by Keplr.");
      await onTransferComplete?.();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Keplr could not complete the S Coin transfer.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.eyebrow}>NATIVE COSMOS · S COIN</Text>
      <Text style={styles.title}>Send S Coin</Text>
      <Text style={styles.muted}>
        Uses the Keplr browser extension and the S Coin CometBFT RPC. The app
        never receives your recovery phrase or private key.
      </Text>

      {Platform.OS !== "web" ? (
        <Text style={styles.warning}>
          Native Keplr mobile pairing is not configured. Open the S Coin web
          app in a browser with the Keplr extension.
        </Text>
      ) : !wallet || wallet.kind !== "cosmos" ? (
        <Text style={styles.smallPrint}>Connect Keplr above to prepare an S Coin transfer.</Text>
      ) : !enabled ? (
        <Text style={styles.warning}>
          Sending is currently locked. The network operator must provide the
          verified RPC URL, exact chain ID and approved gas price before
          native S Coin transfers can be enabled.
        </Text>
      ) : (
        <>
          <View style={styles.accountCard}>
            <Text style={styles.label}>CONNECTED S COIN ACCOUNT</Text>
            <Text selectable style={styles.address}>{wallet.address}</Text>
            <Text style={styles.smallPrint}>Chain: {chainId}</Text>
          </View>

          <Text style={styles.label}>RECIPIENT ADDRESS</Text>
          <TextInput
            accessibilityLabel="S Coin recipient address"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => {
              setRecipient(value);
              setPreview(null);
              setTransactionHash("");
            }}
            placeholder="scoin1…"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={recipient}
          />
          <Text style={styles.label}>AMOUNT · S</Text>
          <TextInput
            accessibilityLabel="S Coin transfer amount"
            keyboardType="decimal-pad"
            onChangeText={(value) => {
              setAmount(value);
              setPreview(null);
              setTransactionHash("");
            }}
            placeholder="1"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={amount}
          />
          <Text style={styles.label}>MEMO (OPTIONAL)</Text>
          <TextInput
            accessibilityLabel="S Coin transfer memo"
            onChangeText={(value) => {
              setMemo(value);
              setPreview(null);
            }}
            placeholder="Payment note"
            placeholderTextColor={colors.muted}
            maxLength={256}
            style={styles.input}
            value={memo}
          />

          {preview ? (
            <View style={styles.review}>
              <Text style={styles.reviewTitle}>TRANSFER REVIEW</Text>
              <Text style={styles.reviewLine}>From: {preview.from}</Text>
              <Text style={styles.reviewLine}>To: {preview.to}</Text>
              <Text style={styles.amount}>
                {formatScoin(preview.amountBaseUnits)} S
              </Text>
              <Text style={styles.reviewLine}>
                Estimated network fee: {formatScoin(preview.feeAmount)} S
              </Text>
              <Text style={styles.reviewLine}>
                Required total: {formatScoin(preview.totalRequired)} S
              </Text>
              <Text style={styles.reviewLine}>
                Simulated gas limit: {preview.gasLimit.toLocaleString()}
              </Text>
              <Text style={styles.smallPrint}>
                The fee is re-simulated before submission. Keplr will show the
                final transaction and require your approval.
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={loading || !recipient.trim() || !amount.trim()}
            onPress={() => void prepare()}
            style={[styles.secondaryButton, (loading || !recipient.trim() || !amount.trim()) && styles.disabled]}
          >
            {loading && !preview ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <Text style={styles.secondaryButtonText}>Simulate & estimate fee</Text>
            )}
          </Pressable>
          {preview ? (
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={() => void confirm()}
              style={[styles.primaryButton, loading && styles.disabled]}
            >
              {loading ? (
                <ActivityIndicator color="#0B130B" />
              ) : (
                <Text style={styles.primaryButtonText}>Continue to Keplr approval</Text>
              )}
            </Pressable>
          ) : null}
        </>
      )}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {transactionHash ? (
        <View style={styles.review}>
          <Text style={styles.reviewTitle}>S COIN TRANSACTION CONFIRMED</Text>
          <Text selectable style={styles.reviewLine}>{transactionHash}</Text>
          {transactionHeight !== null ? (
            <Text style={styles.reviewLine}>Block height: {transactionHeight}</Text>
          ) : null}
        </View>
      ) : null}
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
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  title: { color: colors.ink, fontSize: 18, fontWeight: "800", marginTop: 7 },
  muted: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 7 },
  smallPrint: { color: colors.muted, fontSize: 9, lineHeight: 15, marginTop: 8 },
  warning: { color: "#EFCB89", fontSize: 10, lineHeight: 17, marginTop: 13 },
  label: { color: colors.muted, fontSize: 9, letterSpacing: 1.1, fontWeight: "800", marginTop: 14, marginBottom: 7 },
  input: { minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: "#0B1112", color: colors.ink, paddingHorizontal: 12, fontSize: 12 },
  accountCard: { backgroundColor: colors.panelRaised, borderRadius: 9, padding: 12, marginTop: 13 },
  address: { color: colors.ink, fontSize: 10, marginTop: 5 },
  review: { backgroundColor: colors.panelRaised, borderRadius: 9, borderWidth: 1, borderColor: "#475D3E", padding: 12, marginTop: 13 },
  reviewTitle: { color: colors.accent, fontSize: 10, fontWeight: "800" },
  reviewLine: { color: colors.ink, fontSize: 9, marginTop: 7, lineHeight: 14 },
  amount: { color: colors.accent, fontSize: 22, fontWeight: "800", marginTop: 12 },
  primaryButton: { minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, marginTop: 12 },
  primaryButtonText: { color: "#0B130B", fontSize: 10, fontWeight: "800" },
  secondaryButton: { minHeight: 42, alignItems: "center", justifyContent: "center", borderColor: colors.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, marginTop: 10 },
  secondaryButtonText: { color: colors.ink, fontSize: 10, fontWeight: "800" },
  disabled: { opacity: 0.55 },
  notice: { color: colors.accent, fontSize: 10, lineHeight: 16, marginTop: 12 },
  error: { color: colors.red, fontSize: 10, lineHeight: 16, marginTop: 12 },
});
