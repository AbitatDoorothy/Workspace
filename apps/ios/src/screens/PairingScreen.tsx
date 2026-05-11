import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";

import type { ApiClient } from "../api/client";
import { createPairingClient, parsePairingPayload } from "../api/client";
import { colors } from "../theme";
import type { PairingState } from "../types";

interface PairingScreenProps {
  api: ApiClient;
  apiUrl: string;
  onApiUrlChange(apiUrl: string): void;
  onPaired(pairing: PairingState): void;
}

const ONBOARDING_STARS = [
  { left: "6%", opacity: 0.24, size: 1, top: "6%" },
  { left: "24%", opacity: 0.32, size: 1, top: "10%" },
  { left: "48%", opacity: 0.26, size: 1, top: "17%" },
  { left: "72%", opacity: 0.34, size: 1, top: "8%" },
  { left: "90%", opacity: 0.28, size: 1, top: "14%" },
  { left: "18%", opacity: 0.24, size: 1, top: "28%" },
  { left: "38%", opacity: 0.46, size: 2, top: "25%" },
  { left: "54%", opacity: 0.34, size: 1.5, top: "27%" },
  { left: "82%", opacity: 0.22, size: 1, top: "31%" },
  { left: "12%", opacity: 0.28, size: 1, top: "47%" },
  { left: "43%", opacity: 0.42, size: 1.5, top: "51%" },
  { left: "56%", opacity: 0.5, size: 2, top: "49%" },
  { left: "76%", opacity: 0.24, size: 1, top: "45%" },
  { left: "20%", opacity: 0.3, size: 1, top: "72%" },
  { left: "47%", opacity: 0.22, size: 1, top: "68%" },
  { left: "66%", opacity: 0.26, size: 1, top: "74%" },
  { left: "91%", opacity: 0.2, size: 1, top: "86%" }
] as const;

