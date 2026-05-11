import type { ReactNode } from "react";
import { ScrollView, StatusBar, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { sharedStyles } from "../theme";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={sharedStyles.screen}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 34 }}>{children}</ScrollView>
    </SafeAreaView>
  );
}

export function FixedScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={sharedStyles.screen}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, gap: 12 }}>{children}</View>
    </SafeAreaView>
  );
}
