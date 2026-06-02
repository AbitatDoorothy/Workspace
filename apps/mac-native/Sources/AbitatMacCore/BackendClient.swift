import Foundation

public struct ConversationInput: Encodable, Sendable {
    public let prompt: String
    public let modelSettings: ModelSettings?
    public let skills: [SkillSelection]

    public init(prompt: String, modelSettings: ModelSettings?, skills: [SkillSelection] = []) {
        self.prompt = prompt
        self.modelSettings = modelSettings
        self.skills = skills
    }
}

public struct ContinueInput: Encodable, Sendable {
    public let clientMessageId: String
    public let delivery: String
    public let modelSettings: ModelSettings?
    public let prompt: String
    public let skills: [SkillSelection]

    public init(
        prompt: String,
        delivery: String,
        modelSettings: ModelSettings?,
        skills: [SkillSelection] = [],
        clientMessageId: String = "swift-\(Int(Date().timeIntervalSince1970 * 1000))"
    ) {
        self.clientMessageId = clientMessageId
        self.delivery = delivery
        self.modelSettings = modelSettings
        self.prompt = prompt
        self.skills = skills
    }
}

public struct ModelSettings: Encodable, Equatable, Sendable {
    public let effort: String
    public let model: String

    public init(model: String, effort: String) {
        self.model = model
        self.effort = effort
    }
}

public struct ConversationStartResult: Decodable, Equatable, Sendable {
    public let conversationId: String
    public let status: String
}

public struct DiagnosticsLog: Decodable, Equatable, Sendable {
    public let data: String
    public let logPath: String
    public let size: Int
    public let truncated: Bool

    public init(data: String, logPath: String, size: Int, truncated: Bool) {
        self.data = data
        self.logPath = logPath
        self.size = size
        self.truncated = truncated
    }
}

public final class BackendClient: Sendable {
    private let endpoint: URL
    private let session: URLSession

