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
    @Published private(set) var conversations: [DesktopConversation] = []
    @Published private(set) var messages: [DesktopMessage] = []
    @Published private(set) var completions: [CompletionState] = []
    @Published private(set) var models: [ModelOption] = []
    @Published private(set) var generatedFiles: [GeneratedFile] = []
    @Published private(set) var tokenUsage: TokenUsageSummary?
    @Published private(set) var automations: [AutomationSummary] = []
    @Published private(set) var pluginSuggestions: [PluginSuggestion] = []
    @Published private(set) var diagnostics: DiagnosticsLog?
    @Published private(set) var pairing: PairingPayload?
    @Published private(set) var queuedTurns: [QueuedTurnDraft] = []
    @Published private var optimisticMessages: [DesktopMessage] = []

    @Published var selectedProjectId: String?
    @Published var selectedConversationId: String?
    @Published var selectedPanel: Panel = .chat
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
    private var backend: BackendClient?
    private var refreshTask: Task<Void, Never>?
    private var didStart = false
    private var dismissedPluginTokenRange: NSRange?

    var selectedProject: DesktopProject? {
        projects.first(where: { $0.id == selectedProjectId })
    }

    var selectedConversation: DesktopConversation? {
        conversations.first(where: { $0.id == selectedConversationId })
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

    var visibleMessages: [DesktopMessage] {
        guard let selectedConversationId else {
            return messages + optimisticMessages.filter { $0.conversationId == "pending" }
        }
        return messages + optimisticMessages.filter { $0.conversationId == selectedConversationId }
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

    func start() {
        guard !didStart else {
            return
        }
        didStart = true
        phase = .starting

        Task {
            do {
                let ready = try await backendProcess.start()
                self.ready = ready
                self.backend = BackendClient(endpoint: ready.desktopEndpoint)
                self.phase = .online
                await refreshAll()
                startPolling()
            } catch {
                phase = .failed(readableError(error))
            }
        }
    }

    func stop() {
        refreshTask?.cancel()
        backendProcess.stop()
    }

    func refreshAll() async {
        guard let backend else {
            return
        }

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

            if selectedProjectId == nil || !self.projects.contains(where: { $0.id == selectedProjectId }) {
                selectedProjectId = self.projects.first?.id
            }
            if let selectedProjectId {
                await loadConversations(projectId: selectedProjectId)
            }
            if let selectedConversationId {
                await loadConversationDetails(conversationId: selectedConversationId)
            }
            reconcileOptimisticMessages()
            errorMessage = nil
        } catch {
            errorMessage = readableError(error)
        }
    }

    func refreshStatusOnly() async {
        guard let backend else {
            return
        }

        do {
            async let status = backend.status()
            async let completions = backend.completions()
            self.status = try await status
            self.completions = try await completions

            if let selectedProjectId {
                conversations = try await backend.conversations(projectId: selectedProjectId)
            }
            if let selectedConversationId {
                messages = try await backend.messages(conversationId: selectedConversationId)
                generatedFiles = try await backend.generatedFiles(conversationId: selectedConversationId)
                reconcileOptimisticMessages()
            }
        } catch {
            errorMessage = readableError(error)
        }
    }

    func selectProject(_ project: DesktopProject) {
        guard selectedProjectId != project.id else {
            return
        }
        selectedProjectId = project.id
        selectedConversationId = nil
        messages = []
        optimisticMessages = []
        generatedFiles = []
        Task {
            await loadConversations(projectId: project.id)
        }
    }

    func selectConversation(_ conversation: DesktopConversation) {
        guard selectedConversationId != conversation.id else {
            return
        }
        selectedConversationId = conversation.id
        selectedPanel = .chat
        optimisticMessages.removeAll { $0.conversationId == "pending" || $0.conversationId != conversation.id }
        Task {
            await loadConversationDetails(conversationId: conversation.id)
        }
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
        addOptimisticMessage(id: clientMessageId, conversationId: optimisticConversationId, prompt: trimmed)
        prompt = ""
        selectedSkillIds = []

        Task {
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
                    movePendingOptimisticMessage(id: clientMessageId, to: result.conversationId)
                } else {
                    throw BackendClientError.requestFailed("Select a project before sending.")
                }

                await refreshAll()
                if selectedConversationId == nil {
                    selectedConversationId = result.conversationId
                }
            } catch {
                removeOptimisticMessage(id: clientMessageId)
                prompt = trimmed
                selectedSkillIds = skillIds
                errorMessage = readableError(error)
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
            do {
                diagnostics = try await backend.diagnosticsLog()
            } catch {
                errorMessage = readableError(error)
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

    private func loadConversations(projectId: String) async {
        guard let backend else {
            return
        }
        do {
            conversations = try await backend.conversations(projectId: projectId)
            if selectedConversationId == nil || !conversations.contains(where: { $0.id == selectedConversationId }) {
                selectedConversationId = conversations.first?.id
            }
            if let selectedConversationId {
                await loadConversationDetails(conversationId: selectedConversationId)
            }
        } catch {
            errorMessage = readableError(error)
        }
    }

    private func loadConversationDetails(conversationId: String) async {
        guard let backend else {
            return
        }
        do {
            async let messages = backend.messages(conversationId: conversationId)
            async let files = backend.generatedFiles(conversationId: conversationId)
            self.messages = try await messages
            self.generatedFiles = try await files
            reconcileOptimisticMessages()
        } catch {
            errorMessage = readableError(error)
        }
    }

    private func startPolling() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshStatusOnly()
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
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
    }

    private func removeOptimisticMessage(id: String) {
        optimisticMessages.removeAll { $0.id == id }
    }

    private func reconcileOptimisticMessages() {
        optimisticMessages.removeAll { optimistic in
            messages.contains { synced in
                synced.conversationId == optimistic.conversationId
                    && synced.role == optimistic.role
                    && synced.content == optimistic.content
            }
        }
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
