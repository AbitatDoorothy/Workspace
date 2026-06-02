import Combine
import Foundation
import XCTest
@testable import AbitatMac
@testable import AbitatMacCore

@MainActor
final class AppModelTests: XCTestCase {
    func testIdlePollingDoesNotReloadSelectedConversationDetails() async throws {
        let backend = PollingBackend(
            completionStates: [],
            conversations: [
                DesktopConversation(
                    id: "thread-idle",
                    projectId: "project-a",
                    prompt: "Idle chat",
                    status: "approved",
                    updatedAt: nil
                )
            ]
        )
        let model = AppModel(backend: backend)
        model.selectedProjectId = "project-a"
        model.selectedConversationId = "thread-idle"

        await model.refreshPollingTick()

        XCTAssertEqual(backend.messageCallCount, 0)
        XCTAssertEqual(backend.generatedFilesCallCount, 0)
    }

    func testActivePollingRefreshesSelectedConversationDetails() async throws {
        let backend = PollingBackend(
            completionStates: [
                CompletionState(
                    conversationId: "thread-running",
                    projectId: "project-a",
                    prompt: "Running chat",
                    status: "running",
                    isComplete: false,
                    failed: false,
                    updatedAt: nil
                )
            ],
            conversations: [
                DesktopConversation(
                    id: "thread-running",
                    projectId: "project-a",
                    prompt: "Running chat",
                    status: "running",
                    updatedAt: nil
                )
            ]
        )
        let model = AppModel(backend: backend)
        model.selectedProjectId = "project-a"
        model.selectedConversationId = "thread-running"

        await model.refreshPollingTick()

        XCTAssertEqual(backend.messageCallCount, 1)
        XCTAssertEqual(backend.generatedFilesCallCount, 1)
        XCTAssertEqual(model.visibleMessages.map(\.id), ["message-running"])
    }

    func testClearingSelectionHidesResidentLargeConversationMessages() async throws {
        let conversation = DesktopConversation(
            id: "thread-large",
            projectId: "project-a",
            prompt: "Large chat",
            status: "approved",
            updatedAt: nil
        )
        let largeMessages = (0..<994).map { index in
            DesktopMessage(
                id: "message-\(index)",
                conversationId: conversation.id,
                role: index.isMultiple(of: 2) ? "assistant" : "user",
                content: "message \(index)",
                sequence: index,
                createdAt: nil
            )
        }
        let backend = PollingBackend(
            completionStates: [],
            conversations: [conversation],
            loadedMessages: largeMessages
        )
        let model = AppModel(backend: backend)
        model.selectedProjectId = "project-a"
        model.selectedConversationId = conversation.id

        await model.refreshStatusOnly(includeConversationDetails: true)
        XCTAssertEqual(model.visibleMessages.count, 994)
        let loadedVisibleMessagesVersion = model.visibleMessagesVersion

        model.selectedConversationId = nil

        XCTAssertEqual(model.messages.count, 994)
        XCTAssertTrue(model.visibleMessages.isEmpty)
        XCTAssertGreaterThan(model.visibleMessagesVersion, loadedVisibleMessagesVersion)
    }

    func testSelectConversationClearsOldDetailsBeforeAssigningNewSelection() async throws {
        let logURL = try temporaryActivityLogURL()
        let logger = AppActivityLogger(fileURL: logURL)
        let oldConversation = DesktopConversation(
            id: "thread-old",
            projectId: "project-a",
            prompt: "Old chat",
            status: "running",
            updatedAt: nil
        )
        let oldMessages = (0..<3).map { index in
            DesktopMessage(
                id: "old-message-\(index)",
                conversationId: oldConversation.id,
                role: "assistant",
                content: "old message \(index)",
                sequence: index,
                createdAt: nil
            )
        }
        let backend = PollingBackend(
            completionStates: [],
            conversations: [oldConversation],
            loadedMessages: oldMessages
        )
        let model = AppModel(backend: backend, activityLogger: logger)
        model.selectedProjectId = oldConversation.projectId
        model.selectedConversationId = oldConversation.id

        await model.refreshStatusOnly(includeConversationDetails: true)
        XCTAssertEqual(model.visibleMessages.count, oldMessages.count)

        let newConversation = DesktopConversation(
            id: "thread-new-selection",
            projectId: "project-b",
            prompt: "New chat",
            status: "approved",
            updatedAt: nil
        )
        model.selectConversation(newConversation)
        logger.flush()

        XCTAssertEqual(model.selectedProjectId, newConversation.projectId)
        XCTAssertEqual(model.selectedConversationId, newConversation.id)
        XCTAssertTrue(model.messages.isEmpty)
        XCTAssertTrue(model.generatedFiles.isEmpty)
        XCTAssertTrue(model.visibleMessages.isEmpty)

        let data = try String(contentsOf: logURL, encoding: .utf8)
        let clearRange = try XCTUnwrap(data.range(of: "selectConversation.clearDetails.end"))
        let assignedRange = try XCTUnwrap(data.range(of: "selectConversation.selectionAssigned"))
        let scheduledRange = try XCTUnwrap(data.range(of: "selectConversation.taskScheduled"))
        let endRange = try XCTUnwrap(data.range(of: "selectConversation.end"))

        XCTAssertLessThan(clearRange.lowerBound, assignedRange.lowerBound)
        XCTAssertLessThan(assignedRange.lowerBound, scheduledRange.lowerBound)
        XCTAssertLessThan(scheduledRange.lowerBound, endRange.lowerBound)
        XCTAssertFalse(data.contains("old message"))
    }

