import { Platform, useWindowDimensions } from "react-native";
import { ExchangeHub } from "../ExchangeHub";

const apiUrl =
  process.env.EXPO_PUBLIC_SCOIN_API_URL ??
  (Platform.OS === "web"
    ? "http://127.0.0.1:8787"
    : Platform.OS === "android"
      ? "http://10.0.2.2:1317"
      : "http://127.0.0.1:1317");

export default function MarketsRoute() {
  const { width } = useWindowDimensions();

  return (
    <ExchangeHub
      compact={width < 760}
      apiUrl={apiUrl}
      chainId={process.env.EXPO_PUBLIC_SCOIN_CHAIN_ID ?? ""}
    />
  );
}
