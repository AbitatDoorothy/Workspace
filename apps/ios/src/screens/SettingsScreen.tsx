import { Text, View } from "react-native";

import { Button, Header } from "../components/Controls";
import { Screen } from "../components/Screen";
import { sharedStyles } from "../theme";
import type { PairingState } from "../types";

interface SettingsScreenProps {
  pairing: PairingState | null;
  onSignOut(): void;
}

export function SettingsScreen({ pairing, onSignOut }: SettingsScreenProps) {
  return (
    <Screen>
      <Header eyebrow="Settings" title="Device" subtitle="Manage this iPhone pairing." />

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>API</Text>
        <Text style={[sharedStyles.value, { marginTop: 4 }]}>
          {pairing?.apiUrl ?? "Not paired"}
        </Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Phone machine</Text>
        <Text style={[sharedStyles.value, { marginTop: 4 }]}>
          {pairing?.machineId ?? "Not paired"}
        </Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Mac host</Text>
        <Text style={[sharedStyles.value, { marginTop: 4 }]}>
          {pairing?.hostMachineId ?? "Not paired"}
        </Text>
      </View>

      <Button onPress={onSignOut} variant="danger">
        Sign Out
      </Button>
    </Screen>
  );
}