    func testSidebarTextPreviewTruncatesLongValues() {
        let exactPreview = String(repeating: "b", count: SidebarTextPreview.maxLength)
        let preview = SidebarTextPreview.truncated(String(repeating: "a", count: 220))

        XCTAssertEqual(SidebarTextPreview.truncated(exactPreview), exactPreview)
        XCTAssertEqual(preview.count, SidebarTextPreview.maxLength)
        XCTAssertTrue(preview.hasSuffix("…"))
    }

    func testSelectingConversationPublishesSelectionAfterOldDetailsAreCleared() async throws {
        let oldConversation = DesktopConversation(
            id: "thread-old",
            projectId: "project-a",
            prompt: "Old chat",
            status: "running",
            updatedAt: nil
        )
        let newConversation = DesktopConversation(
            id: "thread-new",
            projectId: "project-b",
            prompt: "New chat",
            status: "approved",
            updatedAt: nil
        )
        let backend = PollingBackend(
            completionStates: [],
            conversations: [oldConversation],
            loadedMessages: [
                DesktopMessage(
                    id: "old-message",
                    conversationId: oldConversation.id,
                    role: "assistant",
                    content: "Old message",
                    sequence: 1,
                    createdAt: nil
                )
            ],
            loadedFiles: [
                GeneratedFile(id: "old-file", name: "old.txt", path: "/tmp/old.txt", size: 12, mimeType: "text/plain")
            ]
        )
        let model = AppModel(backend: backend)
        model.selectedProjectId = oldConversation.projectId
        model.selectedConversationId = oldConversation.id

        await model.refreshStatusOnly(includeConversationDetails: true)
        XCTAssertEqual(model.visibleMessages.map(\.id), ["old-message"])
        XCTAssertEqual(model.generatedFiles.map(\.name), ["old.txt"])

        var observedMessageCountOnNewSelection: Int?
        var observedVisibleMessageCountOnNewSelection: Int?
        var observedFileCountOnNewSelection: Int?
        var cancellables: Set<AnyCancellable> = []
        model.$selectedConversationId
            .sink { selectedConversationId in
                guard selectedConversationId == newConversation.id else {
                    return
                }
                observedMessageCountOnNewSelection = model.messages.count
                observedVisibleMessageCountOnNewSelection = model.visibleMessages.count
                observedFileCountOnNewSelection = model.generatedFiles.count
            }
            .store(in: &cancellables)

        model.selectConversation(newConversation)

        XCTAssertEqual(observedMessageCountOnNewSelection, 0)
        XCTAssertEqual(observedVisibleMessageCountOnNewSelection, 0)
        XCTAssertEqual(observedFileCountOnNewSelection, 0)
    }

    func testStaleNonForcedConversationLoadDoesNotClearNewChatSelectionAfterSend() async throws {
        let backend = RaceBackend()
        let model = AppModel(backend: backend)
        model.selectedProjectId = "project-a"
        model.prompt = "Start a new chat"

        let staleLoad = Task {
            await model.ensureConversationsLoaded(projectId: "project-a")
        }
        try await waitUntil("stale conversation load starts") {
            backend.firstConversationContinuation != nil
        }

        model.sendPrompt()
        try await waitUntil("new chat is selected") {
            model.selectedConversationId == "thread-new"
        }
        try await waitUntil("detail load starts") {
            backend.messageContinuation != nil
        }

        backend.completeFirstConversationLoadWithStaleList()
        await staleLoad.value
        backend.completeMessageLoad()

        try await waitUntil("new chat message renders") {
            model.visibleMessages.contains { message in
                message.conversationId == "thread-new" && message.content == "Assistant reply"
            }
        }

        XCTAssertEqual(model.selectedConversationId, "thread-new")
        XCTAssertEqual(model.conversations(forProjectId: "project-a").map(\.id), ["thread-new"])
    }

