import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export interface BinanceTestnetCredentials {
  apiKey: string;
  apiSecret: string;
}

const API_KEY_STORAGE = "scoin.binance.spot-testnet.api-key";
const API_SECRET_STORAGE = "scoin.binance.spot-testnet.api-secret";
let webSessionCredentials: BinanceTestnetCredentials | null = null;

function validateCredentials(credentials: BinanceTestnetCredentials): BinanceTestnetCredentials {
  const apiKey = credentials.apiKey.trim();
  const apiSecret = credentials.apiSecret.trim();
  if (!apiKey || !apiSecret || apiKey.length > 256 || apiSecret.length > 256) {
    throw new Error("Enter a valid Binance Spot Testnet API key and secret.");
  }
  return { apiKey, apiSecret };
}

/**
 * Mobile builds store testnet credentials in the operating system's secure
 * key-value store. Web builds keep them in memory for this tab/session only;
 * they are never written to localStorage, cookies or the app server.
 */
export async function saveBinanceTestnetCredentials(
  input: BinanceTestnetCredentials,
): Promise<void> {
  const credentials = validateCredentials(input);
  if (Platform.OS === "web") {
    webSessionCredentials = credentials;
    return;
  }
  await Promise.all([
    SecureStore.setItemAsync(API_KEY_STORAGE, credentials.apiKey),
    SecureStore.setItemAsync(API_SECRET_STORAGE, credentials.apiSecret),
  ]);
}

export async function loadBinanceTestnetCredentials(): Promise<BinanceTestnetCredentials | null> {
  if (Platform.OS === "web") return webSessionCredentials;
  const [apiKey, apiSecret] = await Promise.all([
    SecureStore.getItemAsync(API_KEY_STORAGE),
    SecureStore.getItemAsync(API_SECRET_STORAGE),
  ]);
  if (!apiKey || !apiSecret) return null;
  return validateCredentials({ apiKey, apiSecret });
}

export async function clearBinanceTestnetCredentials(): Promise<void> {
  webSessionCredentials = null;
  if (Platform.OS === "web") return;
  await Promise.all([
    SecureStore.deleteItemAsync(API_KEY_STORAGE),
    SecureStore.deleteItemAsync(API_SECRET_STORAGE),
  ]);
}
