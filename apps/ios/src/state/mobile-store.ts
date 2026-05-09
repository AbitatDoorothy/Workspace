import * as SecureStore from "expo-secure-store";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createApiClient, createPairingClient } from "../api/client";
import { DEFAULT_CODEX_MODEL_SETTINGS, isCodexReasoningEffort } from "../codex-model-settings";
import type { CodexMobileModelSettings, MobileBootstrap, PairingState } from "../types";

const STORAGE_KEY = "abitat.mobile.pairing";
const MODEL_SETTINGS_STORAGE_KEY = "abitat.mobile.modelSettings";
const DEFAULT_API_URL = "http://127.0.0.1:3901";
const BOOTSTRAP_POLL_INTERVAL_MS = 5000;

export function useMobileStore() {
  const [pairing, setPairing] = useState<PairingState | null>(null);
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [bootstrap, setBootstrap] = useState<MobileBootstrap | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const [modelSettings, setModelSettings] = useState<CodexMobileModelSettings>(
    DEFAULT_CODEX_MODEL_SETTINGS
  );

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      SecureStore.getItemAsync(STORAGE_KEY),
      SecureStore.getItemAsync(MODEL_SETTINGS_STORAGE_KEY)
    ])
      .then(([rawPairing, rawModelSettings]) => {
        if (cancelled) {
          return;
        }

        if (rawPairing) {
          const restored = JSON.parse(rawPairing) as PairingState;
          setPairing(restored);
          setApiUrl(restored.apiUrl);
        }

        const restoredModelSettings = parseModelSettings(rawModelSettings);
        if (restoredModelSettings) {
          setModelSettings(restoredModelSettings);
        }
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
    setModelSettings(DEFAULT_CODEX_MODEL_SETTINGS);
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    await SecureStore.deleteItemAsync(MODEL_SETTINGS_STORAGE_KEY);
  }, []);

  const saveModelSettings = useCallback(async (nextModelSettings: CodexMobileModelSettings) => {
    setModelSettings(nextModelSettings);
    await SecureStore.setItemAsync(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(nextModelSettings));
  }, []);

  return {
    api,
    apiUrl,
    bootstrap,
    bootstrapError,
    isPaired: Boolean(pairing),
    isRestoring,
    modelSettings,
    pairing,
    savePairing,
    saveModelSettings,
    setApiUrl,
    signOut
  };
}

function parseModelSettings(raw: string | null): CodexMobileModelSettings | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { effort?: unknown; model?: unknown };

    if (typeof parsed.model !== "string" || !parsed.model.trim()) {
      return null;
    }

    if (!isCodexReasoningEffort(parsed.effort)) {
      return null;
    }

    return {
      model: parsed.model.trim(),
      effort: parsed.effort
    };
  } catch {
    return null;
  }
}
