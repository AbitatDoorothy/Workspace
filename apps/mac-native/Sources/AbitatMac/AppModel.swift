import AbitatMacCore
import Foundation

@MainActor
final class AppModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case starting
        case online
        case failed(String)
    }

    enum Panel: String, CaseIterable, Identifiable {
        case chat = "Chat"
        case files = "Files"
        case automations = "Automations"
        case pairing = "Pairing"
        case logs = "Logs"
        case remote = "Remote"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .chat: return "text.bubble"
            case .files: return "doc.text"
            case .automations: return "clock.arrow.circlepath"
            case .pairing: return "iphone.gen2"
            case .logs: return "terminal"
            case .remote: return "display"
            }
        }
    }

    enum DeliveryMode: String, CaseIterable, Identifiable {
        case queue
        case steer

        var id: String { rawValue }
        var label: String { rawValue.uppercased() }
    }

    struct QueuedTurnDraft: Identifiable, Equatable {
        let id: String
        let conversationId: String
        var prompt: String
        var status: String
        let createdAt: Date
    }

    struct AutomationDraft: Equatable {
        var name = ""
        var prompt = ""
        var rrule = "FREQ=DAILY;INTERVAL=1"
        var cwd = ""
        var model = ""
        var reasoningEffort = "medium"
    }

    struct PluginAutocompleteToken: Equatable {
        let query: String
        let range: NSRange
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var ready: HelperReadyMessage?
    @Published private(set) var status: DesktopStatus?
    @Published private(set) var projects: [DesktopProject] = []
    @Published private(set) var conversationsByProjectId: [String: [DesktopConversation]] = [:]
    @Published private(set) var loadedConversationProjectIds: Set<String> = []
    @Published private(set) var loadingConversationProjectIds: Set<String> = []
    @Published private(set) var messages: [DesktopMessage] = []
    @Published private(set) var visibleMessages: [DesktopMessage] = []
    @Published private(set) var visibleMessagesVersion = 0
    @Published private(set) var completions: [CompletionState] = []
    @Published private(set) var models: [ModelOption] = []
    @Published private(set) var generatedFiles: [GeneratedFile] = []
    @Published private(set) var tokenUsage: TokenUsageSummary?
    @Published private(set) var automations: [AutomationSummary] = []
    @Published private(set) var pluginSuggestions: [PluginSuggestion] = []
    @Published private(set) var diagnostics: DiagnosticsLog?
    @Published private(set) var appActivityLog: DiagnosticsLog?
    @Published private(set) var pairing: PairingPayload?
    @Published private(set) var queuedTurns: [QueuedTurnDraft] = []
    @Published private var optimisticMessages: [DesktopMessage] = []

    @Published var selectedProjectId: String?
    @Published var selectedConversationId: String? {
        didSet {
            guard selectedConversationId != oldValue else {
                return
            }
            refreshVisibleMessages()
        }
    }
    @Published var selectedPanel: Panel = .chat {
        didSet {
            guard selectedPanel != oldValue else {
                return
            }
            activityLogger.log("panel.change", fields: ["panel": selectedPanel.rawValue])
        }
    }
    @Published var prompt = "" {
        didSet {
            dismissedPluginTokenRange = nil
            reconcileSelectedSkills()
            clampActivePluginSuggestionIndex()
        }
    }
    @Published var promptSelectionRange = NSRange(location: 0, length: 0) {
        didSet {
            clampActivePluginSuggestionIndex()
        }
    }
    @Published var selectedSkillIds: [String] = []
    @Published var activePluginSuggestionIndex = 0
    @Published var selectedModelId = ""
    @Published var selectedReasoningEffort = "medium"
    @Published var deliveryMode: DeliveryMode = .queue
    @Published var automationDraft = AutomationDraft()
    @Published var isSending = false
    @Published var isCreatingAutomation = false
    @Published var errorMessage: String?

    private let backendProcess = BackendProcess()
    private let activityLogger: AppActivityLogger
    private let stallWatchdog: AppActivityStallWatchdog
    private var backend: AppBackendClient?
    private var refreshTask: Task<Void, Never>?
    private var conversationLoadCountsByProjectId: [String: Int] = [:]
    private var latestConversationLoadRequestIdByProjectId: [String: Int] = [:]
    private var nextConversationLoadRequestId = 0
    private var locallyStartedConversationIds: Set<String> = []
    private var messagesConversationId: String?
    private var didStart = false
    private var dismissedPluginTokenRange: NSRange?

    init(
        backend: AppBackendClient? = nil,
        activityLogger: AppActivityLogger = .shared
    ) {
        self.backend = backend
        self.activityLogger = activityLogger
        self.stallWatchdog = AppActivityStallWatchdog(logger: activityLogger)
    }

    var selectedProject: DesktopProject? {
        projects.first(where: { $0.id == selectedProjectId })
    }

    var conversations: [DesktopConversation] {
        guard let selectedProjectId else {
            return []
        }
        return conversationsByProjectId[selectedProjectId] ?? []
    }

    var selectedConversation: DesktopConversation? {
        guard let selectedConversationId else {
            return nil
        }
        if let selectedProjectId,
           let conversation = conversationsByProjectId[selectedProjectId]?.first(where: { $0.id == selectedConversationId }) {
            return conversation
        }
        return conversationsByProjectId.values.lazy.compactMap { conversations in
            conversations.first(where: { $0.id == selectedConversationId })
        }.first
    }

    var selectedConversationStatus: String {
        if let selectedConversationId,
           let completion = completions.first(where: { $0.conversationId == selectedConversationId }) {
            return completion.status
        }
        return selectedConversation?.status ?? "ready"
    }

    var isBusy: Bool {
        ["awaiting_approval", "committing", "preparing", "queued", "running"].contains(
            selectedConversationStatus
        )
    }

    var queuedTurnsForSelectedConversation: [QueuedTurnDraft] {
        queuedTurns.filter { $0.conversationId == selectedConversationId }
    }

    var activePluginToken: PluginAutocompleteToken? {
        pluginAutocompleteToken(in: prompt, selectionLocation: promptSelectionRange.location)
    }

    var activePluginSuggestions: [PluginSuggestion] {
        guard let token = activePluginToken else {
            return []
        }
        if dismissedPluginTokenRange == token.range {
            return []
        }
        return rankedPluginSuggestions(query: token.query, suggestions: pluginSuggestions)
    }

    var activePluginSuggestion: PluginSuggestion? {
        let suggestions = activePluginSuggestions
        guard !suggestions.isEmpty else {
            return nil
        }
        return suggestions[min(activePluginSuggestionIndex, suggestions.count - 1)]
    }

    var appActivityLogPath: String {
        activityLogger.fileURL.path
    }

    func conversations(forProjectId projectId: String) -> [DesktopConversation] {
        conversationsByProjectId[projectId] ?? []
    }

    func hasLoadedConversations(projectId: String) -> Bool {
        loadedConversationProjectIds.contains(projectId)
    }

    func isLoadingConversations(projectId: String) -> Bool {
        loadingConversationProjectIds.contains(projectId)
    }

    func ensureConversationsLoaded(projectId: String) async {
        await loadConversations(projectId: projectId)
    }

    func start() {
        guard !didStart else {
            return
        }
        didStart = true
        phase = .starting
        activityLogger.log("app.start")
        activityLogger.log("phase.change", fields: ["phase": "starting"])
        stallWatchdog.start()

        Task {
            do {
                self.activityLogger.log("backend.start.start")
                let ready = try await backendProcess.start()
                self.ready = ready
                self.backend = BackendClient(endpoint: ready.desktopEndpoint)
                self.phase = .online
                self.activityLogger.log("backend.start.end", fields: [
                    "desktopEndpoint": ready.desktopEndpoint.absoluteString,
                    "localEndpoint": ready.localEndpoint.absoluteString,
                    "relayId": ready.relayId ?? ""
                ])
                self.activityLogger.log("phase.change", fields: ["phase": "online"])
                await refreshAll()
                startPolling()
            } catch {
                let message = readableError(error)
                phase = .failed(message)
                activityLogger.log("backend.start.error", fields: ["error": message])
                activityLogger.log("phase.change", fields: ["phase": "failed"])
            }
        }
    }

    func stop() {
        activityLogger.log("app.stop")
        refreshTask?.cancel()
        stallWatchdog.stop()
        backendProcess.stop()
    }

    func refreshAll() async {
        guard let backend else {
            return
        }

        let startedAt = Date()
        activityLogger.log("refreshAll.start", fields: activityContext())
        do {
            async let status = backend.status()
            async let projects = backend.projects()
            async let completions = backend.completions()
            async let models = backend.models()
            async let pluginSuggestions = backend.pluginSuggestions()
            async let tokenUsage = backend.tokenUsage()
            async let automations = backend.automations()

            self.status = try await status
            self.projects = try await projects
            self.completions = try await completions
            self.models = try await models
            self.pluginSuggestions = try await pluginSuggestions
            self.tokenUsage = try await tokenUsage
            self.automations = try await automations

            if selectedModelId.isEmpty {
                selectedModelId = self.models.first?.id ?? ""
            }
            if automationDraft.model.isEmpty {
                automationDraft.model = selectedModelId
            }
            if let defaultEffort = self.models.first(where: { $0.id == selectedModelId })?.defaultReasoningEffort {
                selectedReasoningEffort = selectedReasoningEffort.isEmpty ? defaultEffort : selectedReasoningEffort
                automationDraft.reasoningEffort = automationDraft.reasoningEffort.isEmpty
                    ? defaultEffort
                    : automationDraft.reasoningEffort
            }

            pruneConversationCache()
            if selectedProjectId == nil || !self.projects.contains(where: { $0.id == selectedProjectId }) {
                selectedProjectId = self.projects.first?.id
                selectedConversationId = nil
                clearConversationDetails()
            }
            await refreshConversationLists(projectIds: statusPollProjectIds(), force: true)
            if let selectedConversationId {
                await loadConversationDetails(conversationId: selectedConversationId)
            }
            reconcileOptimisticMessages()
            errorMessage = nil
            activityLogger.log("refreshAll.end", fields: activityContext([
                "durationMs": durationMs(since: startedAt),
                "projectCount": self.projects.count,
                "completionCount": self.completions.count,
                "modelCount": self.models.count,
                "pluginSuggestionCount": self.pluginSuggestions.count,
                "automationCount": self.automations.count
            ]))
        } catch {
            let message = readableError(error)
            errorMessage = message
            activityLogger.log("refreshAll.error", fields: activityContext([
                "durationMs": durationMs(since: startedAt),
                "error": message
            ]))
        }
    }

    func refreshStatusOnly(includeConversationDetails: Bool = true) async {
        guard let backend else {
            return
        }

        let startedAt = Date()
        activityLogger.log("refreshStatusOnly.start", fields: activityContext([
            "includeConversationDetails": includeConversationDetails
        ]))
        do {
            async let status = backend.status()
            async let completions = backend.completions()
            self.status = try await status
            self.completions = try await completions

            await refreshConversationLists(projectIds: statusPollProjectIds(), force: true)
            if includeConversationDetails, let selectedConversationId {
                await loadConversationDetails(conversationId: selectedConversationId)
            }
            activityLogger.log("refreshStatusOnly.end", fields: activityContext([
                "durationMs": durationMs(since: startedAt),
                "completionCount": self.completions.count,
                "conversationDetailsLoaded": includeConversationDetails && selectedConversationId != nil
            ]))
        } catch {
            let message = readableError(error)
            errorMessage = message
            activityLogger.log("refreshStatusOnly.error", fields: activityContext([
                "durationMs": durationMs(since: startedAt),
                "error": message
            ]))
        }
    }

    func refreshPollingTick() async {
        let startedAt = Date()
        activityLogger.log("polling.tick.start", fields: activityContext())
        await refreshStatusOnly(includeConversationDetails: false)
        let shouldLoadDetails = shouldRefreshSelectedConversationDetailsDuringPolling()
        if shouldLoadDetails, let selectedConversationId {
            await loadConversationDetails(conversationId: selectedConversationId)
        }
        activityLogger.log("polling.tick.end", fields: activityContext([
            "durationMs": durationMs(since: startedAt),
            "loadedConversationDetails": shouldLoadDetails && selectedConversationId != nil
        ]))
    }

    func selectProject(_ project: DesktopProject) {
        activityLogger.log("selectProject", fields: activityContext([
            "projectId": project.id,
            "previousSelectedProjectId": selectedProjectId ?? "",
            "previousSelectedConversationId": selectedConversationId ?? "",
            "conversationCount": project.conversationCount ?? 0
        ]))
        selectedProjectId = project.id
        selectedConversationId = nil
        clearConversationDetails()
        Task {
            await loadConversations(projectId: project.id)
        }
    }

    func selectConversation(_ conversation: DesktopConversation) {
        let didChangeSelection = selectedProjectId != conversation.projectId
            || selectedConversationId != conversation.id
        activityLogger.log("selectConversation.start", fields: activityContext([
            "projectId": conversation.projectId,
            "conversationId": conversation.id,
            "status": conversation.status,
            "didChangeSelection": didChangeSelection,
            "previousSelectedProjectId": selectedProjectId ?? "",
            "previousSelectedConversationId": selectedConversationId ?? ""
        ]))
        guard didChangeSelection else {
            if selectedPanel != .chat {
                selectedPanel = .chat
            }
            activityLogger.log("selectConversation.end", fields: activityContext([
                "conversationId": conversation.id,
                "didChangeSelection": false
            ]))
            return
        }
        let startedAt = Date()
        let previousMessageCount = messages.count
        let previousVisibleMessageCount = visibleMessages.count
        let previousGeneratedFileCount = generatedFiles.count

        activityLogger.log("selectConversation.clearDetails.start", fields: activityContext([
            "conversationId": conversation.id,
            "previousMessageCount": previousMessageCount,
            "previousVisibleMessageCount": previousVisibleMessageCount,
            "previousGeneratedFileCount": previousGeneratedFileCount
        ]))
        messagesConversationId = nil
        messages = []
        generatedFiles = []
        optimisticMessages.removeAll { $0.conversationId == "pending" || $0.conversationId != conversation.id }
        refreshVisibleMessages()
        activityLogger.log("selectConversation.clearDetails.end", fields: activityContext([
            "conversationId": conversation.id,
            "previousMessageCount": previousMessageCount,
            "previousVisibleMessageCount": previousVisibleMessageCount,
            "previousGeneratedFileCount": previousGeneratedFileCount
        ]))

        if selectedProjectId != conversation.projectId {
            selectedProjectId = conversation.projectId
        }
        selectedConversationId = conversation.id
        if selectedPanel != .chat {
            selectedPanel = .chat
        }
        activityLogger.log("selectConversation.selectionAssigned", fields: activityContext([
            "conversationId": conversation.id,
            "durationMs": durationMs(since: startedAt)
        ]))

        let shouldUpsertCache = !isConversationCached(conversation)
        if shouldUpsertCache {
            activityLogger.log("selectConversation.cacheUpsert.start", fields: activityContext([
                "conversationId": conversation.id,
                "durationMs": durationMs(since: startedAt)
            ]))
            upsertCachedConversation(conversation)
            activityLogger.log("selectConversation.cacheUpsert.end", fields: activityContext([
                "conversationId": conversation.id,
                "durationMs": durationMs(since: startedAt)
            ]))
        } else {
            activityLogger.log("selectConversation.cacheUpsert.skip", fields: activityContext([
                "conversationId": conversation.id,
                "durationMs": durationMs(since: startedAt)
            ]))
        }

        activityLogger.log("selectConversation.taskScheduled", fields: activityContext([
            "conversationId": conversation.id,
            "durationMs": durationMs(since: startedAt)
        ]))
        Task {
            await loadConversationDetails(conversationId: conversation.id)
        }
        activityLogger.log("selectConversation.end", fields: activityContext([
            "conversationId": conversation.id,
            "didChangeSelection": true,
            "durationMs": durationMs(since: startedAt)
        ]))
    }

    func moveActivePluginSuggestion(by delta: Int) {
        let suggestions = activePluginSuggestions
        guard !suggestions.isEmpty else {
            activePluginSuggestionIndex = 0
            return
        }

        let nextIndex = (activePluginSuggestionIndex + delta + suggestions.count) % suggestions.count
        activePluginSuggestionIndex = nextIndex
    }

    func dismissPluginSuggestions() {
        dismissedPluginTokenRange = activePluginToken?.range
        activePluginSuggestionIndex = 0
    }

    @discardableResult
    func acceptActivePluginSuggestion() -> Bool {
        guard let token = activePluginToken, let suggestion = activePluginSuggestion else {
            return false
        }

        let replacement = "@\(suggestion.displayName) "
        let nextPrompt = (prompt as NSString).replacingCharacters(in: token.range, with: replacement)
        prompt = nextPrompt
        let nextLocation = token.range.location + (replacement as NSString).length
        promptSelectionRange = NSRange(location: nextLocation, length: 0)
        if !selectedSkillIds.contains(suggestion.id) {
            selectedSkillIds.append(suggestion.id)
        }
        reconcileSelectedSkills()
        dismissedPluginTokenRange = nil
        activePluginSuggestionIndex = 0
        return true
    }

    func sendPrompt() {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let backend else {
            return
        }

        isSending = true
        let projectId = selectedProjectId
        let conversationId = selectedConversationId
        let delivery = deliveryMode
        let clientMessageId = "swift-\(UUID().uuidString)"
        let settings = currentModelSettings()
        let skillIds = selectedSkillIds
        let optimisticConversationId = conversationId ?? "pending"
        activityLogger.log("send.start", fields: activityContext([
            "conversationId": conversationId ?? "",
            "delivery": delivery.rawValue,
            "promptLength": trimmed.count,
            "skillCount": skillIds.count,
            "hasModelSettings": settings != nil
        ]))
        addOptimisticMessage(id: clientMessageId, conversationId: optimisticConversationId, prompt: trimmed)
        prompt = ""
        selectedSkillIds = []

        Task {
            let startedAt = Date()
            do {
                let result: ConversationStartResult
                if let conversationId {
                    result = try await backend.continueConversation(
                        conversationId: conversationId,
                        prompt: trimmed,
                        delivery: delivery.rawValue,
                        modelSettings: settings,
                        selectedSkillIds: skillIds,
                        clientMessageId: clientMessageId
                    )
                    if result.status == "queued" {
                        queuedTurns.removeAll { $0.id == clientMessageId }
                        queuedTurns.append(
                            QueuedTurnDraft(
                                id: clientMessageId,
                                conversationId: conversationId,
                                prompt: trimmed,
                                status: result.status,
                                createdAt: Date()
                            )
                        )
                    }
                } else if let projectId {
                    result = try await backend.startConversation(
                        projectId: projectId,
                        prompt: trimmed,
                        modelSettings: settings,
                        selectedSkillIds: skillIds
                    )
                    selectedConversationId = result.conversationId
                    locallyStartedConversationIds.insert(result.conversationId)
                    movePendingOptimisticMessage(id: clientMessageId, to: result.conversationId)
                } else {
                    throw BackendClientError.requestFailed("Select a project before sending.")
                }

                await refreshAfterSend(projectId: projectId, conversationId: result.conversationId)
                if selectedConversationId == nil {
                    selectedConversationId = result.conversationId
                }
                activityLogger.log("send.end", fields: activityContext([
                    "durationMs": durationMs(since: startedAt),
                    "conversationId": result.conversationId,
                    "status": result.status
                ]))
            } catch {
                removeOptimisticMessage(id: clientMessageId)
                prompt = trimmed
                selectedSkillIds = skillIds
                let message = readableError(error)
                errorMessage = message
                activityLogger.log("send.error", fields: activityContext([
                    "durationMs": durationMs(since: startedAt),
                    "error": message
                ]))
            }
            isSending = false
        }
    }

    func updateQueuedTurn(_ turn: QueuedTurnDraft, prompt: String) {
        guard let backend else {
            return
        }
        Task {
            do {
                let result = try await backend.updateQueuedTurn(
                    conversationId: turn.conversationId,
                    clientMessageId: turn.id,
                    prompt: prompt
                )
                if let index = queuedTurns.firstIndex(where: { $0.id == turn.id }) {
                    queuedTurns[index].prompt = prompt
                    queuedTurns[index].status = result.status
                }
                await refreshStatusOnly()
            } catch {
                errorMessage = readableError(error)
            }
        }
    }

    func deleteQueuedTurn(_ turn: QueuedTurnDraft) {
        guard let backend else {
            return
        }
        Task {
            do {
                let result = try await backend.deleteQueuedTurn(
                    conversationId: turn.conversationId,
                    clientMessageId: turn.id
                )
                if result.removed == true {
                    queuedTurns.removeAll { $0.id == turn.id }
                }
                await refreshStatusOnly()
            } catch {
                errorMessage = readableError(error)
            }
        }
    }

    func createPairing() {
        guard let backend else {
            return
        }
        Task {
            do {
                pairing = try await backend.createPairing()
                selectedPanel = .pairing
            } catch {
                errorMessage = readableError(error)
            }
        }
    }

    func reveal(_ file: GeneratedFile) {
        guard let backend else {
            return
        }
        Task {
            do {
                try await backend.reveal(path: file.path)
            } catch {
                errorMessage = readableError(error)
            }
        }
    }

    func open(_ path: String) {
        guard let backend else {
            return
        }
        Task {
            do {
                try await backend.open(path: path)
            } catch {
                errorMessage = readableError(error)
            }
        }
    }

    func loadDiagnostics() {
        guard let backend else {
            return
        }
        Task {
            let startedAt = Date()
            activityLogger.log("diagnostics.load.start")
            do {
                diagnostics = try await backend.diagnosticsLog()
                activityLogger.log("diagnostics.load.end", fields: [
                    "durationMs": durationMs(since: startedAt),
                    "size": diagnostics?.size ?? 0,
                    "truncated": diagnostics?.truncated ?? false
                ])
            } catch {
                let message = readableError(error)
                errorMessage = message
                activityLogger.log("diagnostics.load.error", fields: [
                    "durationMs": durationMs(since: startedAt),
                    "error": message
                ])
            }
        }
    }

    func loadAppActivityLog() {
        Task {
            let startedAt = Date()
            activityLogger.log("appActivityLog.load.start")
            do {
                appActivityLog = try activityLogger.read()
                activityLogger.log("appActivityLog.load.end", fields: [
                    "durationMs": durationMs(since: startedAt),
                    "size": appActivityLog?.size ?? 0,
                    "truncated": appActivityLog?.truncated ?? false
                ])
            } catch {
                let message = readableError(error)
                errorMessage = message
                activityLogger.log("appActivityLog.load.error", fields: [
                    "durationMs": durationMs(since: startedAt),
                    "error": message
                ])
            }
        }
    }

    func toggleAutomation(_ automation: AutomationSummary) {
        guard let backend else {
            return
        }
        Task {
            do {
                let nextStatus = automation.status == "ACTIVE" ? "PAUSED" : "ACTIVE"
                let saved = try await backend.updateAutomationStatus(id: automation.id, status: nextStatus)
                upsertAutomation(saved)
            } catch {
                errorMessage = readableError(error)
            }
        }
    }

    func createAutomation() {
        guard let backend else {
            return
        }
        let name = automationDraft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let prompt = automationDraft.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let rrule = automationDraft.rrule.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !prompt.isEmpty, !rrule.isEmpty else {
            errorMessage = "Automation name, prompt, and schedule are required."
            return
        }

        isCreatingAutomation = true
        Task {
            do {
                let saved = try await backend.createAutomation(
                    AutomationWriteInput(
                        name: name,
                        prompt: prompt,
                        rrule: rrule,
                        model: automationDraft.model.isEmpty ? selectedModelId : automationDraft.model,
                        reasoningEffort: automationDraft.reasoningEffort,
                        cwds: automationDraft.cwd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? []
                            : [automationDraft.cwd.trimmingCharacters(in: .whitespacesAndNewlines)]
                    )
                )
                automationDraft = AutomationDraft(
                    model: selectedModelId,
                    reasoningEffort: selectedReasoningEffort
                )
                upsertAutomation(saved)
            } catch {
                errorMessage = readableError(error)
            }
            isCreatingAutomation = false
        }
    }

    private func loadConversations(projectId: String, force: Bool = false) async {
        guard let backend else {
            return
        }
        guard force || !loadedConversationProjectIds.contains(projectId) else {
            activityLogger.log("loadConversations.skip", fields: [
                "projectId": projectId,
                "reason": "alreadyLoaded",
                "force": force
            ])
            return
        }
        guard force || !loadingConversationProjectIds.contains(projectId) else {
            activityLogger.log("loadConversations.skip", fields: [
                "projectId": projectId,
                "reason": "alreadyLoading",
                "force": force
            ])
            return
        }
        let startedAt = Date()
        activityLogger.log("loadConversations.start", fields: [
            "projectId": projectId,
            "force": force
        ])
        let requestId = beginConversationLoad(projectId: projectId)
        defer {
            finishConversationLoad(projectId: projectId)
        }

        do {
            let conversations = try await backend.conversations(projectId: projectId)
            guard latestConversationLoadRequestIdByProjectId[projectId] == requestId else {
                activityLogger.log("loadConversations.stale", fields: [
                    "projectId": projectId,
                    "force": force,
                    "durationMs": durationMs(since: startedAt),
                    "conversationCount": conversations.count
                ])
                return
            }
            conversationsByProjectId[projectId] = conversations
            loadedConversationProjectIds.insert(projectId)
            locallyStartedConversationIds.subtract(conversations.map(\.id))

            if selectedProjectId == projectId,
               let selectedConversationId,
               !conversations.contains(where: { $0.id == selectedConversationId }),
               !locallyStartedConversationIds.contains(selectedConversationId) {
                self.selectedConversationId = nil
                clearConversationDetails()
            }
            activityLogger.log("loadConversations.end", fields: [
                "projectId": projectId,
                "force": force,
                "durationMs": durationMs(since: startedAt),
                "conversationCount": conversations.count
            ])
        } catch {
            let message = readableError(error)
            errorMessage = message
            activityLogger.log("loadConversations.error", fields: [
                "projectId": projectId,
                "force": force,
                "durationMs": durationMs(since: startedAt),
                "error": message
            ])
        }
    }

    private func refreshConversationLists(projectIds: [String], force: Bool) async {
        var seen = Set<String>()
        let uniqueProjectIds = projectIds.filter { projectId in
            seen.insert(projectId).inserted
        }

        for projectId in uniqueProjectIds {
            await loadConversations(projectId: projectId, force: force)
        }
    }

    private func statusPollProjectIds() -> [String] {
        ProjectConversationRefreshPolicy.statusPollProjectIds(
            selectedProjectId: selectedProjectId,
            completions: completions
        )
    }

    private func refreshAfterSend(projectId: String?, conversationId: String) async {
        if let projectId {
            await loadConversations(projectId: projectId, force: true)
        }
        await refreshStatusOnly(includeConversationDetails: false)
        Task { [weak self] in
            await self?.loadConversationDetails(conversationId: conversationId)
        }
    }

    private func loadConversationDetails(conversationId: String) async {
        guard let backend else {
            return
        }
        let startedAt = Date()
        var loadedMessageCount = 0
        activityLogger.log("loadConversationDetails.start", fields: activityContext([
            "conversationId": conversationId
        ]))
        do {
            let loadedMessages = try await backend.messages(conversationId: conversationId, forceRefresh: false)
            guard selectedConversationId == conversationId else {
                activityLogger.log("loadConversationDetails.staleMessages", fields: activityContext([
                    "conversationId": conversationId,
                    "durationMs": durationMs(since: startedAt),
                    "messageCount": loadedMessages.count
                ]))
                return
            }
            loadedMessageCount = loadedMessages.count
            messagesConversationId = conversationId
            self.messages = loadedMessages
            reconcileOptimisticMessages()
        } catch {
            let message = readableError(error)
            errorMessage = message
            activityLogger.log("loadConversationDetails.error", fields: activityContext([
                "conversationId": conversationId,
                "durationMs": durationMs(since: startedAt),
                "stage": "messages",
                "error": message
            ]))
            return
        }

        do {
            let loadedFiles = try await backend.generatedFiles(conversationId: conversationId)
            guard selectedConversationId == conversationId else {
                activityLogger.log("loadConversationDetails.staleFiles", fields: activityContext([
                    "conversationId": conversationId,
                    "durationMs": durationMs(since: startedAt),
                    "messageCount": loadedMessageCount,
                    "fileCount": loadedFiles.count
                ]))
                return
            }
            self.generatedFiles = loadedFiles
            activityLogger.log("loadConversationDetails.end", fields: activityContext([
                "conversationId": conversationId,
                "durationMs": durationMs(since: startedAt),
                "messageCount": loadedMessageCount,
                "fileCount": loadedFiles.count
            ]))
        } catch {
            let message = readableError(error)
            errorMessage = message
            activityLogger.log("loadConversationDetails.error", fields: activityContext([
                "conversationId": conversationId,
                "durationMs": durationMs(since: startedAt),
                "stage": "generatedFiles",
                "error": message
            ]))
        }
    }

    private func pruneConversationCache() {
        let validProjectIds = Set(projects.map(\.id))
        conversationsByProjectId = conversationsByProjectId.filter { validProjectIds.contains($0.key) }
        loadedConversationProjectIds = loadedConversationProjectIds.intersection(validProjectIds)
        loadingConversationProjectIds = loadingConversationProjectIds.intersection(validProjectIds)
        conversationLoadCountsByProjectId = conversationLoadCountsByProjectId.filter { validProjectIds.contains($0.key) }
        latestConversationLoadRequestIdByProjectId = latestConversationLoadRequestIdByProjectId.filter {
            validProjectIds.contains($0.key)
        }
    }

    private func beginConversationLoad(projectId: String) -> Int {
        nextConversationLoadRequestId += 1
        let requestId = nextConversationLoadRequestId
        latestConversationLoadRequestIdByProjectId[projectId] = requestId
        conversationLoadCountsByProjectId[projectId, default: 0] += 1
        loadingConversationProjectIds.insert(projectId)
        return requestId
    }

    private func finishConversationLoad(projectId: String) {
        let count = (conversationLoadCountsByProjectId[projectId] ?? 0) - 1
        if count > 0 {
            conversationLoadCountsByProjectId[projectId] = count
        } else {
            conversationLoadCountsByProjectId.removeValue(forKey: projectId)
            loadingConversationProjectIds.remove(projectId)
        }
    }

    private func upsertCachedConversation(_ conversation: DesktopConversation) {
        var conversations = conversationsByProjectId[conversation.projectId] ?? []
        conversations.removeAll { $0.id == conversation.id }
        conversations.insert(conversation, at: 0)
        conversationsByProjectId[conversation.projectId] = conversations
    }

    private func isConversationCached(_ conversation: DesktopConversation) -> Bool {
        conversationsByProjectId[conversation.projectId]?.contains { $0.id == conversation.id } == true
    }

    private func clearConversationDetails() {
        let startedAt = Date()
        let previousMessageCount = messages.count
        let previousVisibleMessageCount = visibleMessages.count
        activityLogger.log("clearConversationDetails.start", fields: activityContext([
            "previousMessageCount": previousMessageCount,
            "previousVisibleMessageCount": previousVisibleMessageCount
        ]))
        messagesConversationId = nil
        messages = []
        optimisticMessages = []
        generatedFiles = []
        refreshVisibleMessages()
        activityLogger.log("clearConversationDetails.end", fields: activityContext([
            "durationMs": durationMs(since: startedAt),
            "previousMessageCount": previousMessageCount,
            "previousVisibleMessageCount": previousVisibleMessageCount,
            "visibleMessagesVersion": visibleMessagesVersion
        ]))
    }

    private func startPolling() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshPollingTick()
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
    }

    private func shouldRefreshSelectedConversationDetailsDuringPolling() -> Bool {
        guard let selectedConversationId else {
            return false
        }
        if let completion = completions.first(where: { $0.conversationId == selectedConversationId }) {
            return !completion.isComplete || isActiveConversationStatus(completion.status)
        }
        return isActiveConversationStatus(selectedConversationStatus)
    }

    private func isActiveConversationStatus(_ status: String) -> Bool {
        ["awaiting_approval", "committing", "preparing", "queued", "running"].contains(status)
    }

    private func activityContext(_ fields: [String: Any] = [:]) -> [String: Any] {
        var context = fields
        if let selectedProjectId {
            context["selectedProjectId"] = selectedProjectId
        }
        if let selectedConversationId {
            context["selectedConversationId"] = selectedConversationId
        }
        context["messageCount"] = messages.count
        context["visibleMessageCount"] = visibleMessages.count
        context["visibleMessagesVersion"] = visibleMessagesVersion
        context["optimisticMessageCount"] = optimisticMessages.count
        context["generatedFileCount"] = generatedFiles.count
        return context
    }

    private func durationMs(since startedAt: Date) -> Int {
        Int(Date().timeIntervalSince(startedAt) * 1_000)
    }

    private func currentModelSettings() -> ModelSettings? {
        guard !selectedModelId.isEmpty, !selectedReasoningEffort.isEmpty else {
            return nil
        }
        return ModelSettings(model: selectedModelId, effort: selectedReasoningEffort)
    }

    private func upsertAutomation(_ automation: AutomationSummary) {
        automations.removeAll { $0.id == automation.id }
        automations.insert(automation, at: 0)
    }

    private func addOptimisticMessage(id: String, conversationId: String, prompt: String) {
        optimisticMessages.removeAll { $0.id == id }
        optimisticMessages.append(
            DesktopMessage(
                id: id,
                conversationId: conversationId,
                role: "user",
                content: prompt,
                sequence: (messages + optimisticMessages).map(\.sequence).max().map { $0 + 1 } ?? 1,
                createdAt: nil
            )
        )
        refreshVisibleMessages()
    }

    private func movePendingOptimisticMessage(id: String, to conversationId: String) {
        guard let index = optimisticMessages.firstIndex(where: { $0.id == id }) else {
            return
        }
        let message = optimisticMessages[index]
        optimisticMessages[index] = DesktopMessage(
            id: message.id,
            conversationId: conversationId,
            role: message.role,
            content: message.content,
            sequence: message.sequence,
            createdAt: message.createdAt
        )
        refreshVisibleMessages()
    }

    private func removeOptimisticMessage(id: String) {
        optimisticMessages.removeAll { $0.id == id }
        refreshVisibleMessages()
    }

    private func reconcileOptimisticMessages() {
        optimisticMessages.removeAll { optimistic in
            messages.contains { synced in
                synced.conversationId == optimistic.conversationId
                    && synced.role == optimistic.role
                    && synced.content == optimistic.content
            }
        }
        refreshVisibleMessages()
    }

    private func refreshVisibleMessages() {
        let nextMessages: [DesktopMessage]
        if let selectedConversationId {
            if messagesConversationId == selectedConversationId {
                nextMessages = messages + optimisticMessages.filter { $0.conversationId == selectedConversationId }
            } else {
                nextMessages = optimisticMessages.filter { $0.conversationId == selectedConversationId }
            }
        } else {
            nextMessages = optimisticMessages.filter { $0.conversationId == "pending" }
        }

        visibleMessages = nextMessages
        visibleMessagesVersion += 1
    }

    private func reconcileSelectedSkills() {
        guard !selectedSkillIds.isEmpty else {
            return
        }

        selectedSkillIds = selectedSkillIds.filter { id in
            guard let suggestion = pluginSuggestions.first(where: { $0.id == id }) else {
                return false
            }
            return prompt.contains("@\(suggestion.displayName)")
        }
    }

    private func clampActivePluginSuggestionIndex() {
        let count = activePluginSuggestions.count
        if count == 0 {
            activePluginSuggestionIndex = 0
        } else if activePluginSuggestionIndex >= count {
            activePluginSuggestionIndex = count - 1
        }
    }

    private func readableError(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}

