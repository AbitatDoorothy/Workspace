import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

const requiredFiles = [
  "app.json",
  "assets/icon.png",
  "index.ts",
  "ios/Abitat/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png",
  "src/App.tsx",
  "src/api/client.ts",
  "src/components/CodexModelControls.tsx",
  "src/notifications/thread-completion-notifications.ts",
  "src/state/message-cache.ts",
  "src/state/message-preloader.ts",
  "src/state/navigation-cache.ts",
  "src/state/mobile-store.ts",
  "src/screens/PairingScreen.tsx",
  "src/screens/SplashScreen.tsx",
  "src/screens/WorkspaceScreen.tsx",
  "src/screens/ProjectsScreen.tsx",
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
if (!packageJson.dependencies?.["expo-screen-orientation"]) {
  throw new Error("Expected abitat-ios to depend on expo-screen-orientation");
}
if (!packageJson.dependencies?.["expo-constants"]) {
  throw new Error("Expected abitat-ios to depend on expo-constants for push registration");
}
if (!packageJson.dependencies?.["expo-crypto"]) {
  throw new Error("Expected abitat-ios to depend on expo-crypto for relay envelope nonces");
}
if (!packageJson.dependencies?.["expo-haptics"]) {
  throw new Error("Expected abitat-ios to depend on expo-haptics for splash pulse feedback");
}
if (!packageJson.dependencies?.["expo-clipboard"]) {
  throw new Error("Expected abitat-ios to depend on expo-clipboard for message copying");
}
if (!packageJson.dependencies?.["expo-camera"]) {
  throw new Error("Expected abitat-ios to depend on expo-camera for QR pairing scans");
}
if (!packageJson.dependencies?.["@expo/vector-icons"]) {
  throw new Error("Expected abitat-ios to depend on @expo/vector-icons for project icons");
}
if (!packageJson.dependencies?.["react-native-safe-area-context"]) {
  throw new Error("Expected abitat-ios to depend on react-native-safe-area-context");
}
for (const dependency of [
  "expo-document-picker",
  "expo-file-system",
  "expo-image-picker",
  "expo-sharing"
]) {
  if (!packageJson.dependencies?.[dependency]) {
    throw new Error(
      `Expected abitat-ios to depend on ${dependency} for mobile attachments and downloads`
    );
  }
}

const indexFile = await readFile(join(process.cwd(), "index.ts"), "utf8");
if (!indexFile.includes("registerRootComponent(App)")) {
  throw new Error("Expected index.ts to register the root App component");
}

const appJson = JSON.parse(await readFile(join(process.cwd(), "app.json"), "utf8"));
if (appJson.expo?.icon !== "./assets/icon.png") {
  throw new Error("Expected app.json to use the bundled Abitat app icon");
}
if (appJson.expo?.orientation !== "default") {
  throw new Error("Expected app.json to allow landscape orientation for full-screen remote control");
}
const expoNotificationsPlugin = appJson.expo?.plugins?.find((plugin) =>
  Array.isArray(plugin) ? plugin[0] === "expo-notifications" : plugin === "expo-notifications"
);
if (!expoNotificationsPlugin) {
  throw new Error("Expected app.json to include the expo-notifications config plugin");
}
if (!appJson.expo?.plugins?.includes("expo-camera")) {
  throw new Error("Expected app.json to include the expo-camera config plugin");
}
if (
  appJson.expo?.ios?.infoPlist?.NSCameraUsageDescription !==
  "Abitat scans the pairing QR code shown on your Mac."
) {
  throw new Error("Expected app.json to explain why Abitat needs camera access");
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
if (!infoPlist.includes("<key>NSCameraUsageDescription</key>")) {
  throw new Error("Expected native Info.plist to explain QR scanner camera usage");
}
for (const orientation of [
  "UIInterfaceOrientationLandscapeLeft",
  "UIInterfaceOrientationLandscapeRight"
]) {
  if (!infoPlist.includes(`<string>${orientation}</string>`)) {
    throw new Error(`Expected native Info.plist to allow ${orientation}`);
  }
}
for (const mode of ["fetch", "remote-notification"]) {
  if (!infoPlist.includes(`<string>${mode}</string>`)) {
    throw new Error(`Expected native Info.plist to enable the ${mode} background mode`);
  }
}
const podfileLock = await readFile(join(process.cwd(), "ios/Podfile.lock"), "utf8");
if (!podfileLock.includes("ExpoCrypto (55.0.14)")) {
  throw new Error("Expected native iOS Pods to include ExpoCrypto for relay request nonces");
}
if (!podfileLock.includes("ExpoSharing (55.0.18)")) {
  throw new Error("Expected native iOS Pods to include ExpoSharing for generated file downloads");
}
if (!podfileLock.includes("ExpoHaptics (55.0.14)")) {
  throw new Error("Expected native iOS Pods to include ExpoHaptics for splash pulse feedback");
}
if (!podfileLock.includes("ExpoClipboard (55.0.13)")) {
  throw new Error("Expected native iOS Pods to include ExpoClipboard for message copying");
}
if (!podfileLock.includes("ExpoCamera (55.0.16)")) {
  throw new Error("Expected native iOS Pods to include ExpoCamera for QR pairing scans");
}
if (!podfileLock.includes("ExpoScreenOrientation")) {
  throw new Error("Expected native iOS Pods to include ExpoScreenOrientation for landscape remote control");
}
if (!podfileLock.includes("react-native-safe-area-context (5.6.2)")) {
  throw new Error("Expected native iOS Pods to include react-native-safe-area-context");
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
const typesFile = await readFile(join(process.cwd(), "src/types.ts"), "utf8");
const mobileStore = await readFile(join(process.cwd(), "src/state/mobile-store.ts"), "utf8");
const messageCache = await readFile(join(process.cwd(), "src/state/message-cache.ts"), "utf8");
const messagePreloader = await readFile(
  join(process.cwd(), "src/state/message-preloader.ts"),
  "utf8"
);
const navigationCache = await readFile(
  join(process.cwd(), "src/state/navigation-cache.ts"),
  "utf8"
);
const pairingScreen = await readFile(join(process.cwd(), "src/screens/PairingScreen.tsx"), "utf8");
const remoteControlScreen = await readFile(
  join(process.cwd(), "src/screens/RemoteControlScreen.tsx"),
  "utf8"
);
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
if (
  !apiClient.includes("isRelayPairing(pairing)") ||
  !apiClient.includes("Boolean(pairing.relayId)")
) {
  throw new Error(
    "Expected iOS API client to keep relay routing for saved pairings with relay ids"
  );
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
for (const expected of [
  'const [step, setStep] = useState<"name" | "pair">("name");',
  "Identify yourself",
  "Enter your name",
  'setStep("pair")',
  "Pair with your Mac",
  "Enter payload manually",
  "completePairing(pairingInput)",
  "completePairing(result.data)",
  "Modal",
  "visible={isScanning}",
  "styles.scannerOverlay",
  "styles.onboardingScreen",
  "styles.primaryFont",
  "TouchableWithoutFeedback",
  "Keyboard.dismiss",
  'keyboardAppearance="dark"'
]) {
  if (!pairingScreen.includes(expected)) {
    throw new Error(`Expected PairingScreen to implement two-step onboarding: ${expected}`);
  }
}
for (const removed of ["Mac endpoint", "Pairing payload or manual code", "Device name"]) {
  if (pairingScreen.includes(removed)) {
    throw new Error(`Expected PairingScreen to remove old onboarding field: ${removed}`);
  }
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
for (const expected of [
  'import * as Clipboard from "expo-clipboard";',
  "Clipboard.setStringAsync",
  "copyMessageText",
  "const text = conversationMessageDisplayContent(message);",
  "accessibilityLabel={`Copy ${message.role} message`}",
  "selectable",
  "contextMenuHidden={false}",
  "copiedMessageId"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to support message copying: ${expected}`);
  }
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
for (const expected of [
  "stripCodexAppDirectives",
  "isCodexAppDirectiveLine",
  "git-stage",
  "git-commit",
  "git-push",
  "conversationMessageDisplayContent(message).trim().length > 0"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to hide Codex app directives: ${expected}`);
  }
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
for (const expected of [
  "loadCachedConversationMessages",
  "saveCachedConversationMessages",
  "moveCachedConversationMessages",
  "messageCacheScope",
  "setMessages(cachedMessages)",
  "const latestSequence = highestCachedMessageSequence(cachedMessages)",
  "latestSequenceRef.current = latestSequence",
  "markCachedConversationRead(messageCacheScope, activeConversation.id, latestSequence)",
  "cachedAfterSequence > 0 ? cachedAfterSequence : undefined",
  "saveCachedConversationMessages(messageCacheScope, conversationId, nextMessages).then"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(
      `Expected ConversationScreen to integrate persistent message cache: ${expected}`
    );
  }
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
if (!conversationScreen.includes("forceRefresh: isForcedRefresh")) {
  throw new Error(
    "Expected ConversationScreen to bypass stale daemon message caches during forced refreshes"
  );
}
for (const expected of [
  "const nextStatus = latestConversation?.status ?? activeConversation.status;",
  "latestStatusRef.current = nextStatus;",
  "setStatus(nextStatus);",
  "statusRefreshGenerationRef",
  "applyLocalConversationStatus",
  "const requestGeneration = statusRefreshGenerationRef.current;",
  "requestGeneration !== statusRefreshGenerationRef.current",
  "isConversationBusyStatus(input.previousStatus) && !isConversationBusyStatus(input.nextStatus)"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to preserve live Mac status sync: ${expected}`);
  }
}
if (
  !conversationScreen.includes(
    "const canSendNow = !isDraftConversation(activeConversation) || !isSending;"
  )
) {
  throw new Error(
    "Expected ConversationScreen to keep existing Codex threads queueable while a send is in flight"
  );
}
for (const expected of [
  "const hasComposerPayload = canSendPrompt(prompt, attachments);",
  "const showComposerSpinner =",
  "editingQueuedMessageId === null;",
  "const sendButtonIconName",
  '? "check"',
  '? "arrow-up"',
  ': "send"',
  "const canSubmitComposer ="
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to render stateful send controls: ${expected}`);
  }
}
for (const expected of [
  "queuedLocalMessages",
  ".filter((message) => !isQueuedLocalMessage(message))",
  "const optimisticLocalStatus =",
  "localStatus: optimisticLocalStatus",
  '? "queued"',
  ': "sending"',
  "renderQueuedMessageStack()",
  "renderReplyTargetPreview()",
  "replyTargetMessage",
  "selectReplyTarget(message:",
  "clearReplyTarget",
  "Replying to",
  'accessibilityLabel="Cancel reply target"',
  "ReplyableMessageItem",
  "createReplySwipeResponder",
  "onMoveShouldSetPanResponderCapture",
  "onPanResponderTerminationRequest: () => false",
  "shouldStartReplySwipe",
  "shouldCommitReplySwipe",
  "REPLY_SWIPE_DISTANCE",
  "REPLY_SWIPE_VELOCITY",
  "conversationMessageDisplayContent",
  "conversationMessageReplyPreview",
  "displayReplyPromptText",
  "parseReplyPrompt",
  "quotedMessagePreview",
  "quotedMessagePreviewText",
  "replyPromptForSend",
  "Reply to this previous message from",
  "User reply:",
  "deleteQueuedMessage",
  "editQueuedMessage",
  "saveQueuedMessageEdit",
  "api.deleteQueuedTurn",
  "api.updateQueuedTurn",
  "queuedMessageClientId",
  "removeLocalQueuedMessage",
  "updateLocalQueuedMessagePrompt",
  "markLocalMessageSending",
  "drainReadyQueuedMessages",
  "queuedDrainInFlightRef",
  "resendQueuedLocalMessage",
  "macQueuedAt",
  "hasMacQueuedAcknowledgement",
  "scrollToLatest(true);",
  "styles.queueStack",
  "styles.queueStackScroll",
  'name="trash-2"',
  'name="edit-3"',
  'keyboardAppearance="dark"',
  'keyboardDismissMode="on-drag"',
  "onScrollBeginDrag={Keyboard.dismiss}"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen queued composer stack behavior: ${expected}`);
  }
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
    conversationScreen.indexOf('accessibilityLabel="Open generated files"')
) {
  throw new Error("Expected compact model controls to be declared before generated files");
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
const projectsScreen = await readFile(
  join(process.cwd(), "src/screens/ProjectsScreen.tsx"),
  "utf8"
);
for (const expected of ["initialProjects", "onProjectsLoaded", "setProjects(initialProjects)"]) {
  if (!projectsScreen.includes(expected)) {
    throw new Error(
      `Expected ProjectsScreen to keep warm project data while refreshing: ${expected}`
    );
  }
}
for (const expected of [
  "refreshEnabled?: boolean;",
  "refreshEnabled = true",
  "if (!refreshEnabled) {",
  "refreshEnabled]"
]) {
  if (!projectsScreen.includes(expected)) {
    throw new Error(`Expected ProjectsScreen to suppress refresh in previews: ${expected}`);
  }
}
for (const expected of [
  'import { Feather } from "@expo/vector-icons";',
  "CELESTIAL_STARS",
  "BIG_DIPPER_STARS",
  "ABITAT",
  "PROJECTS",
  "visibleProjects.map((project)",
  "archivedProjects.map((project)",
  "project.name",
  'name="folder"',
  "styles.voidScreen",
  "styles.starField",
  "styles.projectRow",
  "ARCHIVE_PROJECT_ID",
  "ARCHIVE",
  "archivedProjectIds",
  "onArchiveProject(project.id)",
  "onArchiveProject",
  "recoverArchivedProject(project.id)",
  "onRecoverProject(projectId)",
  "ProjectSwipeRow",
  "PanResponder.create",
  "Animated.timing",
  "shouldHandleArchiveSwipe",
  "onSwipeActiveChange",
  "scrollEnabled={!isProjectSwipeActive}",
  "directionalLockEnabled",
  "onMoveShouldSetPanResponderCapture",
  "onPanResponderTerminationRequest: () => false",
  "onShouldBlockNativeResponder: () => true",
  "PROJECT_ARCHIVE_SWIPE_DISTANCE",
  "PROJECT_ARCHIVE_EXIT_DISTANCE",
  "styles.archivedProjectRow",
  "initialConversationsByProject",
  "onProjectConversationsLoaded",
  "onProjectThread",
  "onNewThread(project)",
  'accessibilityLabel={`Create thread in ${project.name}`}',
  'name="plus"',
  "ThreadAttentionTone",
  "projectConversations.map((conversation)",
  "onPress={() => onProjectThread(project, conversation)}",
  "styles.projectNewThreadButton",
  "styles.projectThreadList",
  "styles.projectThreadRow",
  "styles.projectThreadRowPressed",
  "styles.projectThreadStatusLight",
  "threadTone !== \"idle\" ? (",
  "styles.threadStatusRunning",
  "styles.threadStatusUnread",
  "collapsedProjectIds",
  "toggleProjectFold(project.id)",
  "projectThreadsCollapsed",
  "accessibilityState={{ expanded: !projectThreadsCollapsed }}",
  "expandedArchivedProjectIds",
  "toggleArchivedProjectFold(project.id)",
  "archivedProjectThreadsExpanded",
  "accessibilityState={{ expanded: archivedProjectThreadsExpanded }}",
  'accessibilityLabel={`Recover ${project.name} from archive`}',
  'name="rotate-ccw"',
  "styles.projectRecoverButton",
  "isArchiveExpanded",
  "setIsArchiveExpanded((current) => !current)",
  "accessibilityState={{ expanded: isArchiveExpanded }}",
  "isArchiveExpanded ? (",
  "loadVisibleProjectConversations",
  "projectThreadRefreshIdsKey",
  "conversationRefreshInFlightProjectIdsRef",
  "threadStatusTone",
  "onSettings(): void;",
  "paddingTop: 28",
  "fontSize: 24",
  "fontSize: 16",
  "fontSize: 20",
  "marginTop: 38"
]) {
  if (!projectsScreen.includes(expected)) {
    throw new Error(`Expected ProjectsScreen to match the celestial project UI: ${expected}`);
  }
}
for (const removed of ["SWIPE_BACK_DISTANCE"]) {
  if (projectsScreen.includes(removed)) {
    throw new Error(`Expected ProjectsScreen to leave swipe navigation to App: ${removed}`);
  }
}
for (const removed of [
  "projectStatusTone",
  "projectStatusAccessibilityLabel",
  "projectStatusLight",
  "projectStatusIdle",
  "archiveStatusLight"
]) {
  if (projectsScreen.includes(removed)) {
    throw new Error(`Expected ProjectsScreen to remove project LEDs and idle thread LEDs: ${removed}`);
  }
}
for (const removed of [
  "expandedProjectIds",
  "toggleProjectExpansion",
  "projectDisclosureButton",
  "chevron-down",
  "chevron-up",
  "attentionThreadsForProject"
]) {
  if (projectsScreen.includes(removed)) {
    throw new Error(`Expected ProjectsScreen to show project threads inline without dropdowns: ${removed}`);
  }
}
for (const removed of [
  "Codex Projects",
  "folderGrid",
  "folderTile",
  "folderBody",
  "fontSize: 34",
  "fontSize: 30",
  "fontSize: 25",
  "marginTop: 74",
  "paddingTop: 52"
]) {
  if (projectsScreen.includes(removed)) {
    throw new Error(`Expected ProjectsScreen to remove old folder-grid UI: ${removed}`);
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
for (const expected of [
  "refreshEnabled?: boolean;",
  "refreshEnabled = true",
  "if (!refreshEnabled) {",
  "refreshEnabled]"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to suppress refresh in previews: ${expected}`);
  }
}
if (!conversationScreen.includes("onBack(): void")) {
  throw new Error("Expected ConversationScreen to accept a project back callback");
}
for (const expected of [
  "threadTitle",
  "collapsedThreadTitle",
  "compactThreadTitle(threadTitle)",
  "styles.threadBubble",
  "styles.statusLed",
  "isConversationBusyStatus(status)",
  "numberOfLines={isHeaderExpanded ? 3 : 1}",
  "isHeaderExpanded ? threadTitle : collapsedThreadTitle",
  "!isHeaderExpanded ? (",
  'accessibilityLabel="Toggle full thread name"',
  "styles.headerActions",
  "styles.threadClusterExpanded"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to expose the new thread header: ${expected}`);
  }
}
for (const expected of [
  "SafeAreaView",
  "StatusBar",
  'backgroundColor="#000000"',
  "styles.conversationScreen",
  "styles.conversationContent",
  'backgroundColor: "#000000"',
  "styles.composerShell",
  "styles.composerRow",
  "paddingBottom: 14",
  "paddingTop: 14",
  "paddingBottom: 22",
  "paddingTop: 4"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to use pure-black bubble layout: ${expected}`);
  }
}
for (const expected of [
  'accessibilityLabel="Scroll to latest message"',
  "styles.latestButton",
  "styles.latestButtonIcon",
  'name="arrow-down"',
  "compactThreadTitle",
  "slice(0, 6)"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen compact latest/title controls: ${expected}`);
  }
}
if (conversationScreen.includes(">Latest<")) {
  throw new Error("Expected ConversationScreen to replace Latest text with an arrow icon");
}
for (const removed of [
  "FixedScreen",
  'accessibilityLabel="Back to project"',
  "styles.backButton",
  "headerToggle",
  'isHeaderExpanded ? "Collapse" : "Expand"'
]) {
  if (conversationScreen.includes(removed)) {
    throw new Error(
      `Expected ConversationScreen to remove the old chat header control: ${removed}`
    );
  }
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
  "markLocalMessageQueued",
  "markLocalMessageSent",
  'delivery: "queue"',
  'delivery: "steer"',
  "steerQueuedMessage",
  'accessibilityLabel="Steer queued Codex message"',
  "refreshGeneratedFiles",
  "downloadGeneratedFile",
  "generatedFiles",
  "generatedFilesModalVisible",
  "GeneratedFileSummary",
  "FileSystem.writeAsStringAsync",
  "Sharing.isAvailableAsync",
  "Sharing.shareAsync",
  "nestedScrollEnabled",
  "styles.generatedFilesModalScroll",
  "GENERATED_FILES_MAX_HEIGHT",
  "isTransientResponseError",
  "openAttachmentMenu",
  "pickImageAttachment",
  "pickFileAttachment",
  "uploadAttachment",
  "ActionSheetIOS",
  "ActivityIndicator",
  "Feather",
  "sendButtonIconName"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to include ${expected}`);
  }
}
for (const expected of [
  'accessibilityLabel="Open generated files"',
  'accessibilityLabel="Close generated files"',
  "Modal",
  "visible={generatedFilesModalVisible}",
  "setGeneratedFilesModalVisible(true)",
  "maxHeight: GENERATED_FILES_MAX_HEIGHT",
  'accessibilityLabel="Attach files or images"',
  "styles.composerSendButton",
  "styles.composerSendButtonIdle",
  "styles.composerSendButtonBusy"
]) {
  if (!conversationScreen.includes(expected)) {
    throw new Error(`Expected ConversationScreen to match the new chat controls: ${expected}`);
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
  "displayModelLabel",
  'return "GPT-5.5";',
  "styles.compactRow",
  "styles.compactButton"
]) {
  if (!codexModelControls.includes(expected)) {
    throw new Error(`Expected CodexModelControls to include ${expected}`);
  }
}

const appScreen = await readFile(join(process.cwd(), "src/App.tsx"), "utf8");
const screenComponent = await readFile(join(process.cwd(), "src/components/Screen.tsx"), "utf8");
const splashScreen = await readFile(join(process.cwd(), "src/screens/SplashScreen.tsx"), "utf8");
if (!appScreen.includes("SafeAreaProvider")) {
  throw new Error("Expected App to provide safe-area context at the app root");
}
for (const [fileName, fileContent] of [
  ["Screen.tsx", screenComponent],
  ["ProjectsScreen.tsx", projectsScreen],
  ["ConversationScreen.tsx", conversationScreen]
]) {
  if (!fileContent.includes('from "react-native-safe-area-context"')) {
    throw new Error(`Expected ${fileName} to use configurable safe-area edges`);
  }
  if (!fileContent.includes('edges={["top", "left", "right"]}')) {
    throw new Error(`Expected ${fileName} to remove the bottom safe-area edge`);
  }
}
for (const expected of [
  "SplashScreen",
  "Animated.loop",
  "SHOOTING_STARS",
  "SHOOTING_STAR_REST_MS",
  "LARGE_STAR_POINTS",
  "STAR_POINTS",
  "Haptics.impactAsync",
  "ImpactFeedbackStyle.Heavy",
  "ImpactFeedbackStyle.Medium",
  "runHeartbeatPulse",
  "pulseLogoWithHaptic",
  "buttonFloat",
  "styles.largeStar",
  "styles.shootingStarHead",
  "styles.shootingStarTail",
  "onStart",
  'accessibilityLabel="Start Abitat"'
]) {
  if (!splashScreen.includes(expected)) {
    throw new Error(`Expected SplashScreen to include ${expected}`);
  }
}
for (const expected of ["blackoutOpacity", "blackoutOverlay", "toValue: 1"]) {
  if (!splashScreen.includes(expected)) {
    throw new Error(`Expected SplashScreen to fade to black on start: ${expected}`);
  }
}
for (const removed of [
  "cornerLogo",
  "triggerHeartbeatHaptics",
  "setInterval(triggerHeartbeatHaptics",
  "starGlow",
  "largeStarGlow",
  "shadowOpacity: 0.26",
  "shadowRadius: 24",
  "ImpactFeedbackStyle.Light",
  "Animated.delay(4800)"
]) {
  if (splashScreen.includes(removed)) {
    throw new Error(`Expected SplashScreen to remove ${removed}`);
  }
}
for (const expected of [
  "hasStarted",
  "setHasStarted",
  "<SplashScreen",
  "onStart={() => setHasStarted(true)}"
]) {
  if (!appScreen.includes(expected)) {
    throw new Error(
      `Expected App to gate the mobile interface behind the splash screen: ${expected}`
    );
  }
}
if (!appScreen.includes("useThreadCompletionNotifications")) {
  throw new Error("Expected App to start the thread completion notification watcher");
}
for (const expected of [
  "openConversationFromNotification",
  "api.listProjects()",
  "api.listConversations(target.projectId)",
  "loadCachedNavigationData",
  "saveCachedProjects",
  "saveCachedProjectConversations",
  "saveCachedArchivedProjectIds",
  "recoverProject",
  "cachedProjects",
  "cachedConversationsByProject",
  "cachedConversationsByProjectRef",
  "archivedProjectIdsRef",
  "setArchivedProjectIds(new Set(data.archivedProjectIds))",
  "setCachedConversationsByProject(data.conversationsByProject)",
  "updateCachedConversations",
  "next.delete(projectId)",
  'setRoute("conversation")'
]) {
  if (!appScreen.includes(expected)) {
    throw new Error(`Expected App to open Codex threads from notification taps: ${expected}`);
  }
}
if (!appScreen.includes("modelSettings={store.modelSettings}")) {
  throw new Error("Expected App to pass persisted Codex model settings to mobile chat screens");
}
if (!appScreen.includes("messageCacheScope={store.messageCacheScope}")) {
  throw new Error("Expected App to pass the paired host cache scope to ConversationScreen");
}
if (!appScreen.includes("onModelSettingsChange={store.saveModelSettings}")) {
  throw new Error("Expected App to persist Codex model setting changes from chat screens");
}
if (!appScreen.includes("useMessagePreloader")) {
  throw new Error("Expected App to start the global message preloader after pairing");
}
if (!appScreen.includes("messageCacheScope: store.messageCacheScope")) {
  throw new Error("Expected App to scope message preloading to the paired Mac");
}
for (const expected of [
  "NAVIGATION_CACHE_DIRECTORY",
  "loadCachedNavigationData",
  "saveCachedProjects",
  "saveCachedProjectConversations",
  "clearCachedNavigationData",
  "conversationsByProject",
  "archivedProjectIds",
  "saveCachedArchivedProjectIds",
  "prepareCachedArchivedProjectIds",
  "prepareCachedConversations"
]) {
  if (!navigationCache.includes(expected)) {
    throw new Error(`Expected navigation cache to persist project/thread lists: ${expected}`);
  }
}
if (!appScreen.includes("onBack={goBackOneLevel}")) {
  throw new Error("Expected App back actions to use the shared one-level route helper");
}
if (!appScreen.includes("onNewThread={(nextProject) => {")) {
  throw new Error("Expected App to start new project threads from ProjectsScreen");
}
for (const removed of [
  "ProjectDetailScreen",
  'navigateToRoute("project")',
  'routeName === "project"',
  'return project ? "project" : "projects";'
]) {
  if (appScreen.includes(removed)) {
    throw new Error(`Expected App to remove the intermediate project thread page: ${removed}`);
  }
}
for (const expected of [
  'const [route, setRoute] = useState<RouteName>("projects");',
  "Animated",
  "useRef",
  "useWindowDimensions",
  "PanResponder",
  "GLOBAL_BACK_SWIPE_DISTANCE",
  "GLOBAL_BACK_SWIPE_DISMISS_DURATION_MS",
  "backSwipeX",
  "forwardSlideX",
  "forwardRoute",
  "swipeBackPreviewRoute",
  "activeRouteLayerKey",
  "isRemoteControlFullScreen",
  "createRouteLayerKey",
  "goBackOneLevel",
  "navigateToRoute",
  "renderRoute(routeName: RouteName, options",
  "isPreview: true",
  "refreshEnabled={!options?.isPreview}",
  "createGlobalBackSwipeResponder",
  "canStart: () => !isRemoteControlFullScreen && routeBackOneLevel(route) !== route",
  "gesture.dx >= GLOBAL_BACK_SWIPE_DISTANCE",
  "Animated.timing",
  "Animated.spring",
  "setActiveRouteLayerKey(nextForwardRoute.layerKey)",
  "setActiveRouteLayerKey(targetRoute.layerKey)",
  "key={activeRouteLayerKey}",
  "key={swipeBackPreviewRoute.layerKey}",
  "key={forwardRoute.layerKey}",
  "renderRoute(swipeBackPreviewRoute.routeName, { isPreview: true })",
  "renderRoute(forwardRoute.routeName, { isPreview: true })",
  "styles.routeUnderlay",
  "styles.routeLayer",
  "styles.routeForwardLayer",
  "swipeBackPreviewRoute ? { transform: [{ translateX: backSwipeX }] } : null",
  "transform: [{ translateX: forwardSlideX }]",
  "{...globalBackSwipeResponder.panHandlers}",
  "onStart={() => setHasStarted(true)}",
  'setRoute("projects");',
  'onSettings={() => navigateToRoute("settings")}',
  "onBack={goBackOneLevel}"
]) {
  if (!appScreen.includes(expected)) {
    throw new Error(`Expected App to route Start/pairing/settings through Projects: ${expected}`);
  }
}
if (!appScreen.includes("onFullScreenChange={setIsRemoteControlFullScreen}")) {
  throw new Error("Expected App to disable the global back swipe while remote control is fullscreen");
}
if (appScreen.includes("requestAnimationFrame(() => {\n        backSwipeX.setValue(0);")) {
  throw new Error(
    "Expected App to avoid resetting the back-swipe transform during the committed route swap"
  );
}
for (const removed of [
  'import { Ionicons } from "@expo/vector-icons";',
  "NAV_ITEMS",
  "shouldShowBottomNav",
  "styles.bottomNav",
  'accessibilityRole="tab"',
  'label: "Workspace"',
  'label: "Settings"'
]) {
  if (appScreen.includes(removed)) {
    throw new Error(`Expected App to remove bottom navigation: ${removed}`);
  }
}
for (const expected of [
  "onSettings(): void;",
  "isConnected: boolean;",
  'accessibilityLabel="Open settings"',
  'name="grid"',
  'isConnected ? "#ffffff" : "rgba(255,255,255,0.36)"',
  "onPress={onSettings}"
]) {
  if (!projectsScreen.includes(expected)) {
    throw new Error(`Expected ProjectsScreen to expose top-right settings access: ${expected}`);
  }
}
const settingsScreen = await readFile(
  join(process.cwd(), "src/screens/SettingsScreen.tsx"),
  "utf8"
);
for (const expected of [
  "| \"remoteControl\"",
  "RemoteControlScreen",
  "remoteControlStartKey",
  "startRemoteControlFromDashboard",
  'navigateToRoute("remoteControl")',
  "onStartRemoteControl={startRemoteControlFromDashboard}",
  'routeName === "remoteControl"'
]) {
  if (!appScreen.includes(expected) && !settingsScreen.includes(expected) && !typesFile.includes(expected)) {
    throw new Error(`Expected isolated remote-control route wiring: ${expected}`);
  }
}
for (const expected of [
  "api: ApiClient;",
  "onStartRemoteControl(): void;",
  "onSignOut(): void;",
  "requestMobileControlLog",
  "requestLogProgress",
  "settingsScreen",
  "settingsPanel",
  "ABITAT",
  "TOKENS",
  "getCodexTokenUsage",
  "TOKEN_USAGE_TIMEFRAMES",
  "TOTAL",
  "INPUT",
  "OUTPUT",
  "CACHE",
  "1D",
  "7D",
  "ALL",
  'accessibilityLabel="Start remote control"',
  "START REMOTE CONTROL",
  'accessibilityLabel="Request Mac diagnostics log"',
  "REQUEST LOG",
  'accessibilityLabel="Disconnect iPhone from Mac"',
  "onPress={onSignOut}",
  "DISCONNECT"
]) {
  if (!settingsScreen.includes(expected)) {
    throw new Error(`Expected SettingsScreen to render the minimal disconnect UI: ${expected}`);
  }
}
for (const removed of [
  "Header",
  "StatusPill",
  "sharedStyles.card",
  "bootstrap?.workspace.name",
  "bootstrap?.host?.name",
  "bootstrap?.phone.name",
  "pairing?.apiUrl",
  "pairing?.machineId",
  "pairing?.hostMachineId",
  "Back to Projects",
  "Sign Out"
]) {
  if (settingsScreen.includes(removed)) {
    throw new Error(`Expected SettingsScreen to remove old diagnostics content: ${removed}`);
  }
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

for (const expected of ['delivery?: "queue" | "steer"', "delivery"]) {
  if (!apiClient.includes(expected)) {
    throw new Error(`Expected API client to support queued and steer delivery: ${expected}`);
  }
}
for (const expected of [
  "deleteQueuedTurn",
  "updateQueuedTurn",
  'method: "PATCH"',
  "/queue/${encodeURIComponent(clientMessageId)}"
]) {
  if (!apiClient.includes(expected)) {
    throw new Error(`Expected API client to manage queued composer items: ${expected}`);
  }
}
if (!remoteControlScreen.includes('keyboardAppearance="dark"')) {
  throw new Error("Expected RemoteControlScreen to use the dark iOS keyboard");
}
for (const expected of [
  "getRemoteFrame",
  "sendRemoteInput",
  "getRemoteTextTarget",
  "autoStartKey",
  "onFullScreenChange?(isFullScreen: boolean): void;",
  "startSessionFromDashboard",
  "lastFrameSequenceRef",
  "Image",
  "data:image/jpeg;base64,${result.frame.dataBase64}",
  "permissionState",
  "Screen Recording",
  "Accessibility",
  "isFullScreen",
  "openFullScreen",
  "closeFullScreen",
  "lockAsync",
  "OrientationLock.LANDSCAPE",
  "OrientationLock.PORTRAIT_UP",
  "Modal",
  "supportedOrientations",
  "REMOTE_FRAME_REFRESH_INTERVAL_MS = 120",
  "onResponderMove={handleRemoteSurfaceResponderMove}",
  "onResponderRelease={handleRemoteSurfaceResponderRelease}",
  "onStartShouldSetResponder={remoteSurfaceShouldSetResponder}",
  "onStartShouldSetResponderCapture={remoteSurfaceShouldSetResponderCapture}",
  "onMoveShouldSetResponderCapture={remoteSurfaceShouldSetResponderCapture}",
  "sendRemoteCursorMove",
  "positionFromSurfacePoint",
  "remoteViewport",
  "remoteViewportRef",
  "pinchGestureRef",
  "didPinchDuringGestureRef",
  "touchStartRef",
  "startRemoteViewportPinch",
  "updateRemoteViewportPinch",
  "remoteSurfaceShouldSetResponderCapture",
  "event.nativeEvent.touches.length >= 2",
  "didPinchDuringGestureRef.current = true",
  "didPinchDuringGestureRef.current = false",
  "onFullScreenChange?.(true)",
  "onFullScreenChange?.(false)",
  "remoteViewportContentStyle",
  "surfacePointFromTouchEvent",
  "cursorPositionFromSurfacePoint",
  "MAX_REMOTE_VIEWPORT_SCALE",
  "REMOTE_TAP_MOVEMENT_TOLERANCE",
  "visualCursorPosition",
  "visualCursorSyncState",
  "syncVisualCursorFromHost",
  "isMissionControlMode",
  "setIsMissionControlMode(true)",
  "setIsMissionControlMode(false)",
  "sendRemoteClick",
  "sendRemoteDoubleClick",
  "showDock",
  "showMissionControl",
  "moveMissionControlDesktop",
  "sendRemoteEnter",
  "openKeyboardComposer",
  "closeKeyboardComposer",
  "finishKeyboardTyping",
  "sendTextDraft",
  "keyboardDraft",
  "isKeyboardComposerOpen",
  "focusedTextTarget",
  "Keyboard.dismiss()",
  "onChangeText={setKeyboardDraft}",
  "autoFocus",
  "Finish typing",
  'accessibilityHint="Long press for double click"',
  "onLongPress={() => void sendRemoteDoubleClick()}",
  "Left click",
  "Right click",
  "Enter",
  "Keyboard",
  "Show Dock",
  "Dock",
  "Open remote keyboard",
  "Show all desktops",
  "Desktops",
  "Move to left desktop",
  "Move to right desktop",
  'key: `mission-control-${direction}`',
  "isMissionControlMode ? (",
  "styles.remoteClickRail",
  "styles.remoteClickRailSix",
  "styles.remoteClickRailThree",
  "styles.remoteClickButton",
  "styles.remoteClickLabel",
  "styles.keyboardComposer",
  "styles.keyboardComposerInput",
  'key: "enter"',
  'key: "dock"',
  'key: "mission-control"',
  "x: position.x",
  "y: position.y",
  "session.cursorPosition",
  'name="mouse-pointer"',
  "styles.visualCursor",
  "styles.visualCursorSynced",
  "styles.visualCursorPending",
  "fullScreenSurfaceSize",
  'accessibilityLabel="Open full screen remote control"',
  'accessibilityLabel="Exit full screen remote control"',
  "styles.fullScreenBackdrop",
  "styles.fullScreenCloseButton",
  "Back to Dashboard"
]) {
  if (!remoteControlScreen.includes(expected)) {
    throw new Error(`Expected RemoteControlScreen polling MVP behavior: ${expected}`);
  }
}
if (remoteControlScreen.includes("forceSynced")) {
  throw new Error("Expected RemoteControlScreen not to force-snap the visual cursor on host ack");
}
for (const removed of [
  "PanResponder",
  "trackpadPanResponder",
  "onPanResponderMove",
  "styles.trackpadCursor",
  "setTrackpadCursorPosition",
  "DEFAULT_TRACKPAD_CURSOR_POSITION",
  "trackpadCursorPositionRef",
  "trackpadDragStartRef"
]) {
  if (remoteControlScreen.includes(removed)) {
    throw new Error(`Expected RemoteControlScreen to avoid laggy local cursor overlay: ${removed}`);
  }
}
for (const expected of [
  "getRemoteSession",
  "getRemoteFrame",
  "getRemoteTextTarget",
  "sendRemoteInput",
  "/api/remote-control/sessions/${sessionId}/frame",
  "/api/remote-control/sessions/${sessionId}/text-target",
  "/api/remote-control/sessions/${sessionId}/input"
]) {
  if (!apiClient.includes(expected)) {
    throw new Error(`Expected API client to support local remote-control frame/input APIs: ${expected}`);
  }
}
for (const expected of ["forceRefresh?: boolean", 'params.push("forceRefresh=true")']) {
  if (!apiClient.includes(expected)) {
    throw new Error(`Expected API client to support forced message refresh: ${expected}`);
  }
}

for (const expected of [
  "GeneratedFileDownload",
  "GeneratedFileSummary",
  "listGeneratedFiles",
  "downloadGeneratedFile",
  "requestMobileControlLog",
  "getCodexTokenUsage",
  "/api/mobile/codex/token-usage",
  "/api/mobile/diagnostics/log",
  "/api/mobile/conversations/${conversationId}/files",
  "/api/mobile/conversations/${conversationId}/files/${fileId}/download"
]) {
  if (!apiClient.includes(expected)) {
    throw new Error(`Expected API client to support generated file downloads: ${expected}`);
  }
}

for (const expected of ["MODEL_SETTINGS_STORAGE_KEY", "modelSettings", "saveModelSettings"]) {
  if (!mobileStore.includes(expected)) {
    throw new Error(`Expected mobile store to persist Codex model settings: ${expected}`);
  }
}
for (const expected of [
  "clearCachedConversationMessages",
  "clearCachedNavigationData",
  "messageCacheScopeFromPairing",
  "messageCacheScope",
  "await clearCachedConversationMessages()",
  "await clearCachedNavigationData()"
]) {
  if (!mobileStore.includes(expected)) {
    throw new Error(`Expected mobile store to manage the persistent message cache: ${expected}`);
  }
}
for (const expected of [
  "MODEL_SETTINGS_STORAGE_VERSION",
  "serializeModelSettings",
  "parsed.version !== MODEL_SETTINGS_STORAGE_VERSION",
  "setModelSettings(DEFAULT_CODEX_MODEL_SETTINGS)"
]) {
  if (!mobileStore.includes(expected)) {
    throw new Error(`Expected mobile store to reset legacy Codex model settings: ${expected}`);
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
for (const expected of [
  "Minimal",
  "X-High",
  "DEFAULT_CODEX_MODEL_SETTINGS",
  'model: "gpt-5.5"',
  'effort: "high"'
]) {
  if (!codexModelSettings.includes(expected)) {
    throw new Error(`Expected Codex model settings to include ${expected}`);
  }
}

for (const expected of [
  "MESSAGE_CACHE_MAX_MESSAGES",
  "MESSAGE_CACHE_MAX_BYTES",
  "MessageCacheIndexEntry",
  "loadMessageCacheIndex",
  "lastReadSequence",
  "markCachedConversationRead",
  "upsertMessageCacheIndexEntry",
  "highestCachedMessageSequence",
  "messageCacheScopeFromPairing",
  "loadCachedConversationMessages",
  "saveCachedConversationMessages",
  "moveCachedConversationMessages",
  "clearCachedConversationMessages",
  "prepareMessagesForCache"
]) {
  if (!messageCache.includes(expected)) {
    throw new Error(`Expected message-cache to include ${expected}`);
  }
}

for (const expected of [
  "useMessagePreloader",
  "PRELOAD_POLL_INTERVAL_MS",
  "MAX_PRELOAD_CONVERSATIONS_PER_TICK",
  "shouldForcePreloadMessageRefresh",
  "forceRefresh: shouldForcePreloadMessageRefresh",
  "api.listCompletionStates()",
  "api.listMessages",
  "loadMessageCacheIndex",
  "loadCachedConversationMessages",
  "saveCachedConversationMessages",
  "upsertMessageCacheIndexEntry",
  "highestCachedMessageSequence",
  "AppState.addEventListener",
  "isPreloadCandidate",
  "includeRuntime: false"
]) {
  if (!messagePreloader.includes(expected)) {
    throw new Error(`Expected message preloader to include ${expected}`);
  }
}

console.log(`validated ${requiredFiles.length} iPhone app files`);
