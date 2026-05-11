import { Text, View } from "react-native";

import { Button, Header, StatusPill } from "../components/Controls";
import { Screen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type { MobileBootstrap, PairingState } from "../types";

interface SettingsScreenProps {
  bootstrap: MobileBootstrap | null;
  error: string | null;
  onBack(): void;
  pairing: PairingState | null;
  onSignOut(): void;
}

export function SettingsScreen({
  bootstrap,
  error,
  onBack,
  pairing,
  onSignOut
}: SettingsScreenProps) {
  return (
    <Screen>
      <Header
        eyebrow="Settings"
        title={bootstrap?.workspace.name ?? "Abitat"}
        subtitle="Manage this iPhone pairing and paired Mac connection."
      />

      <View style={sharedStyles.card}>
        <View style={[sharedStyles.row, { justifyContent: "space-between" }]}>
          <View style={{ flex: 1 }}>
            <Text style={sharedStyles.label}>Mac host</Text>
            <Text style={[sharedStyles.value, { marginTop: 4 }]}>
              {bootstrap?.host?.name ?? "Checking host"}
            </Text>
          </View>
          <StatusPill status={bootstrap?.host?.status ?? "checking"} />
        </View>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Phone</Text>
        <Text style={[sharedStyles.value, { marginTop: 4 }]}>
          {bootstrap?.phone.name ?? "This iPhone"}
        </Text>
      </View>

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

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
        <Text style={sharedStyles.label}>Mac host ID</Text>
        <Text style={[sharedStyles.value, { marginTop: 4 }]}>
          {pairing?.hostMachineId ?? "Not paired"}
        </Text>
      </View>

      <Button onPress={onBack} variant="secondary">
        Back to Projects
      </Button>

      <Button onPress={onSignOut} variant="danger">
        Sign Out
      </Button>
    </Screen>
  );
}