private extension AppModel.AutomationDraft {
    init(model: String, reasoningEffort: String) {
        self.init()
        self.model = model
        self.reasoningEffort = reasoningEffort
    }
}

private func pluginAutocompleteToken(in prompt: String, selectionLocation: Int) -> AppModel.PluginAutocompleteToken? {
    let nsPrompt = prompt as NSString
    let cursor = max(0, min(selectionLocation, nsPrompt.length))
    guard cursor > 0 else {
        return nil
    }

    var atLocation: Int?
    var index = cursor - 1
    while index >= 0 {
        let character = nsCharacter(nsPrompt, at: index)
        if character == "@" {
            atLocation = index
            break
        }
        if !isPluginTokenCharacter(character) {
            break
        }
        index -= 1
    }

    guard let start = atLocation else {
        return nil
    }

    if start > 0 {
        let previous = nsCharacter(nsPrompt, at: start - 1)
        if isPluginTokenBoundaryBlocker(previous) {
            return nil
        }
    }

    var end = cursor
    while end < nsPrompt.length {
        let character = nsCharacter(nsPrompt, at: end)
        if !isPluginTokenCharacter(character) {
            break
        }
        end += 1
    }

    let queryRange = NSRange(location: start + 1, length: max(0, cursor - start - 1))
    let query = nsPrompt.substring(with: queryRange)
    return AppModel.PluginAutocompleteToken(
        query: query,
        range: NSRange(location: start, length: end - start)
    )
}

