import Foundation

public extension JSONDecoder {
    static var abitat: JSONDecoder {
        let decoder = JSONDecoder()
        return decoder
    }
}

public extension JSONEncoder {
    static var abitat: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }
}

public struct HelperReadyMessage: Decodable, Equatable, Sendable {
    public let type: String
    public let desktopEndpoint: URL
    public let localEndpoint: URL
    public let publicEndpoint: URL
    public let relayEndpoint: URL
    public let relayId: String?

    public init(
        type: String,
        desktopEndpoint: URL,
        localEndpoint: URL,
        publicEndpoint: URL,
        relayEndpoint: URL,
        relayId: String?
    ) {
        self.type = type
        self.desktopEndpoint = desktopEndpoint
        self.localEndpoint = localEndpoint
        self.publicEndpoint = publicEndpoint
        self.relayEndpoint = relayEndpoint
        self.relayId = relayId
    }
}

public struct DesktopStatus: Decodable, Equatable, Sendable {
    public struct Codex: Decodable, Equatable, Sendable {
        public let available: Bool
        public let error: String?
    }

    public let codex: Codex
    public let diagnosticsLogPath: String
    public let endpoint: String
    public let localEndpoint: String
    public let macId: String
    public let macName: String
    public let relayConnected: Bool
    public let relayEndpoint: String
    public let relayId: String?
    public let serverStartedAt: String
    public let transport: String
}

public struct DesktopProject: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let conversationCount: Int?
    public let hostLocalPath: String?
    public let updatedAt: String?
}

public struct ProjectsResponse: Decodable, Equatable, Sendable {
    public let projects: [DesktopProject]
}

public struct DesktopConversation: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let projectId: String
    public let prompt: String
    public let status: String
    public let updatedAt: String?
}

public struct ConversationsResponse: Decodable, Equatable, Sendable {
    public let conversations: [DesktopConversation]
}

public struct DesktopMessage: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let conversationId: String
    public let role: String
    public let content: String
    public let sequence: Int
    public let createdAt: String?

    public init(id: String, conversationId: String, role: String, content: String, sequence: Int, createdAt: String?) {
        self.id = id
        self.conversationId = conversationId
        self.role = role
        self.content = content
        self.sequence = sequence
        self.createdAt = createdAt
    }
}

public struct MessagesResponse: Decodable, Equatable, Sendable {
    public let messages: [DesktopMessage]
}

public struct CompletionState: Decodable, Identifiable, Equatable, Sendable {
    public var id: String { conversationId }

    public let conversationId: String
    public let projectId: String
    public let prompt: String
    public let status: String
    public let isComplete: Bool
    public let failed: Bool
    public let updatedAt: String?
}

public struct CompletionsResponse: Decodable, Equatable, Sendable {
    public let completions: [CompletionState]
}

public struct ModelOption: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let displayName: String
    public let defaultReasoningEffort: String?
    public let supportedReasoningEfforts: [String]
}

public struct ModelsResponse: Decodable, Equatable, Sendable {
    public let models: [ModelOption]
}

public struct PluginSuggestion: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let displayName: String
    public let invocationName: String
    public let kind: String
    public let pluginName: String?
    public let skillName: String?
    public let description: String
    public let source: String
    public let keywords: [String]
}

public struct PluginSuggestionsResponse: Decodable, Equatable, Sendable {
    public let suggestions: [PluginSuggestion]
}

public struct SkillSelection: Encodable, Equatable, Sendable {
    public let id: String

    public init(id: String) {
        self.id = id
    }
}

public struct GeneratedFile: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public let size: Int
    public let mimeType: String?
}

public struct FilesResponse: Decodable, Equatable, Sendable {
    public let files: [GeneratedFile]
}

public struct TokenBucket: Decodable, Equatable, Sendable {
    public let cachedInputTokens: Int
    public let inputTokens: Int
    public let outputTokens: Int
    public let totalTokens: Int
}

public struct TokenUsageSummary: Decodable, Equatable, Sendable {
    public struct Timeframes: Decodable, Equatable, Sendable {
        public let oneDay: TokenBucket
        public let sevenDays: TokenBucket
        public let all: TokenBucket

        enum CodingKeys: String, CodingKey {
            case oneDay = "1d"
            case sevenDays = "7d"
            case all
        }
    }

    public let generatedAt: String
    public let timeframes: Timeframes
}

public struct PairingPayload: Decodable, Equatable, Sendable {
    public let expiresAt: String
    public let manualCode: String
    public let payloadJson: String
    public let relayId: String?
}

public struct QueuedTurnResult: Decodable, Equatable, Sendable {
    public let conversationId: String
    public let removed: Bool?
    public let status: String
    public let updated: Bool?
}

public struct AutomationSummary: Decodable, Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: String
    public let name: String
    public let prompt: String
    public let status: String
    public let rrule: String
    public let model: String
    public let reasoningEffort: String
    public let executionEnvironment: String
    public let cwds: [String]
    public let createdAt: Int?
    public let updatedAt: Int?
}

public struct AutomationsResponse: Decodable, Equatable, Sendable {
    public let automations: [AutomationSummary]
}

public struct AutomationResponse: Decodable, Equatable, Sendable {
    public let automation: AutomationSummary
}

public struct AutomationWriteInput: Encodable, Equatable, Sendable {
    public let kind: String
    public let name: String
    public let prompt: String
    public let status: String
    public let rrule: String
    public let model: String
    public let reasoningEffort: String
    public let executionEnvironment: String
    public let cwds: [String]

    public init(
        kind: String = "cron",
        name: String,
        prompt: String,
        status: String = "ACTIVE",
        rrule: String,
        model: String,
        reasoningEffort: String,
        executionEnvironment: String = "local",
        cwds: [String] = []
    ) {
        self.kind = kind
        self.name = name
        self.prompt = prompt
        self.status = status
        self.rrule = rrule
        self.model = model
        self.reasoningEffort = reasoningEffort
        self.executionEnvironment = executionEnvironment
        self.cwds = cwds
    }
}

public enum TokenFormatter {
    public static func compact(_ value: Int) -> String {
        if value < 1_000 {
            return "\(max(0, value))"
        }
        if value < 1_000_000 {
            return String(format: "%.1fK", Double(value) / 1_000).replacingOccurrences(of: ".0", with: "")
        }
        return String(format: "%.1fM", Double(value) / 1_000_000).replacingOccurrences(of: ".0", with: "")
    }
}