    public static func defaultSessionConfiguration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 15
        configuration.waitsForConnectivity = false
        return configuration
    }

    public init(endpoint: URL, session: URLSession? = nil) {
        self.endpoint = endpoint
        self.session = session ?? URLSession(configuration: Self.defaultSessionConfiguration())
    }

    public func status() async throws -> DesktopStatus {
        try await get("/api/desktop/status")
    }

    public func createPairing() async throws -> PairingPayload {
        try await post("/api/desktop/pairing", body: EmptyBody())
    }

    public func projects() async throws -> [DesktopProject] {
        try await get("/api/desktop/projects", as: ProjectsResponse.self).projects
    }

    public func conversations(projectId: String) async throws -> [DesktopConversation] {
        try await get(
            "/api/desktop/projects/\(projectId.urlPathEscaped)/conversations",
            as: ConversationsResponse.self
        ).conversations
    }

    public func messages(conversationId: String, forceRefresh: Bool = false) async throws -> [DesktopMessage] {
        let forceRefreshQuery = forceRefresh ? "forceRefresh=1&" : ""
        return try await get(
            "/api/desktop/conversations/\(conversationId.urlPathEscaped)/messages?\(forceRefreshQuery)includeRuntime=0",
            as: MessagesResponse.self
        ).messages
    }

    public func startConversation(
        projectId: String,
        prompt: String,
        modelSettings: ModelSettings?,
        selectedSkillIds: [String] = []
    ) async throws -> ConversationStartResult {
        try await post(
            "/api/desktop/projects/\(projectId.urlPathEscaped)/conversations",
            body: ConversationInput(
                prompt: prompt,
                modelSettings: modelSettings,
                skills: selectedSkillIds.map(SkillSelection.init)
            )
        )
    }

    public func continueConversation(
        conversationId: String,
        prompt: String,
        delivery: String,
        modelSettings: ModelSettings?,
        selectedSkillIds: [String] = [],
        clientMessageId: String = "swift-\(Int(Date().timeIntervalSince1970 * 1000))"
    ) async throws -> ConversationStartResult {
        try await post(
            "/api/desktop/conversations/\(conversationId.urlPathEscaped)/continue",
            body: ContinueInput(
                prompt: prompt,
                delivery: delivery,
                modelSettings: modelSettings,
                skills: selectedSkillIds.map(SkillSelection.init),
                clientMessageId: clientMessageId
            )
        )
    }

    public func deleteQueuedTurn(
        conversationId: String,
        clientMessageId: String
    ) async throws -> QueuedTurnResult {
        try await request(
            "/api/desktop/conversations/\(conversationId.urlPathEscaped)/queue/\(clientMessageId.urlPathEscaped)",
            method: "DELETE"
        )
    }

    public func updateQueuedTurn(
        conversationId: String,
        clientMessageId: String,
        prompt: String
    ) async throws -> QueuedTurnResult {
        try await patch(
            "/api/desktop/conversations/\(conversationId.urlPathEscaped)/queue/\(clientMessageId.urlPathEscaped)",
            body: PromptBody(prompt: prompt)
        )
    }

    public func completions() async throws -> [CompletionState] {
        try await get("/api/desktop/codex/completions", as: CompletionsResponse.self).completions
    }

    public func models() async throws -> [ModelOption] {
        try await get("/api/desktop/codex/models", as: ModelsResponse.self).models
    }

    public func pluginSuggestions() async throws -> [PluginSuggestion] {
        try await get("/api/desktop/codex/plugin-suggestions", as: PluginSuggestionsResponse.self).suggestions
    }

    public func tokenUsage() async throws -> TokenUsageSummary {
        try await get("/api/desktop/codex/token-usage")
    }

    public func generatedFiles(conversationId: String) async throws -> [GeneratedFile] {
        try await get(
            "/api/desktop/conversations/\(conversationId.urlPathEscaped)/files",
            as: FilesResponse.self
        ).files
    }

    public func automations() async throws -> [AutomationSummary] {
        try await get("/api/desktop/codex/automations", as: AutomationsResponse.self).automations
    }

    public func createAutomation(_ input: AutomationWriteInput) async throws -> AutomationSummary {
        try await post(
            "/api/desktop/codex/automations",
            body: input,
            as: AutomationResponse.self
        ).automation
    }

    public func updateAutomationStatus(id: String, status: String) async throws -> AutomationSummary {
        try await patch(
            "/api/desktop/codex/automations/\(id.urlPathEscaped)",
            body: AutomationStatusBody(status: status),
            as: AutomationResponse.self
        ).automation
    }

    public func diagnosticsLog() async throws -> DiagnosticsLog {
        try await get("/api/desktop/diagnostics/log")
    }

    public func reveal(path: String) async throws {
        let _: OkResponse = try await post("/api/desktop/reveal-path", body: PathBody(path: path))
    }

    public func open(path: String) async throws {
        let _: OkResponse = try await post("/api/desktop/open-path", body: PathBody(path: path))
    }

    private func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        let (data, response) = try await session.data(from: endpoint.appendingPath(path))
        try validate(response: response, data: data)
        return try JSONDecoder.abitat.decode(T.self, from: data)
    }

    private func post<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        try await post(path, body: body, as: T.self)
    }

    private func post<T: Decodable, Body: Encodable>(
        _ path: String,
        body: Body,
        as type: T.Type
    ) async throws -> T {
        var request = URLRequest(url: endpoint.appendingPath(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder.abitat.encode(body)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder.abitat.decode(T.self, from: data)
    }

    private func patch<T: Decodable, Body: Encodable>(_ path: String, body: Body) async throws -> T {
        try await patch(path, body: body, as: T.self)
    }

    private func patch<T: Decodable, Body: Encodable>(
        _ path: String,
        body: Body,
        as type: T.Type
    ) async throws -> T {
        var request = URLRequest(url: endpoint.appendingPath(path))
        request.httpMethod = "PATCH"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder.abitat.encode(body)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder.abitat.decode(T.self, from: data)
    }

    private func request<T: Decodable>(_ path: String, method: String) async throws -> T {
        var request = URLRequest(url: endpoint.appendingPath(path))
        request.httpMethod = method
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder.abitat.decode(T.self, from: data)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Backend request failed"
            throw BackendClientError.requestFailed(message)
        }
    }
}

public enum BackendClientError: Error, LocalizedError {
    case requestFailed(String)

    public var errorDescription: String? {
        switch self {
        case let .requestFailed(message):
            return message
        }
    }
}

private struct EmptyBody: Encodable {}
private struct OkResponse: Decodable { let ok: Bool }
private struct PathBody: Encodable { let path: String }
private struct PromptBody: Encodable { let prompt: String }
private struct AutomationStatusBody: Encodable { let status: String }

private extension String {
    var urlPathEscaped: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? self
    }
}

private extension URL {
    func appendingPath(_ path: String) -> URL {
        URL(string: path, relativeTo: self)!.absoluteURL
    }
}
