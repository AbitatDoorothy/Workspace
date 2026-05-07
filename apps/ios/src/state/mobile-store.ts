import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createApiClient, createPairingClient } from "../api/client";
import type { MobileBootstrap, PairingState } from "../types";

const STORAGE_KEY = "abitat.mobile.pairing";
const DEFAULT_API_URL = "https://workspace.abitat.io";
const BOOTSTRAP_POLL_INTERVAL_MS = 5000;

export function useMobileStore() {
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
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

  useEffect(() => {
    if (!pairing) {
      setBootstrap(null);
      setBootstrapError(null);
      return;
    }

    const currentPairing = pairing;
    let cancelled = false;

    async function refreshBootstrap() {
      try {
        const nextBootstrap = await createApiClient(currentPairing).bootstrap();

        if (!cancelled) {
          setBootstrap(nextBootstrap);
          setBootstrapError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setBootstrapError(caught instanceof Error ? caught.message : "Unable to load workspace");
        }
      }
    }

    void refreshBootstrap();
    const timer = setInterval(refreshBootstrap, BOOTSTRAP_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pairing]);

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
    bootstrap,
    bootstrapError,
    isPaired: Boolean(pairing),
    isRestoring,
    pairing,
    savePairing,
    setApiUrl,
    signOut
  };
}
