import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import type { ApiClient } from "../api/client";
import { Button, Header, StatusPill } from "../components/Controls";
import { Screen } from "../components/Screen";
import { sharedStyles } from "../theme";
import type { MobileBootstrap, RouteName } from "../types";

interface WorkspaceScreenProps {
  api: ApiClient;
  onNavigate(route: RouteName): void;
}

export function WorkspaceScreen({ api, onNavigate }: WorkspaceScreenProps) {
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .bootstrap()
      .then(setBootstrap)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Unable to load workspace")
      );
  }, [api]);

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
              {bootstrap?.host?.name ?? "Waiting for host"}
            </Text>
          </View>
          <StatusPill status={bootstrap?.host?.status ?? "pending"} />
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