private func rankedPluginSuggestions(
    query: String,
    suggestions: [PluginSuggestion]
) -> [PluginSuggestion] {
    let normalizedQuery = query.lowercased()

    return suggestions
        .compactMap { suggestion -> (PluginSuggestion, Int)? in
            let searchable = [
                suggestion.displayName,
                suggestion.invocationName,
                suggestion.pluginName ?? "",
                suggestion.skillName ?? ""
            ].map { $0.lowercased() }

            if normalizedQuery.isEmpty {
                return (suggestion, suggestion.kind == "plugin" ? 0 : 1)
            }
            if searchable.contains(where: { $0.hasPrefix(normalizedQuery) }) {
                return (suggestion, suggestion.kind == "plugin" ? 0 : 1)
            }
            if searchable.contains(where: { $0.contains(normalizedQuery) }) {
                return (suggestion, 2)
            }
            if suggestion.keywords.contains(where: { $0.lowercased().contains(normalizedQuery) })
                || suggestion.description.lowercased().contains(normalizedQuery) {
                return (suggestion, 3)
            }
            return nil
        }
        .sorted { left, right in
            if left.1 != right.1 {
                return left.1 < right.1
            }
            return left.0.displayName < right.0.displayName
        }
        .prefix(6)
        .map(\.0)
}

private func isPluginTokenCharacter(_ character: Character) -> Bool {
    character.isLetter || character.isNumber || character == "_" || character == "." || character == "-"
}

private func isPluginTokenBoundaryBlocker(_ character: Character) -> Bool {
    isPluginTokenCharacter(character) || character == "/" || character == "@"
}

private func nsCharacter(_ string: NSString, at index: Int) -> Character {
    guard let scalar = UnicodeScalar(string.character(at: index)) else {
        return " "
    }
    return Character(scalar)
}
