import { Text, View } from "react-native";

import { Button, Header, StatusPill } from "../components/Controls";
import { Screen } from "../components/Screen";
import { sharedStyles } from "../theme";
import type { MobileBootstrap, RouteName } from "../types";

interface WorkspaceScreenProps {
  bootstrap: MobileBootstrap | null;
  error: string | null;
  onNavigate(route: RouteName): void;
}

export function WorkspaceScreen({ bootstrap, error, onNavigate }: WorkspaceScreenProps) {
  return (
    <Screen>
      <Header
        eyebrow="Workspace"
        title={bootstrap?.workspace.name ?? "Abitat"}
        subtitle="Your paired Mac keeps running Codex locally."
      />

      <View style={sharedStyles.card}>
        <View style={[sharedStyles.row, { justifyContent: "space-between" }]}>
          <View>
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

      {error ? <Text style={{ color: "#ef4444" }}>{error}</Text> : null}

      <Button onPress={() => onNavigate("projects")}>Open Projects</Button>
    </Screen>
  );
}
