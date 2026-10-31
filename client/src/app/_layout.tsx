import { Stack } from "expo-router";

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="markets"
        options={{ headerShown: true, title: "S Coin Markets" }}
      />
    </Stack>
  );
}