export function PairingScreen({ apiUrl, onApiUrlChange, onPaired }: PairingScreenProps) {
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanLockRef = useRef(false);
  const [step, setStep] = useState<"name" | "pair">("name");
  const [pairingInput, setPairingInput] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  function updatePairingInput(value: string) {
    setPairingInput(value);
    const payload = parsePairingPayload(value);
    if (payload) {
      onApiUrlChange(payload.endpoint);
    }
  }

  function continueToPairing() {
    if (deviceName.trim().length === 0) {
      setError("Enter your name before pairing with your Mac.");
      return;
    }

    setError(null);
    setStep("pair");
  }

  async function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (isPairing || scanLockRef.current) {
      return;
    }

    scanLockRef.current = true;
    setIsScanning(false);
    updatePairingInput(result.data);
    await completePairing(result.data);
  }

  async function completePairing(rawInput: string) {
    const trimmedInput = rawInput.trim();
    const pairingPayload = parsePairingPayload(trimmedInput);
    const endpoint = pairingPayload?.endpoint ?? apiUrl;

    setError(null);
    if (!trimmedInput) {
      setError("Paste or scan the pairing payload from your Mac.");
      return;
    }

    if (!endpoint) {
      setError("The pairing payload is missing its endpoint.");
      return;
    }

    setIsPairing(true);

    try {
      if (pairingPayload) {
        onApiUrlChange(pairingPayload.endpoint);
      }

      const client = createPairingClient(endpoint);
      const pairing = await client.completePairing({
        appVersion: "0.1.0",
        code: pairingPayload?.manualCode ?? trimmedInput,
        deviceName: deviceName.trim(),
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

    scanLockRef.current = false;
    setIsScanning(true);
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.onboardingScreen}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
        <View style={styles.onboardingContent}>
          <View pointerEvents="none" style={styles.starField}>
            {ONBOARDING_STARS.map((star, index) => (
              <View
                key={`onboarding-star-${index}`}
                style={[
                  styles.star,
                  {
                    height: star.size,
                    left: star.left,
                    opacity: star.opacity,
                    top: star.top,
                    width: star.size
                  }
                ]}
              />
            ))}
            <View style={[styles.shootingStar, styles.shootingStarUpper]} />
            <View style={[styles.shootingStar, styles.shootingStarLower]} />
          </View>

          {step === "name" ? (
            <View style={styles.stepPanel}>
              <Text style={[styles.primaryFont, styles.identifyTitle]}>Identify yourself</Text>
              <TextInput
                autoCapitalize="words"
                autoCorrect={false}
                keyboardAppearance="dark"
                onChangeText={setDeviceName}
                placeholder="Enter your name"
                placeholderTextColor="rgba(255,255,255,0.24)"
                style={[styles.primaryFont, styles.textInput]}
                value={deviceName}
              />
              <Pressable
                accessibilityLabel="Continue to pairing"
                accessibilityRole="button"
                disabled={deviceName.trim().length === 0}
                onPress={continueToPairing}
                style={({ pressed }) => [
                  styles.nextButton,
                  pressed ? styles.buttonPressed : null,
                  deviceName.trim().length === 0 ? styles.disabledButton : null
                ]}
              >
                <Text style={[styles.primaryFont, styles.nextButtonText]}>Next</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.stepPanel}>
              <Text style={[styles.primaryFont, styles.pairTitle]}>Pair with your Mac</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardAppearance="dark"
                multiline
                onChangeText={updatePairingInput}
                placeholder="Enter payload manually"
                placeholderTextColor="rgba(255,255,255,0.28)"
                style={[styles.primaryFont, styles.textInput, styles.payloadInput]}
                value={pairingInput}
              />
              <Pressable
                accessibilityLabel="Pair with Mac"
                accessibilityRole="button"
                disabled={isPairing || pairingInput.trim().length === 0}
                onPress={() => void completePairing(pairingInput)}
                style={({ pressed }) => [
                  styles.pairButton,
                  pressed ? styles.buttonPressed : null,
                  isPairing || pairingInput.trim().length === 0 ? styles.disabledButton : null
                ]}
              >
                <Text style={[styles.primaryFont, styles.pairButtonText]}>
                  {isPairing ? "Pairing" : "Pair"}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Scan pairing QR code"
                accessibilityRole="button"
                disabled={isPairing}
                onPress={startScanning}
                style={({ pressed }) => [
                  styles.scanButton,
                  pressed ? styles.buttonPressed : null,
                  isPairing ? styles.disabledButton : null
                ]}
              >
                <MaterialIcons color="rgba(255,255,255,0.72)" name="qr-code-scanner" size={22} />
                <Text style={[styles.primaryFont, styles.scanButtonText]}>Scan</Text>
              </Pressable>
            </View>
          )}

          {error ? <Text style={[styles.primaryFont, styles.errorText]}>{error}</Text> : null}
        </View>
      </TouchableWithoutFeedback>

      <Modal
        animationType="fade"
        onRequestClose={() => {
          scanLockRef.current = false;
          setIsScanning(false);
        }}
        visible={isScanning}
      >
        <View style={styles.scannerOverlay}>
          <CameraView
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={handleBarcodeScanned}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.scannerFrame} />
          <Pressable
            accessibilityLabel="Close QR scanner"
            accessibilityRole="button"
            onPress={() => {
              scanLockRef.current = false;
              setIsScanning(false);
            }}
            style={styles.closeScannerButton}
          >
            <Text style={[styles.primaryFont, styles.closeScannerText]}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }]
  },
  closeScannerButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: 999,
    borderWidth: 1,
    bottom: 44,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 28,
    position: "absolute"
  },
  closeScannerText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "500",
    letterSpacing: 1.6
  },
  disabledButton: {
    opacity: 0.42
  },
  errorText: {
    bottom: 54,
    color: colors.danger,
    fontSize: 13,
    fontWeight: "500",
    left: 26,
    lineHeight: 18,
    position: "absolute",
    right: 26,
    textAlign: "center"
  },
  identifyTitle: {
    color: "#eeeeee",
    fontSize: 38,
    fontWeight: "300",
    letterSpacing: 0,
    lineHeight: 46,
    textAlign: "center"
  },
  nextButton: {
    alignItems: "center",
    alignSelf: "center",
    borderColor: "#ffffff",
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 70,
    minWidth: 250
  },
  nextButtonText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "400",
    letterSpacing: 3
  },
  onboardingScreen: {
    backgroundColor: "#000000",
    flex: 1
  },
  onboardingContent: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    width: "100%"
  },
  pairButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 60,
    width: "100%"
  },
  pairButtonText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 18,
    fontWeight: "500",
    letterSpacing: 1.5
  },
  pairTitle: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 6,
    lineHeight: 36,
    textAlign: "center",
    textTransform: "uppercase"
  },
  payloadInput: {
    maxHeight: 122,
    minHeight: 62,
    paddingTop: 20,
    textAlignVertical: "top"
  },
  primaryFont: {
    fontFamily: "System"
  },
  scanButton: {
    alignItems: "center",
    alignSelf: "center",
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    minHeight: 68,
    paddingHorizontal: 34
  },
  scanButtonText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 18,
    fontWeight: "500",
    letterSpacing: 1.5
  },
  scannerFrame: {
    borderColor: "rgba(255,255,255,0.72)",
    borderRadius: 20,
    borderWidth: 2,
    height: 260,
    width: 260
  },
  scannerOverlay: {
    alignItems: "center",
    backgroundColor: "#000000",
    flex: 1,
    justifyContent: "center"
  },
  shootingStar: {
    backgroundColor: "#ffffff",
    height: 1,
    opacity: 0.12,
    position: "absolute",
    shadowColor: "#e2e2ff",
    shadowOpacity: 0.45,
    shadowRadius: 10
  },
  shootingStarLower: {
    left: "18%",
    top: "71%",
    transform: [{ rotate: "-20deg" }],
    width: 132
  },
  shootingStarUpper: {
    left: "62%",
    top: "16%",
    transform: [{ rotate: "140deg" }],
    width: 118
  },
  star: {
    backgroundColor: "#ffffff",
    borderRadius: 999,
    position: "absolute"
  },
  starField: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000"
  },
  stepPanel: {
    alignItems: "center",
    gap: 24,
    maxWidth: 620,
    width: "100%"
  },
  textInput: {
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 16,
    borderWidth: 1,
    color: "#eeeeee",
    fontSize: 18,
    fontWeight: "400",
    minHeight: 72,
    paddingHorizontal: 28,
    textAlign: "center",
    width: "100%"
  }
});
