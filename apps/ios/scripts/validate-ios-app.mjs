import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const requiredFiles = [
  "app.json",
  "index.ts",
  "src/App.tsx",
  "src/api/client.ts",
  "src/components/CodexModelControls.tsx",
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
if (!packageJson.dependencies?.["expo-crypto"]) {
  throw new Error("Expected abitat-ios to depend on expo-crypto for relay envelope nonces");
}
if (!packageJson.dependencies?.["@expo/vector-icons"]) {
  throw new Error("Expected abitat-ios to depend on @expo/vector-icons for bottom navigation");
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
const podfileLock = await readFile(join(process.cwd(), "ios/Podfile.lock"), "utf8");
if (!podfileLock.includes("ExpoCrypto (55.0.14)")) {
  throw new Error("Expected native iOS Pods to include ExpoCrypto for relay request nonces");
}

const conversationScreen = await readFile(
  join(process.cwd(), "src/screens/ConversationScreen.tsx"),
  "utf8"
);
const codexModelControls = await readFile(
  join(process.cwd(), "src/components/CodexModelControls.tsx"),
  "utf8"
);
const apiClient = await readFile(join(process.cwd(), "src/api/client.ts"), "utf8");
const mobileStore = await readFile(join(process.cwd(), "src/state/mobile-store.ts"), "utf8");
const pairingScreen = await readFile(join(process.cwd(), "src/screens/PairingScreen.tsx"), "utf8");
if (mobileStore.includes("https://workspace.abitat.io")) {
  throw new Error("Expected mobile-store to avoid hosted workspace.abitat.io defaults");
}
if (!mobileStore.includes('const DEFAULT_API_URL = "http://127.0.0.1:3901"')) {
  throw new Error("Expected mobile-store to default to the Mac-local control endpoint");
}
if (!apiClient.includes('"/pairing/consume"')) {
  throw new Error("Expected iOS pairing to consume Mac-local pairing secrets");
}
if (!apiClient.includes("parsePairingPayload")) {
  throw new Error("Expected iOS API client to parse Mac QR pairing payloads");
}
if (!apiClient.includes('transport !== "relay"')) {
  throw new Error("Expected iOS API client to parse relay pairing payloads");
}
if (!apiClient.includes("postRelay(") || !apiClient.includes("encryptRelayEnvelope")) {
  throw new Error("Expected iOS API client to route relay requests through encrypted envelopes");
}
if (!pairingScreen.includes("CameraView") || !pairingScreen.includes("onBarcodeScanned")) {
  throw new Error("Expected PairingScreen to scan Mac-generated QR payloads");
}
if (!pairingScreen.includes("pairingSecret")) {
  throw new Error("Expected PairingScreen to exchange the Mac-issued pairing secret");
}
if (!pairingScreen.includes("createPairingClient(endpoint)")) {
  throw new Error("Expected manual pairing to post to the currently visible Mac endpoint");
}
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
if (!conversationScreen.includes("AppState.addEventListener")) {
  throw new Error(
    "Expected ConversationScreen to refresh Codex messages when the app returns active"
  );
}
if (!conversationScreen.includes("FULL_MESSAGE_REFRESH_INTERVAL_MS")) {
  throw new Error("Expected ConversationScreen to periodically recover from stale message cursors");
}
if (!conversationScreen.includes("latestConversationUpdatedAtRef")) {
  throw new Error(
    "Expected ConversationScreen to refresh messages when desktop updates the thread"
  );
}
if (!conversationScreen.includes("includeRuntime: false")) {
  throw new Error("Expected ConversationScreen to skip runtime output in mobile history requests");
}
if (!conversationScreen.includes("const latestConversation = latestConversations.find")) {
  throw new Error("Expected ConversationScreen to refresh conversation status while open");
}
if (!conversationScreen.includes("setStatus(nextStatus);")) {
  throw new Error("Expected ConversationScreen to sync stale running status from the server");
}
if (!conversationScreen.includes("shouldForceMessageRefreshAfterStatusPoll")) {
  throw new Error(
    "Expected ConversationScreen to force a message refresh from desktop status updates"
  );
}
if (
  !conversationScreen.includes(
    "const canSendNow = canAcceptConversationInput(status) && !isSending;"
  )
) {
  throw new Error("Expected ConversationScreen to block phone sends while a Codex turn is running");
}
if (!conversationScreen.includes("{sendButtonLabel(status, isSending)}")) {
  throw new Error("Expected ConversationScreen to label blocked Codex turns as running");
}
if (conversationScreen.includes('source === "codex_app" && status === "running"')) {
  throw new Error("Expected ConversationScreen not to allow sends into running Codex app turns");
}
if (!conversationScreen.includes("CodexModelControls")) {
  throw new Error("Expected ConversationScreen to expose Codex model controls");
}
if (!conversationScreen.includes('variant="compact"')) {
  throw new Error("Expected ConversationScreen to use compact model controls in the composer");
}
if (
  !conversationScreen.includes("<CodexModelControls") ||
  conversationScreen.indexOf("<CodexModelControls") >
    conversationScreen.indexOf('accessibilityLabel="Commit and push with git"')
) {
  throw new Error("Expected compact model controls to be declared before the Git action");
}
if (!conversationScreen.includes("modelSettings: CodexMobileModelSettings")) {
  throw new Error("Expected ConversationScreen to receive persisted Codex model settings");
}
if (!conversationScreen.includes("onModelSettingsChange(next: CodexMobileModelSettings): void")) {
  throw new Error("Expected ConversationScreen to persist changed Codex model settings");
}
if (!conversationScreen.includes("model: modelSettings.model")) {
  throw new Error("Expected ConversationScreen to send the selected Codex model");
}
if (!conversationScreen.includes("effort: modelSettings.effort")) {
  throw new Error("Expected ConversationScreen to send the selected Codex effort");
}
for (const expected of [
  "activeConversation",
  "isDraftConversation(activeConversation)",
  "api.createConversation(conversationForSend.projectId",
  "setActiveConversation",
  "attachments: uploadedConversationAttachments"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to start draft threads from chat: ${expected}`);
  }
}
const projectDetailScreen = await readFile(
  join(process.cwd(), "src/screens/ProjectDetailScreen.tsx"),
  "utf8"
);
if (!projectDetailScreen.includes("const timer = setInterval(loadConversations, 1800);")) {
  throw new Error("Expected ProjectDetailScreen to refresh conversation statuses");
}
if (!projectDetailScreen.includes("onBack(): void")) {
  throw new Error("Expected ProjectDetailScreen to accept a projects back callback");
}
if (!projectDetailScreen.includes('accessibilityLabel="Back to all projects"')) {
  throw new Error("Expected ProjectDetailScreen to expose an accessible back-to-projects button");
}
if (!projectDetailScreen.includes("onPress={onBack}")) {
  throw new Error("Expected ProjectDetailScreen back button to call onBack");
}
if (!projectDetailScreen.includes("styles.backButton")) {
  throw new Error("Expected ProjectDetailScreen to style the projects back button");
}
if (!projectDetailScreen.includes('accessibilityLabel="New Thread"')) {
  throw new Error("Expected ProjectDetailScreen to expose a New Thread button");
}
if (!projectDetailScreen.includes("function startNewThread()")) {
  throw new Error("Expected ProjectDetailScreen to enter a draft chat before starting Codex");
}
for (const removed of [
  "CodexModelControls",
  "TextInput",
  "modelSettings: CodexMobileModelSettings",
  "onModelSettingsChange(next: CodexMobileModelSettings): void",
  "model: modelSettings.model",
  "effort: modelSettings.effort",
  "Start Codex"
]) {
  if (projectDetailScreen.includes(removed)) {
    throw new Error(`Expected ProjectDetailScreen to remove pre-chat start controls: ${removed}`);
  }
}
for (const expected of ['status: "draft"', 'prompt: ""', 'mobileOpenState: "phone_active"']) {
  if (!projectDetailScreen.includes(expected)) {
    throw new Error(`Expected ProjectDetailScreen draft conversation to include ${expected}`);
  }
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
  "COMPOSER_INPUT_MIN_HEIGHT",
  "COMPOSER_INPUT_MAX_HEIGHT",
  "scrollEnabled",
  "minHeight: COMPOSER_INPUT_MIN_HEIGHT",
  "maxHeight: COMPOSER_INPUT_MAX_HEIGHT"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen composer input to constrain growth: ${expected}`);
  }
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
for (const expected of [
  "ActionSheetIOS",
  'variant?: "compact" | "expanded"',
  'variant === "compact"',
  'accessibilityLabel="Select Codex model"',
  'accessibilityLabel="Select Codex effort"',
  "openModelMenu",
  "openEffortMenu",
  "showActionSheetWithOptions",
  "styles.compactRow",
  "styles.compactButton"
]) {
  if (!codexModelControls.includes(expected)) {
    throw new Error(`Expected CodexModelControls to include ${expected}`);
  }
}

const appScreen = await readFile(join(process.cwd(), "src/App.tsx"), "utf8");
if (!appScreen.includes("useThreadCompletionNotifications")) {
  throw new Error("Expected App to start the thread completion notification watcher");
}
for (const expected of [
  "openConversationFromNotification",
  "api.listProjects()",
  "api.listConversations(target.projectId)",
  'setRoute("conversation")'
]) {
  if (!appScreen.includes(expected)) {
    throw new Error(`Expected App to open Codex threads from notification taps: ${expected}`);
  }
}
if (!appScreen.includes("modelSettings={store.modelSettings}")) {
  throw new Error("Expected App to pass persisted Codex model settings to mobile chat screens");
}
if (!appScreen.includes("onModelSettingsChange={store.saveModelSettings}")) {
  throw new Error("Expected App to persist Codex model setting changes from chat screens");
}
if (!appScreen.includes('onBack={() => setRoute(project ? "project" : "projects")')) {
  throw new Error("Expected App to route conversation back actions to the project page");
}
if (!appScreen.includes('onBack={() => setRoute("projects")}')) {
  throw new Error("Expected App to route project back actions to the projects page");
}
if (!appScreen.includes('import { Ionicons } from "@expo/vector-icons";')) {
  throw new Error("Expected App bottom navigation to render Expo Ionicons");
}
for (const expected of [
  'route: "workspace"',
  'label: "Workspace"',
  'icon: "laptop-outline"',
  'route: "projects"',
  'label: "Projects"',
  'icon: "folder-outline"',
  'route: "settings"',
  'label: "Settings"',
  'icon: "settings-outline"',
  'accessibilityRole="tab"',
  "accessibilityState={{ selected: isActive }}"
]) {
  if (!appScreen.includes(expected)) {
    throw new Error(`Expected App bottom navigation to include ${expected}`);
  }
}
if (appScreen.includes("{item}</Text>") || appScreen.includes("textTransform")) {
  throw new Error("Expected App bottom navigation to use icon-only buttons");
}
if (!appScreen.includes('const shouldShowBottomNav = route !== "conversation";')) {
  throw new Error("Expected App to hide bottom navigation on the chat interface");
}
if (!appScreen.includes("{shouldShowBottomNav ? (")) {
  throw new Error("Expected App bottom navigation rendering to be route-gated");
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
  "mirrorForegroundCodexCompletionNotification",
  "CodexCompletionNotificationTarget",
  "parseCodexCompletionNotificationTarget",
  "Notifications.addNotificationResponseReceivedListener",
  "Notifications.getLastNotificationResponse",
  "Notifications.clearLastNotificationResponse"
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

for (const expected of ["listCodexModels", "model?: string", "effort?: CodexReasoningEffort"]) {
  if (!apiClient.includes(expected)) {
    throw new Error(`Expected API client to support Codex model control: ${expected}`);
  }
}

for (const expected of ["MODEL_SETTINGS_STORAGE_KEY", "modelSettings", "saveModelSettings"]) {
  if (!mobileStore.includes(expected)) {
    throw new Error(`Expected mobile store to persist Codex model settings: ${expected}`);
  }
}

for (const expected of [
  "listCodexModels",
  "supportedReasoningEfforts",
  "defaultReasoningEffort",
  "onChange"
]) {
  if (!codexModelControls.includes(expected)) {
    throw new Error(`Expected CodexModelControls to include ${expected}`);
  }
}

const codexModelSettings = await readFile(
  join(process.cwd(), "src/codex-model-settings.ts"),
  "utf8"
);
for (const expected of ["Minimal", "X-High", "DEFAULT_CODEX_MODEL_SETTINGS"]) {
  if (!codexModelSettings.includes(expected)) {
    throw new Error(`Expected Codex model settings to include ${expected}`);
  }
}

console.log(`validated ${requiredFiles.length} iPhone app files`);
