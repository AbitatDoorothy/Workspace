import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface SettingsScreenProps {
  onBack(): void;
  onSignOut(): void;
}

export function SettingsScreen({ onSignOut }: SettingsScreenProps) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.settingsScreen}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <View style={styles.settingsPanel}>
        <Text accessibilityRole="header" style={styles.brand}>
          ABITAT
        </Text>
        <Pressable
          accessibilityLabel="Disconnect iPhone from Mac"
          accessibilityRole="button"
          onPress={onSignOut}
          style={({ pressed }) => [
            styles.disconnectButton,
            pressed ? styles.disconnectButtonPressed : null
          ]}
        >
          <Text style={styles.disconnectButtonText}>DISCONNECT</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: {
    color: "#e6e6e6",
    fontSize: 36,
    fontWeight: "300",
    letterSpacing: 0,
    lineHeight: 44
  },
  disconnectButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.22)",
    borderRadius: 4,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 50,
    minWidth: 272,
    paddingHorizontal: 32
  },
  disconnectButtonPressed: {
    opacity: 0.68,
    transform: [{ scale: 0.99 }]
  },
  disconnectButtonText: {
    color: "#f3f3f3",
    fontSize: 15,
    fontWeight: "400",
    letterSpacing: 7,
    lineHeight: 20
  },
  settingsPanel: {
    alignItems: "center",
    gap: 28,
    justifyContent: "center",
    transform: [{ translateY: -18 }]
  },
  settingsScreen: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center"
  }
});
