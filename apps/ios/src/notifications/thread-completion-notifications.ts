import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";

import type { ApiClient } from "../api/client";

const PUSH_REGISTRATION_RETRY_INTERVAL_MS = 30000;
const PUSH_TOKEN_TIMEOUT_MS = 10000;

let notificationPermissionPromise: Promise<boolean> | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export function rememberRunningConversation(_conversationId: string) {
  // Server-side Expo push is the single user-visible completion notification source.
}

export function useThreadCompletionNotifications(api: ApiClient, isEnabled: boolean) {
  const registeredTokenRef = useRef<string | null>(null);
  const isRegisteringPushRef = useRef(false);
  const lastPushRegistrationAttemptAtRef = useRef(0);
  const lastPushRegistrationWarningRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isEnabled) {
      registeredTokenRef.current = null;
      return;
    }

    let cancelled = false;

    async function registerForPushNotifications() {
      if (cancelled || registeredTokenRef.current || isRegisteringPushRef.current) {
        return;
      }

      const now = Date.now();
      if (
        lastPushRegistrationAttemptAtRef.current > 0 &&
        now - lastPushRegistrationAttemptAtRef.current < PUSH_REGISTRATION_RETRY_INTERVAL_MS
      ) {
        return;
      }

      lastPushRegistrationAttemptAtRef.current = now;
      isRegisteringPushRef.current = true;
      try {
        if (!(await ensureNotificationPermission())) {
          await warnAndReportPushRegistration(
            lastPushRegistrationWarningRef,
            api,
            "permission",
            "Remote push notifications are disabled because notification permission was not granted."
          );
          return;
        }

        const options = pushTokenOptions();
        if (!options) {
          await warnAndReportPushRegistration(
            lastPushRegistrationWarningRef,
            api,
            "project-id",
            "Remote push notifications are disabled because app.json is missing expo.extra.eas.projectId."
          );
          return;
        }

        let token: Notifications.ExpoPushToken;
        try {
          token = await withPushRegistrationTimeout(
            Notifications.getExpoPushTokenAsync(options),
            PUSH_TOKEN_TIMEOUT_MS
          );
        } catch (error) {
          await warnAndReportPushRegistration(
            lastPushRegistrationWarningRef,
            api,
            "expo-token",
            `Remote push token request failed: ${errorMessage(error)}`
          );
          return;
        }

        if (cancelled || registeredTokenRef.current === token.data) {
          return;
        }

        try {
          await api.registerPushToken({
            platform: "ios",
            provider: "expo",
            token: token.data
          });
        } catch (error) {
          await warnAndReportPushRegistration(
            lastPushRegistrationWarningRef,
            api,
            "server-register",
            `Remote push token server registration failed: ${errorMessage(error)}`
          );
          return;
        }

        registeredTokenRef.current = token.data;
      } catch (error) {
        await warnAndReportPushRegistration(
          lastPushRegistrationWarningRef,
          api,
          "unexpected",
          `Remote push notification registration failed: ${errorMessage(error)}`
        );
      } finally {
        isRegisteringPushRef.current = false;
      }
    }

    void registerForPushNotifications();
    const interval = setInterval(() => {
      void registerForPushNotifications();
    }, PUSH_REGISTRATION_RETRY_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [api, isEnabled]);
}

function pushTokenOptions() {
  const constants = Constants as typeof Constants & {
    easConfig?: { projectId?: string };
  };
  const projectId =
    constants.easConfig?.projectId ??
    (typeof constants.expoConfig?.extra?.eas === "object" && constants.expoConfig.extra.eas !== null
      ? (constants.expoConfig.extra.eas as { projectId?: string }).projectId
      : undefined);

  return projectId ? { projectId } : undefined;
}

function warnPushRegistration(ref: { current: string | null }, message: string) {
  if (ref.current === message) {
    return;
  }

  ref.current = message;
  console.warn(`[notifications] ${message}`);
}

async function warnAndReportPushRegistration(
  ref: { current: string | null },
  api: ApiClient,
  stage: string,
  message: string
) {
  warnPushRegistration(ref, message);

  try {
    await api.reportPushRegistrationIssue({ message, stage });
  } catch {
    // Diagnostics should never block foreground polling or the next registration retry.
  }
}

async function ensureNotificationPermission() {
  notificationPermissionPromise ??= (async () => {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      return true;
    }

    const requested = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: false,
        allowSound: true
      }
    });
    return requested.granted;
  })();

  try {
    return await notificationPermissionPromise;
  } catch {
    notificationPermissionPromise = null;
    return false;
  }
}

function withPushRegistrationTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Expo push token request timed out after ${timeoutMs / 1000} seconds`));
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    }),
    timeoutPromise
  ]);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
