import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import type { ApiClient } from "../api/client";
import { createPairingClient, parsePairingPayload } from "../api/client";
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
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [pairingInput, setPairingInput] = useState("");
  const [deviceName, setDeviceName] = useState("Reece iPhone");
  const [error, setError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const pairingPayload = parsePairingPayload(pairingInput);
  const endpoint = pairingPayload?.endpoint ?? apiUrl;

  function updatePairingInput(value: string) {
    setPairingInput(value);
    const payload = parsePairingPayload(value);
    if (payload) {
      onApiUrlChange(payload.endpoint);
    }
  }

  function handleBarcodeScanned(result: BarcodeScanningResult) {
    setIsScanning(false);
    updatePairingInput(result.data);
  }

  async function pair() {
    setError(null);
    setIsPairing(true);

    try {
      const client = createPairingClient(endpoint);
      const pairing = await client.completePairing({
        appVersion: "0.1.0",
        code: pairingPayload?.manualCode ?? pairingInput.trim(),
        deviceName,
        endpoint,
        pairingSecret: pairingPayload?.pairingSecret,
        relayId: pairingPayload?.relayId,
        transport: pairingPayload?.transport
      });
      onPaired({
        ...pairing,
        apiUrl: endpoint,
        macId: pairingPayload?.macId ?? pairing.macId,
        relayId: pairingPayload?.relayId ?? pairing.relayId,
        transport: pairingPayload?.transport ?? pairing.transport
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to pair iPhone");
    } finally {
      setIsPairing(false);
    }
  }

  async function startScanning() {
    setError(null);
    if (!cameraPermission?.granted) {
      const nextPermission = await requestCameraPermission();
      if (!nextPermission.granted) {
        setError("Camera permission is required to scan the Mac pairing QR code.");
        return;
      }
    }

    setIsScanning(true);
  }

  return (
    <Screen>
      <Header
        eyebrow="Abitat Mobile"
        title="Pair iPhone"
        subtitle="Scan the QR code from `abitat iphone` or paste its manual payload."
      />

      {isScanning ? (
        <View style={styles.cameraFrame}>
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarcodeScanned}
            style={StyleSheet.absoluteFill}
          />
        </View>
      ) : null}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Mac endpoint</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onApiUrlChange}
          placeholder="http://100.x.y.z:3901"
          placeholderTextColor={colors.muted}
          style={[sharedStyles.input, { marginTop: 8 }]}
          value={apiUrl}
        />
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Pairing payload or manual code</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          onChangeText={updatePairingInput}
          placeholder='{"product":"abitat",...}'
          placeholderTextColor={colors.muted}
          style={[sharedStyles.input, styles.payloadInput]}
          value={pairingInput}
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

      <Button disabled={isPairing} onPress={startScanning}>
        Scan QR
      </Button>
      <Button disabled={isPairing || pairingInput.trim().length === 0} onPress={pair}>
        {isPairing ? "Pairing" : "Pair with Mac"}
      </Button>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cameraFrame: {
    backgroundColor: colors.surfaceHigh,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 280,
    overflow: "hidden"
  },
  payloadInput: {
    marginTop: 8,
    minHeight: 104,
    textAlignVertical: "top"
  }
});
