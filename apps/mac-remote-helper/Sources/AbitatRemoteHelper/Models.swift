import Foundation

struct HelperConfig {
    let apiUrl: URL
    let clientMachineId: String
    let hostToken: String
    let inputEnabled: Bool
    let screenEnabled: Bool
    let sessionId: String

    static func load(arguments: [String], environment: [String: String]) throws -> HelperConfig {
        let sessionId = option("--session-id", arguments: arguments)
            ?? environment["ABITAT_REMOTE_CONTROL_SESSION_ID"]
            ?? ""
        let apiUrlValue = option("--api-url", arguments: arguments)
            ?? environment["ABITAT_API_URL"]
            ?? "https://workspace.abitat.io"
        let hostToken = environment["ABITAT_HOST_TOKEN"] ?? ""
        let clientMachineId = environment["ABITAT_REMOTE_CONTROL_CLIENT_MACHINE_ID"] ?? ""

        guard !sessionId.isEmpty else {
            throw HelperError.configuration("Missing --session-id")
        }
        guard !hostToken.isEmpty else {
            throw HelperError.configuration("Missing ABITAT_HOST_TOKEN")
        }
        guard !clientMachineId.isEmpty else {
            throw HelperError.configuration("Missing ABITAT_REMOTE_CONTROL_CLIENT_MACHINE_ID")
        }
        guard let apiUrl = URL(string: apiUrlValue) else {
            throw HelperError.configuration("Invalid API URL")
        }

        return HelperConfig(
            apiUrl: apiUrl,
            clientMachineId: clientMachineId,
            hostToken: hostToken,
            inputEnabled: environment["ABITAT_REMOTE_CONTROL_INPUT"] != "0",
            screenEnabled: environment["ABITAT_REMOTE_CONTROL_SCREEN"] != "0",
            sessionId: sessionId
        )
    }

    private static func option(_ name: String, arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
            return nil
        }

        return arguments[index + 1]
    }
}

enum HelperError: Error, CustomStringConvertible {
    case configuration(String)
    case request(String)

    var description: String {
        switch self {
        case .configuration(let message), .request(let message):
            return message
        }
    }
}

struct RemoteSession: Decodable {
    let id: String
    let status: String
    let hostMachineId: String
    let clientMachineId: String
}

struct RemoteSignal: Decodable {
    let id: String
    let type: String
    let payload: [String: JSONValue]
}

enum JSONValue: Decodable {
    case array([JSONValue])
    case bool(Bool)
    case double(Double)
    case object([String: JSONValue])
    case string(String)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            self = .array(try container.decode([JSONValue].self))
        }
    }

    var objectValue: [String: JSONValue]? {
        if case .object(let value) = self {
            return value
        }

        return nil
    }

    var stringValue: String? {
        if case .string(let value) = self {
            return value
        }

        return nil
    }

    var doubleValue: Double? {
        if case .double(let value) = self {
            return value
        }

        return nil
    }
}
