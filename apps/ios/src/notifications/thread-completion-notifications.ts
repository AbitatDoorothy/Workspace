import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";

import type { ApiClient } from "../api/client";

const PUSH_REGISTRATION_RETRY_INTERVAL_MS = 30000;
const PUSH_TOKEN_TIMEOUT_MS = 10000;

export const CODEX_COMPLETION_NOTIFICATION_SOUNDS = [
  "codex-done-1.wav",
  "codex-done-2.wav",
  "codex-done-3.wav"
] as const;

let notificationPermissionPromise: Promise<boolean> | null = null;

export interface CodexCompletionNotificationTarget {
  conversationId: string;
  projectId: string;
  projectName?: string;
  prompt?: string;
  status?: string;
  turnId?: string;
  workspaceId?: string;
}

type OpenConversationFromNotification = (
  target: CodexCompletionNotificationTarget
) => Promise<void> | void;

Notifications.setNotificationHandler({
  handleNotification: async (notification) =>
    shouldMirrorForegroundNotification(notification)
      ? silentNotificationBehavior()
      : visibleNotificationBehavior()
});

export function rememberRunningConversation(_conversationId: string) {
  // The paired Mac sends Expo push notifications when Codex turns finish.
}

export function useThreadCompletionNotifications(
  api: ApiClient,
  isEnabled: boolean,
  onOpenConversation?: OpenConversationFromNotification
) {
  const registeredTokenRef = useRef<string | null>(null);
  const isRegisteringPushRef = useRef(false);
  const lastPushRegistrationAttemptAtRef = useRef(0);
  const lastPushRegistrationWarningRef = useRef<string | null>(null);
  const lastHandledNotificationResponseKeyRef = useRef<string | null>(null);
  const onOpenConversationRef = useRef(onOpenConversation);

  useEffect(() => {
    onOpenConversationRef.current = onOpenConversation;
  }, [onOpenConversation]);

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

  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      void mirrorForegroundCodexCompletionNotification(notification);
    });

    return () => {
      subscription.remove();
    };
  }, [isEnabled]);

  useEffect(() => {
    if (!isEnabled) {
      lastHandledNotificationResponseKeyRef.current = null;
      return;
    }

    function openFromNotificationResponse(response: Notifications.NotificationResponse) {
      if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
        return;
      }

      const target = parseCodexCompletionNotificationTarget(
        response.notification.request.content.data
      );
      if (!target) {
        return;
      }

      const key = notificationResponseKey(response, target);
      if (lastHandledNotificationResponseKeyRef.current === key) {
        return;
      }

      lastHandledNotificationResponseKeyRef.current = key;
      clearLastNotificationResponse();

      Promise.resolve(onOpenConversationRef.current?.(target)).catch((error) => {
        console.warn(
          `[notifications] Unable to open Codex completion notification: ${errorMessage(error)}`
        );
      });
    }

    const subscription = Notifications.addNotificationResponseReceivedListener(
      openFromNotificationResponse
    );

    try {
      const lastResponse = Notifications.getLastNotificationResponse();
      if (lastResponse) {
        openFromNotificationResponse(lastResponse);
      }
    } catch (error) {
      console.warn(
        `[notifications] Unable to read last notification response: ${errorMessage(error)}`
      );
    }

    return () => {
      subscription.remove();
    };
  }, [isEnabled]);
}

async function mirrorForegroundCodexCompletionNotification(
  notification: Notifications.Notification
) {
  if (!shouldMirrorForegroundNotification(notification)) {
    return;
  }

  const content = notification.request.content;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        body: content.body ?? undefined,
        data: {
          ...content.data,
          foregroundMirror: true
        },
        interruptionLevel: "timeSensitive",
        sound: notificationSoundFromData(content.data),
        title: content.title ?? "Codex thread done"
      },
      trigger: null
    });
  } catch (error) {
    console.warn(`[notifications] Foreground notification mirror failed: ${errorMessage(error)}`);
  }
}

export function randomCodexCompletionSound(random = Math.random) {
  const index = Math.floor(random() * CODEX_COMPLETION_NOTIFICATION_SOUNDS.length);
  return CODEX_COMPLETION_NOTIFICATION_SOUNDS[
    Math.max(0, Math.min(index, CODEX_COMPLETION_NOTIFICATION_SOUNDS.length - 1))
  ];
}

function notificationSoundFromData(data: Notifications.NotificationContent["data"]) {
  const sound = data?.sound;

  return typeof sound === "string" && isCodexCompletionSound(sound)
    ? sound
    : randomCodexCompletionSound();
}

export function parseCodexCompletionNotificationTarget(
  data: Notifications.NotificationContent["data"]
): CodexCompletionNotificationTarget | null {
  if (data?.source !== "codex_app") {
    return null;
  }

  const conversationId = requiredString(data.conversationId);
  const projectId = requiredString(data.projectId);
  if (!conversationId || !projectId) {
    return null;
  }

  return {
    conversationId,
    projectId,
    projectName: optionalString(data.projectName),
    prompt: optionalString(data.prompt),
    status: optionalString(data.status),
    turnId: optionalString(data.turnId),
    workspaceId: optionalString(data.workspaceId)
  };
}

function isCodexCompletionSound(sound: string) {
  return CODEX_COMPLETION_NOTIFICATION_SOUNDS.some((candidate) => candidate === sound);
}

function shouldMirrorForegroundNotification(notification: Notifications.Notification) {
  const data = notification.request.content.data;

  return (
    data?.source === "codex_app" &&
    typeof data.conversationId === "string" &&
    typeof data.turnId === "string" &&
    data.foregroundMirror !== true &&
    data.foregroundMirror !== "true"
  );
}

function visibleNotificationBehavior(): Notifications.NotificationBehavior {
  return {
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true
  };
}

function silentNotificationBehavior(): Notifications.NotificationBehavior {
  return {
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowAlert: false,
    shouldShowBanner: false,
    shouldShowList: false
  };
}

function notificationResponseKey(
  response: Notifications.NotificationResponse,
  target: CodexCompletionNotificationTarget
) {
  return `${response.notification.request.identifier}:${target.conversationId}:${
    target.turnId ?? ""
  }`;
}

function clearLastNotificationResponse() {
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Older/dev notification runtimes can omit this native method.
  }
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

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