    private func waitUntil(
        _ description: String,
        predicate: @MainActor @escaping () -> Bool
    ) async throws {
        let deadline = Date().addingTimeInterval(2)
        while !predicate() {
            if Date() > deadline {
                XCTFail("Timed out waiting for \(description)")
                return
            }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
    }

    private func temporaryActivityLogURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("abitat-app-model-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("activity.jsonl")
    }
}

@MainActor
private final class PollingBackend: AppBackendClient, @unchecked Sendable {
    private let completionStates: [CompletionState]
    private let conversations: [DesktopConversation]
    private let loadedMessages: [DesktopMessage]
    private let loadedFiles: [GeneratedFile]
    private(set) var messageCallCount = 0
    private(set) var generatedFilesCallCount = 0

    init(
        completionStates: [CompletionState],
        conversations: [DesktopConversation],
        loadedMessages: [DesktopMessage]? = nil,
        loadedFiles: [GeneratedFile] = []
    ) {
        self.completionStates = completionStates
        self.conversations = conversations
        self.loadedMessages = loadedMessages ?? [
            DesktopMessage(
                id: "message-running",
                conversationId: "thread-running",
                role: "assistant",
                content: "Running update",
                sequence: 1,
                createdAt: nil
            )
        ]
        self.loadedFiles = loadedFiles
    }

    func status() async throws -> DesktopStatus {
        testDesktopStatus()
    }

    func createPairing() async throws -> PairingPayload {
        PairingPayload(expiresAt: "", manualCode: "", payloadJson: "{}", relayId: nil)
    }

    func projects() async throws -> [DesktopProject] {
        [testProject()]
    }

    func conversations(projectId: String) async throws -> [DesktopConversation] {
        conversations
    }

    func messages(conversationId: String, forceRefresh: Bool) async throws -> [DesktopMessage] {
        messageCallCount += 1
        return loadedMessages.map { message in
            DesktopMessage(
                id: message.id,
                conversationId: conversationId,
                role: message.role,
                content: message.content,
                sequence: message.sequence,
                createdAt: message.createdAt
            )
        }
    }

    func startConversation(
        projectId: String,
        prompt: String,
        modelSettings: ModelSettings?,
        selectedSkillIds: [String]
    ) async throws -> ConversationStartResult {
        ConversationStartResult(conversationId: "thread-new", status: "running")
    }

    func continueConversation(
        conversationId: String,
        prompt: String,
        delivery: String,
        modelSettings: ModelSettings?,
        selectedSkillIds: [String],
        clientMessageId: String
    ) async throws -> ConversationStartResult {
        ConversationStartResult(conversationId: conversationId, status: "running")
    }

    func deleteQueuedTurn(conversationId: String, clientMessageId: String) async throws -> QueuedTurnResult {
        QueuedTurnResult(conversationId: conversationId, removed: true, status: "queued", updated: nil)
    }

    func updateQueuedTurn(conversationId: String, clientMessageId: String, prompt: String) async throws -> QueuedTurnResult {
        QueuedTurnResult(conversationId: conversationId, removed: nil, status: "queued", updated: true)
    }

    func completions() async throws -> [CompletionState] {
        completionStates
    }

    func models() async throws -> [ModelOption] {
        []
    }

    func pluginSuggestions() async throws -> [PluginSuggestion] {
        []
    }

    func tokenUsage() async throws -> TokenUsageSummary {
        testTokenUsage()
    }

    func generatedFiles(conversationId: String) async throws -> [GeneratedFile] {
        generatedFilesCallCount += 1
        return loadedFiles
    }

    func automations() async throws -> [AutomationSummary] {
        []
    }

    func createAutomation(_ input: AutomationWriteInput) async throws -> AutomationSummary {
        throw BackendClientError.requestFailed("not implemented")
    }

    func updateAutomationStatus(id: String, status: String) async throws -> AutomationSummary {
        throw BackendClientError.requestFailed("not implemented")
    }

    func diagnosticsLog() async throws -> DiagnosticsLog {
        DiagnosticsLog(data: "", logPath: "/tmp/abitat.log", size: 0, truncated: false)
    }

    func reveal(path: String) async throws {}

    func open(path: String) async throws {}
}

@MainActor
private final class RaceBackend: AppBackendClient, @unchecked Sendable {
    var firstConversationContinuation: CheckedContinuation<[DesktopConversation], Error>?
    var messageContinuation: CheckedContinuation<[DesktopMessage], Error>?

    private var conversationCallCount = 0

    func completeFirstConversationLoadWithStaleList() {
        firstConversationContinuation?.resume(returning: [oldConversation])
        firstConversationContinuation = nil
    }

