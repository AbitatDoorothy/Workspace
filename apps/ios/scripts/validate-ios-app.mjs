import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const requiredFiles = [
  "app.json",
  "index.ts",
  "src/App.tsx",
  "src/api/client.ts",
  "src/notifications/thread-completion-notifications.ts",
  "src/state/mobile-store.ts",
  "src/screens/PairingScreen.tsx",
  "src/screens/WorkspaceScreen.tsx",
  "src/screens/ProjectsScreen.tsx",
  "src/screens/ProjectDetailScreen.tsx",
  "src/screens/ConversationScreen.tsx",
  "src/screens/RemoteControlScreen.tsx",
  "src/screens/SettingsScreen.tsx"
];

await Promise.all(requiredFiles.map((file) => access(join(process.cwd(), file))));

const packageJson = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8"));
if (packageJson.main !== "index.ts") {
  throw new Error(`Expected package.json main to be "index.ts", received ${packageJson.main}`);
}
if (!packageJson.dependencies?.["expo-notifications"]) {
  throw new Error("Expected abitat-ios to depend on expo-notifications");
}
if (!packageJson.dependencies?.["expo-constants"]) {
  throw new Error("Expected abitat-ios to depend on expo-constants for push registration");
}

const indexFile = await readFile(join(process.cwd(), "index.ts"), "utf8");
if (!indexFile.includes("registerRootComponent(App)")) {
  throw new Error("Expected index.ts to register the root App component");
}

const appJson = JSON.parse(await readFile(join(process.cwd(), "app.json"), "utf8"));
if (!appJson.expo?.plugins?.includes("expo-notifications")) {
  throw new Error("Expected app.json to include the expo-notifications config plugin");
}
const entitlements = await readFile(join(process.cwd(), "ios/Abitat/Abitat.entitlements"), "utf8");
if (!entitlements.includes("aps-environment")) {
  throw new Error("Expected the native iOS app to enable remote push notifications");
}

const conversationScreen = await readFile(
  join(process.cwd(), "src/screens/ConversationScreen.tsx"),
  "utf8"
);
if (!conversationScreen.includes("mergeConversationMessages")) {
  throw new Error("Expected ConversationScreen to merge refreshed messages without duplicates");
}
if (!conversationScreen.includes("scrollToOffset({ animated, offset: 0 })")) {
  throw new Error(
    "Expected ConversationScreen to scroll inverted chat lists to the latest message"
  );
}
if (!conversationScreen.includes("KeyboardAvoidingView")) {
  throw new Error("Expected ConversationScreen to keep the composer above the iOS keyboard");
}
if (!conversationScreen.includes("FlatList")) {
  throw new Error("Expected ConversationScreen to virtualize long Codex threads");
}
if (!conversationScreen.includes("inverted")) {
  throw new Error(
    "Expected ConversationScreen to use an inverted chat list for reliable latest scroll"
  );
}
if (!conversationScreen.includes("newestFirstMessages")) {
  throw new Error("Expected ConversationScreen to render newest messages at the latest edge");
}
if (!conversationScreen.includes("safeMessageContent")) {
  throw new Error("Expected ConversationScreen to cap pathological message bodies");
}
if (conversationScreen.includes("scrollToEnd")) {
  throw new Error(
    "Expected ConversationScreen to avoid unreliable scrollToEnd on long Codex threads"
  );
}
if (conversationScreen.includes("onContentSizeChange={() => scrollViewRef.current?.scrollToEnd")) {
  throw new Error(
    "Expected ConversationScreen to preserve scroll position when the user scrolls up"
  );
}
if (!conversationScreen.includes("handleMessagesContentSizeChange")) {
  throw new Error("Expected ConversationScreen to scroll after message layout changes");
}
if (!conversationScreen.includes("handleMessagesScroll")) {
  throw new Error("Expected ConversationScreen to detect when the user scrolls away from latest");
}
if (!conversationScreen.includes("showScrollToLatestButton")) {
  throw new Error("Expected ConversationScreen to show a scroll-to-latest affordance");
}
if (!conversationScreen.includes("shouldWaitForMacRunningThread")) {
  throw new Error("Expected ConversationScreen to guard Mac-running Codex app threads");
}
if (!conversationScreen.includes("This thread is running on your Mac. Please wait.")) {
  throw new Error("Expected ConversationScreen to show a Mac-running wait message");
}

const appScreen = await readFile(join(process.cwd(), "src/App.tsx"), "utf8");
if (!appScreen.includes("useThreadCompletionNotifications")) {
  throw new Error("Expected App to start the thread completion notification watcher");
}

const notificationWatcher = await readFile(
  join(process.cwd(), "src/notifications/thread-completion-notifications.ts"),
  "utf8"
);
for (const expected of [
  "Notifications.setNotificationHandler",
  "Notifications.getExpoPushTokenAsync",
  "Notifications.requestPermissionsAsync",
  "Notifications.scheduleNotificationAsync",
  "registerForPushNotifications",
  "pollCompletionsForForegroundFallback",
  "shouldNotifyForCompletedTurn",
  "rememberRunningConversation",
  "useThreadCompletionNotifications",
  "registerPushToken",
  "listCompletionStates"
]) {
  if (!notificationWatcher.includes(expected)) {
    throw new Error(`Expected notification watcher to include ${expected}`);
  }
}
if (notificationWatcher.includes("wasMessageCreatedAfterSnapshot")) {
  throw new Error("Expected Mac-started Codex completion detection to avoid stale timestamp gates");
}
if (notificationWatcher.includes("isNotificationMessageFromCompletedTurn")) {
  throw new Error("Expected notifications to be based on turn completion, not assistant messages");
}

console.log(`validated ${requiredFiles.length} iPhone app files`);
