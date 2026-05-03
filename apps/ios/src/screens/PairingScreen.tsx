import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import type { ApiClient } from "../api/client";
import { Button, Header } from "../components/Controls";
import { Screen } from "../components/Screen";
import { colors, sharedStyles } from "../theme";
import type { PairingState } from "../types";

interface PairingScreenProps {
  api: ApiClient;
  apiUrl: string;
  onApiUrlChange(apiUrl: string): void;
  onPaired(pairing: PairingState): void;
}

export function PairingScreen({ api, apiUrl, onApiUrlChange, onPaired }: PairingScreenProps) {
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("Reece iPhone");
  const [error, setError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);

  async function pair() {
    setError(null);
    setIsPairing(true);

    try {
      const pairing = await api.completePairing({
        appVersion: "0.1.0",
        code,
        deviceName
      });
      onPaired(pairing);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to pair iPhone");
    } finally {
      setIsPairing(false);
    }
  }

  return (
    <Screen>
      <Header
        eyebrow="Abitat Mobile"
        title="Pair iPhone"
        subtitle="Enter the short code shown on your Mac dashboard."
      />

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>API</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onApiUrlChange}
          placeholder="https://workspace.abitat.io"
          placeholderTextColor={colors.muted}
          style={[sharedStyles.input, { marginTop: 8 }]}
          value={apiUrl}
        />
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Pairing code</Text>
        <TextInput
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={setCode}
          placeholder="ABITAT-123456"
          placeholderTextColor={colors.muted}
          style={[sharedStyles.input, { fontSize: 20, marginTop: 8 }]}
          value={code}
        />
        <Text style={[sharedStyles.label, { marginTop: 16 }]}>Device name</Text>
        <TextInput
          onChangeText={setDeviceName}
          placeholder="iPhone"
          placeholderTextColor={colors.muted}
          style={[sharedStyles.input, { marginTop: 8 }]}
          value={deviceName}
        />
      </View>

      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}

      <Button disabled={isPairing || code.trim().length === 0} onPress={pair}>
        {isPairing ? "Pairing" : "Pair with Mac"}
      </Button>
    </Screen>
  );
}