    func completeMessageLoad() {
        messageContinuation?.resume(returning: [
            DesktopMessage(
                id: "message-assistant",
                conversationId: "thread-new",
                role: "assistant",
                content: "Assistant reply",
                sequence: 2,
                createdAt: nil
            )
        ])
        messageContinuation = nil
    }

    func status() async throws -> DesktopStatus {
        testDesktopStatus()
    }

    func createPairing() async throws -> PairingPayload {
        PairingPayload(expiresAt: "", manualCode: "", payloadJson: "{}", relayId: nil)
    }

    func projects() async throws -> [DesktopProject] {
        [testProject()]
    }

    func conversations(projectId: String) async throws -> [DesktopConversation] {
        conversationCallCount += 1
        if conversationCallCount == 1 {
            return try await withCheckedThrowingContinuation { continuation in
                firstConversationContinuation = continuation
            }
        }
        return [newConversation]
    }

    func messages(conversationId: String, forceRefresh: Bool) async throws -> [DesktopMessage] {
        try await withCheckedThrowingContinuation { continuation in
            messageContinuation = continuation
        }
    }

    func startConversation(
        projectId: String,
        prompt: String,
        modelSettings: ModelSettings?,
        selectedSkillIds: [String]
    ) async throws -> ConversationStartResult {
        ConversationStartResult(conversationId: "thread-new", status: "running")
    }

    func continueConversation(
        conversationId: String,
        prompt: String,
        delivery: String,
        modelSettings: ModelSettings?,
        selectedSkillIds: [String],
        clientMessageId: String
    ) async throws -> ConversationStartResult {
        ConversationStartResult(conversationId: conversationId, status: "running")
    }

    func deleteQueuedTurn(conversationId: String, clientMessageId: String) async throws -> QueuedTurnResult {
        QueuedTurnResult(conversationId: conversationId, removed: true, status: "queued", updated: nil)
    }

    func updateQueuedTurn(conversationId: String, clientMessageId: String, prompt: String) async throws -> QueuedTurnResult {
        QueuedTurnResult(conversationId: conversationId, removed: nil, status: "queued", updated: true)
    }

    func completions() async throws -> [CompletionState] {
        []
    }

    func models() async throws -> [ModelOption] {
        []
    }

    func pluginSuggestions() async throws -> [PluginSuggestion] {
        []
    }

    func tokenUsage() async throws -> TokenUsageSummary {
        testTokenUsage()
    }

    func generatedFiles(conversationId: String) async throws -> [GeneratedFile] {
        []
    }

    func automations() async throws -> [AutomationSummary] {
        []
    }

    func createAutomation(_ input: AutomationWriteInput) async throws -> AutomationSummary {
        throw BackendClientError.requestFailed("not implemented")
    }

    func updateAutomationStatus(id: String, status: String) async throws -> AutomationSummary {
        throw BackendClientError.requestFailed("not implemented")
    }

    func diagnosticsLog() async throws -> DiagnosticsLog {
        DiagnosticsLog(data: "", logPath: "/tmp/abitat.log", size: 0, truncated: false)
    }

    func reveal(path: String) async throws {}

    func open(path: String) async throws {}

    private var oldConversation: DesktopConversation {
        DesktopConversation(
            id: "thread-old",
            projectId: "project-a",
            prompt: "Old chat",
            status: "approved",
            updatedAt: nil
        )
    }

    private var newConversation: DesktopConversation {
        DesktopConversation(
            id: "thread-new",
            projectId: "project-a",
            prompt: "Start a new chat",
            status: "running",
            updatedAt: nil
        )
    }
}

private func testDesktopStatus() -> DesktopStatus {
    DesktopStatus(
        codex: DesktopStatus.Codex(available: true, error: nil),
        diagnosticsLogPath: "/tmp/abitat.log",
        endpoint: "http://127.0.0.1:3971",
        localEndpoint: "http://127.0.0.1:3901",
        macId: "mac-test",
        macName: "Test Mac",
        relayConnected: false,
        relayEndpoint: "https://workspace.abitat.io",
        relayId: nil,
        serverStartedAt: "2026-06-01T00:00:00.000Z",
        transport: "loopback"
    )
}

private func testProject() -> DesktopProject {
    DesktopProject(
        id: "project-a",
        name: "Project A",
        conversationCount: 1,
        hostLocalPath: nil,
        updatedAt: nil
    )
}

private func testTokenUsage() -> TokenUsageSummary {
    TokenUsageSummary(
        generatedAt: "2026-06-01T00:00:00.000Z",
        timeframes: TokenUsageSummary.Timeframes(
            oneDay: TokenBucket(cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0),
            sevenDays: TokenBucket(cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0),
            all: TokenBucket(cachedInputTokens: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0)
        )
    )
}
