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
for (const dependency of ["expo-document-picker", "expo-file-system", "expo-image-picker"]) {
  if (!packageJson.dependencies?.[dependency]) {
    throw new Error(`Expected abitat-ios to depend on ${dependency} for mobile attachments`);
  }
}

const indexFile = await readFile(join(process.cwd(), "index.ts"), "utf8");
if (!indexFile.includes("registerRootComponent(App)")) {
  throw new Error("Expected index.ts to register the root App component");
}

const appJson = JSON.parse(await readFile(join(process.cwd(), "app.json"), "utf8"));
const expoNotificationsPlugin = appJson.expo?.plugins?.find((plugin) =>
  Array.isArray(plugin) ? plugin[0] === "expo-notifications" : plugin === "expo-notifications"
);
if (!expoNotificationsPlugin) {
  throw new Error("Expected app.json to include the expo-notifications config plugin");
}
const notificationSounds = [
  "./assets/notifications/codex-done-1.wav",
  "./assets/notifications/codex-done-2.wav",
  "./assets/notifications/codex-done-3.wav"
];
if (!Array.isArray(expoNotificationsPlugin) || !Array.isArray(expoNotificationsPlugin[1]?.sounds)) {
  throw new Error("Expected expo-notifications config plugin to bundle custom sounds");
}
for (const sound of notificationSounds) {
  if (!expoNotificationsPlugin[1].sounds.includes(sound)) {
    throw new Error(`Expected expo-notifications to bundle ${sound}`);
  }
  await access(join(process.cwd(), sound));
}
for (const mode of ["fetch", "remote-notification"]) {
  if (!appJson.expo?.ios?.infoPlist?.UIBackgroundModes?.includes(mode)) {
    throw new Error(`Expected app.json to enable the ${mode} iOS background mode`);
  }
}
if (typeof appJson.expo?.extra?.eas?.projectId !== "string" || !appJson.expo.extra.eas.projectId) {
  throw new Error("Expected app.json to define expo.extra.eas.projectId for remote push tokens");
}
const entitlements = await readFile(join(process.cwd(), "ios/Abitat/Abitat.entitlements"), "utf8");
if (!entitlements.includes("aps-environment")) {
  throw new Error("Expected the native iOS app to enable remote push notifications");
}
const infoPlist = await readFile(join(process.cwd(), "ios/Abitat/Info.plist"), "utf8");
for (const mode of ["fetch", "remote-notification"]) {
  if (!infoPlist.includes(`<string>${mode}</string>`)) {
    throw new Error(`Expected native Info.plist to enable the ${mode} background mode`);
  }
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
if (!conversationScreen.includes("styles.keyboardAvoidingScreen")) {
  throw new Error("Expected ConversationScreen to use an outer keyboard-avoiding screen wrapper");
}
if (!conversationScreen.includes("return (\n    <KeyboardAvoidingView")) {
  throw new Error("Expected ConversationScreen to wrap the fixed screen in KeyboardAvoidingView");
}
if (conversationScreen.includes("<FixedScreen>\n      <KeyboardAvoidingView")) {
  throw new Error(
    "Expected ConversationScreen to avoid nesting KeyboardAvoidingView inside the fixed screen"
  );
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
if (!conversationScreen.includes("visibleConversationMessages")) {
  throw new Error("Expected ConversationScreen to filter runtime messages from the mobile chat");
}
if (!conversationScreen.includes('message.role !== "runtime"')) {
  throw new Error(
    "Expected ConversationScreen to hide runtime messages from the conversation page"
  );
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
for (const removedGate of [
  "isWaitingForMacThread",
  "shouldWaitForMacRunningThread",
  "This thread is running on your Mac. Please wait.",
  "The phone will unlock this conversation when the Mac Codex run finishes."
]) {
  if (conversationScreen.includes(removedGate)) {
    throw new Error(
      "Expected ConversationScreen to always open chats without a Mac-running wait gate"
    );
  }
}
if (!conversationScreen.includes("latestSequenceRef")) {
  throw new Error("Expected ConversationScreen to track the latest synced message sequence");
}
if (!conversationScreen.includes("includeRuntime: false")) {
  throw new Error("Expected ConversationScreen to skip runtime output in mobile history requests");
}
if (!conversationScreen.includes("const latestConversation = latestConversations.find")) {
  throw new Error("Expected ConversationScreen to refresh conversation status while open");
}
if (!conversationScreen.includes("setStatus(latestConversation?.status ?? conversation.status);")) {
  throw new Error("Expected ConversationScreen to sync stale running status from the server");
}
const projectDetailScreen = await readFile(
  join(process.cwd(), "src/screens/ProjectDetailScreen.tsx"),
  "utf8"
);
if (!projectDetailScreen.includes("const timer = setInterval(loadConversations, 1800);")) {
  throw new Error("Expected ProjectDetailScreen to refresh conversation statuses");
}
if (
  !conversationScreen.includes("const [isHeaderExpanded, setIsHeaderExpanded] = useState(false)")
) {
  throw new Error("Expected ConversationScreen title area to start collapsed");
}
if (!conversationScreen.includes("styles.chatHeader")) {
  throw new Error("Expected ConversationScreen to use a compact chat header");
}
if (!conversationScreen.includes("onBack(): void")) {
  throw new Error("Expected ConversationScreen to accept a project back callback");
}
if (!conversationScreen.includes('accessibilityLabel="Back to project"')) {
  throw new Error("Expected ConversationScreen to expose an accessible back-to-project button");
}
if (!conversationScreen.includes("onPress={onBack}")) {
  throw new Error("Expected ConversationScreen back button to call onBack");
}
if (!conversationScreen.includes("styles.backButton")) {
  throw new Error("Expected ConversationScreen to style the project back button");
}
if (!conversationScreen.includes('isHeaderExpanded ? "Collapse" : "Expand"')) {
  throw new Error("Expected ConversationScreen to expose an expand/collapse title button");
}
if (!conversationScreen.includes("styles.composerRow")) {
  throw new Error("Expected ConversationScreen to keep the send button beside the message box");
}
if (!conversationScreen.includes("styles.composerInput")) {
  throw new Error("Expected ConversationScreen message input to flex within the composer row");
}
for (const expected of [
  "createOptimisticMessage",
  "localStatus",
  "markLocalMessageFailed",
  "markLocalMessageSent",
  "sendGitShortcut",
  "pickImageAttachment",
  "pickFileAttachment",
  "uploadAttachment"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to include ${expected}`);
  }
}

const appScreen = await readFile(join(process.cwd(), "src/App.tsx"), "utf8");
if (!appScreen.includes("useThreadCompletionNotifications")) {
  throw new Error("Expected App to start the thread completion notification watcher");
}
if (!appScreen.includes('onBack={() => setRoute(project ? "project" : "projects")')) {
  throw new Error("Expected App to route conversation back actions to the project page");
}

const notificationWatcher = await readFile(
  join(process.cwd(), "src/notifications/thread-completion-notifications.ts"),
  "utf8"
);
for (const expected of [
  "Notifications.setNotificationHandler",
  "Notifications.getExpoPushTokenAsync",
  "Notifications.requestPermissionsAsync",
  "registerForPushNotifications",
  "rememberRunningConversation",
  "useThreadCompletionNotifications",
  "console.warn",
  "registerPushToken",
  "reportPushRegistrationIssue",
  "withPushRegistrationTimeout",
  "allowSound",
  "CODEX_COMPLETION_NOTIFICATION_SOUNDS",
  "randomCodexCompletionSound",
  "mirrorForegroundCodexCompletionNotification"
]) {
  if (!notificationWatcher.includes(expected)) {
    throw new Error(`Expected notification watcher to include ${expected}`);
  }
}
for (const duplicateNotificationPath of [
  "pollCompletionsForForegroundFallback",
  "sendForegroundThreadDoneNotification",
  "shouldNotifyForCompletedTurn",
  "listCompletionStates"
]) {
  if (notificationWatcher.includes(duplicateNotificationPath)) {
    throw new Error(
      `Expected backend push to be the only completion notification source, but found ${duplicateNotificationPath}`
    );
  }
}
if (notificationWatcher.includes("wasMessageCreatedAfterSnapshot")) {
  throw new Error("Expected Mac-started Codex completion detection to avoid stale timestamp gates");
}
if (notificationWatcher.includes("isNotificationMessageFromCompletedTurn")) {
  throw new Error("Expected notifications to be based on turn completion, not assistant messages");
}

console.log(`validated ${requiredFiles.length} iPhone app files`);
