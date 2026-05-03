import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createApiClient, createPairingClient } from "../api/client";
import type { PairingState } from "../types";

const STORAGE_KEY = "abitat.mobile.pairing";
const DEFAULT_API_URL = "https://workspace.abitat.io";

export function useMobileStore() {
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [isRestoring, setIsRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;

    SecureStore.getItemAsync(STORAGE_KEY)
      .then((raw) => {
        if (cancelled || !raw) {
          return;
        }

        const restored = JSON.parse(raw) as PairingState;
        setPairing(restored);
        setApiUrl(restored.apiUrl);
      })
      .finally(() => {
        if (!cancelled) {
          setIsRestoring(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const api = useMemo(
    () => (pairing ? createApiClient(pairing) : createPairingClient(apiUrl)),
    [apiUrl, pairing]
  );

  const savePairing = useCallback(
    async (nextPairing: PairingState) => {
      setPairing(nextPairing);
      setApiUrl(nextPairing.apiUrl);
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(nextPairing));
    },
    [setPairing]
  );

  const signOut = useCallback(async () => {
    setPairing(null);
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }, []);

  return {
    api,
    apiUrl,
    isPaired: Boolean(pairing),
    isRestoring,
    pairing,
    savePairing,
    setApiUrl,
    signOut
  };
}
