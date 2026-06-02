import AbitatMacCore
import Foundation

final class AppActivityLogger: @unchecked Sendable {
    static let shared = AppActivityLogger()

    let fileURL: URL

    private let maxStringLength: Int
    private let maxFileBytes: Int
    private let queue = DispatchQueue(label: "ai.alook.abitat.mac.activity-log")

    init(
        fileURL: URL = AppActivityLogger.defaultFileURL(),
        maxStringLength: Int = 512,
        maxFileBytes: Int = 5_000_000
    ) {
        self.fileURL = fileURL
        self.maxStringLength = maxStringLength
        self.maxFileBytes = maxFileBytes
        ensureLogDirectoryExists()
    }

    func log(_ event: String, fields: [String: Any] = [:]) {
        let entry = ActivityLogEntry(
            timestamp: Self.timestamp(),
            event: event,
            fields: sanitize(fields)
        )

        do {
            let encoder = JSONEncoder.abitat
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            let data = try encoder.encode(entry) + Data([0x0A])
            queue.async { [fileURL, maxFileBytes] in
                do {
                    try Self.append(data: data, to: fileURL)
                    try Self.enforceRetention(maxFileBytes: maxFileBytes, fileURL: fileURL)
                } catch {
                    // Activity logging must never affect the app's normal control flow.
                }
            }
        } catch {
            // Activity logging must never affect the app's normal control flow.
        }
    }

    func flush() {
        queue.sync {}
    }

    func read(limitBytes: Int = 512_000) throws -> DiagnosticsLog {
        flush()
        ensureLogDirectoryExists()
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return DiagnosticsLog(data: "", logPath: fileURL.path, size: 0, truncated: false)
        }

        let handle = try FileHandle(forReadingFrom: fileURL)
        defer {
            try? handle.close()
        }

        let size = Int((try? handle.seekToEnd()) ?? 0)
        let boundedLimit = max(0, limitBytes)
        let offset = max(0, size - boundedLimit)
        try handle.seek(toOffset: UInt64(offset))
        let data = try handle.readToEnd() ?? Data()
        return DiagnosticsLog(
            data: String(data: data, encoding: .utf8) ?? "",
            logPath: fileURL.path,
            size: size,
            truncated: offset > 0
        )
    }

    private func sanitize(_ fields: [String: Any]) -> [String: ActivityLogValue] {
        var sanitized: [String: ActivityLogValue] = [:]
        for key in fields.keys.sorted() {
            guard let value = fields[key] else {
                continue
            }
            sanitized[key] = sanitize(value, key: key)
        }
        return sanitized
    }

    private func sanitize(_ value: Any, key: String) -> ActivityLogValue {
        if isSensitiveKey(key) {
            return .string("[redacted]")
        }

        switch value {
        case let value as String:
            return .string(bound(value))
        case let value as Bool:
            return .bool(value)
        case let value as Int:
            return .int(value)
        case let value as Int64:
            return .int(Int(value))
        case let value as UInt:
            return .int(Int(value))
        case let value as UInt64:
            return .int(Int(value))
        case let value as Double:
            return .double(value)
        case let value as Float:
            return .double(Double(value))
        case let value as Date:
            return .string(Self.timestamp(for: value))
        case let value as URL:
            return .string(bound(value.path))
        case let value as [String]:
            return .array(value.map { .string(bound($0)) })
        case let value as [Int]:
            return .array(value.map(ActivityLogValue.int))
        case let value as [String: Any]:
            return .object(sanitize(value))
        default:
            return .string(bound(String(describing: value)))
        }
    }

    private func bound(_ value: String) -> String {
        guard value.count > maxStringLength else {
            return value
        }
        let prefixCount = max(0, maxStringLength - 1)
        return "\(value.prefix(prefixCount))…"
    }

    private func isSensitiveKey(_ key: String) -> Bool {
        let normalized = key
            .filter { $0.isLetter || $0.isNumber }
            .lowercased()
        let exactSensitiveKeys: Set<String> = [
            "apikey",
            "body",
            "content",
            "error",
            "errormessage",
            "filecontent",
            "filecontents",
            "key",
            "message",
            "password",
            "prompt",
            "raw",
            "secret",
            "text",
            "token"
        ]
        if exactSensitiveKeys.contains(normalized) {
            return true
        }
        return normalized.hasSuffix("apikey")
            || normalized.hasSuffix("password")
            || normalized.hasSuffix("secret")
            || normalized.hasSuffix("token")
    }

    private func ensureLogDirectoryExists() {
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
    }

    private static func append(data: Data, to fileURL: URL) throws {
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: fileURL)
        defer {
            try? handle.close()
        }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    }

    private static func enforceRetention(maxFileBytes: Int, fileURL: URL) throws {
        guard maxFileBytes > 0 else {
            try Data().write(to: fileURL, options: .atomic)
            return
        }

        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        guard let size = attributes[.size] as? Int, size > maxFileBytes else {
            return
        }

        let handle = try FileHandle(forReadingFrom: fileURL)
        defer {
            try? handle.close()
        }

        let offset = max(0, size - maxFileBytes)
        try handle.seek(toOffset: UInt64(offset))
        var data = try handle.readToEnd() ?? Data()
        if offset > 0, let newlineIndex = data.firstIndex(of: 0x0A) {
            let nextIndex = data.index(after: newlineIndex)
            data = Data(data[nextIndex...])
        }
        if data.count > maxFileBytes {
            data = Data(data.suffix(maxFileBytes))
        }
        try data.write(to: fileURL, options: .atomic)
    }

    private static func defaultFileURL() -> URL {
        let logsDirectory = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)
            .first?
            .appendingPathComponent("Logs", isDirectory: true)
            .appendingPathComponent("Abitat", isDirectory: true)
        return (logsDirectory ?? FileManager.default.temporaryDirectory)
            .appendingPathComponent("activity.jsonl")
    }

    private static func timestamp(for date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}

private struct ActivityLogEntry: Encodable, Sendable {
    let timestamp: String
    let event: String
    let fields: [String: ActivityLogValue]
}

private enum ActivityLogValue: Encodable, Sendable {
    case array([ActivityLogValue])
    case bool(Bool)
    case double(Double)
    case int(Int)
    case object([String: ActivityLogValue])
    case string(String)

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .array(value):
            try container.encode(value)
        case let .bool(value):
            try container.encode(value)
        case let .double(value):
            try container.encode(value)
        case let .int(value):
            try container.encode(value)
        case let .object(value):
            try container.encode(value)
        case let .string(value):
            try container.encode(value)
        }
    }
}
