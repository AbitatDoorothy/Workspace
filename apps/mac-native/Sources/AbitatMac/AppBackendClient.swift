import AbitatMacCore
import Foundation

protocol AppBackendClient: AnyObject, Sendable {
    func status() async throws -> DesktopStatus
    func createPairing() async throws -> PairingPayload
    func projects() async throws -> [DesktopProject]
    func conversations(projectId: String) async throws -> [DesktopConversation]
    func messages(conversationId: String, forceRefresh: Bool) async throws -> [DesktopMessage]
    func startConversation(
        projectId: String,
        prompt: String,
        modelSettings: ModelSettings?,
        selectedSkillIds: [String]
    ) async throws -> ConversationStartResult
    func continueConversation(
        conversationId: String,
        prompt: String,
        delivery: String,
        modelSettings: ModelSettings?,
        selectedSkillIds: [String],
        clientMessageId: String
    ) async throws -> ConversationStartResult
    func deleteQueuedTurn(conversationId: String, clientMessageId: String) async throws -> QueuedTurnResult
    func updateQueuedTurn(conversationId: String, clientMessageId: String, prompt: String) async throws -> QueuedTurnResult
    func completions() async throws -> [CompletionState]
    func models() async throws -> [ModelOption]
    func pluginSuggestions() async throws -> [PluginSuggestion]
    func tokenUsage() async throws -> TokenUsageSummary
    func generatedFiles(conversationId: String) async throws -> [GeneratedFile]
    func automations() async throws -> [AutomationSummary]
    func createAutomation(_ input: AutomationWriteInput) async throws -> AutomationSummary
    func updateAutomationStatus(id: String, status: String) async throws -> AutomationSummary
    func diagnosticsLog() async throws -> DiagnosticsLog
    func reveal(path: String) async throws
    func open(path: String) async throws
}

extension BackendClient: AppBackendClient {}
