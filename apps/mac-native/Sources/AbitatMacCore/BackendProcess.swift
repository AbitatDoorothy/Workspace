import Foundation

public final class BackendProcess: @unchecked Sendable {
    private var process: Process?
    private var stdoutPipe: Pipe?
    private let fileManager: FileManager

    public init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    deinit {
        stop()
    }

    public func start() async throws -> HelperReadyMessage {
        if let existing = ProcessInfo.processInfo.environment["ABITAT_DESKTOP_BACKEND_URL"],
           let url = URL(string: existing) {
            return HelperReadyMessage(
                type: "ready",
                desktopEndpoint: url,
                localEndpoint: url,
                publicEndpoint: url,
                relayEndpoint: url,
                relayId: nil
            )
        }

        let helperPath = try resolveHelperPath()
        let nodeBinaryPath = ProcessInfo.processInfo.environment["ABITAT_NODE_BINARY_PATH"] ?? "node"
        let process = Process()
        let stdoutPipe = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = [nodeBinaryPath, helperPath, "desktop"]
        process.standardOutput = stdoutPipe
        process.standardError = FileHandle.standardError
        self.process = process
        self.stdoutPipe = stdoutPipe

        try process.run()
        return try await readReadyLine(from: stdoutPipe.fileHandleForReading)
    }

    public func stop() {
        guard let process, process.isRunning else {
            return
        }
        process.terminate()
        self.process = nil
    }

    public func readReadyLine(from handle: FileHandle) async throws -> HelperReadyMessage {
        var buffer = Data()
        let deadline = Date().addingTimeInterval(20)

        while Date() < deadline {
            if let chunk = try handle.read(upToCount: 1), !chunk.isEmpty {
                if chunk == Data([0x0A]) {
                    if let ready = try? JSONDecoder.abitat.decode(HelperReadyMessage.self, from: buffer),
                       ready.type == "ready" {
                        return ready
                    }
                    buffer.removeAll(keepingCapacity: true)
                } else {
                    buffer.append(chunk)
                }
            } else {
                try await Task.sleep(nanoseconds: 50_000_000)
            }
        }

        throw BackendProcessError.readyTimeout
    }

    private func resolveHelperPath() throws -> String {
        if let path = ProcessInfo.processInfo.environment["ABITAT_DESKTOP_HELPER_PATH"],
           fileManager.fileExists(atPath: path) {
            return path
        }

        let current = URL(fileURLWithPath: fileManager.currentDirectoryPath)
        let candidates = [
            current.appendingPathComponent("apps/host-daemon/dist/cli/index.js").path,
            current.deletingLastPathComponent()
                .appendingPathComponent("apps/host-daemon/dist/cli/index.js").path
        ]

        for candidate in candidates where fileManager.fileExists(atPath: candidate) {
            return candidate
        }

        throw BackendProcessError.helperNotFound
    }
}

public enum BackendProcessError: Error, LocalizedError {
    case helperNotFound
    case readyTimeout

    public var errorDescription: String? {
        switch self {
        case .helperNotFound:
            return "Abitat desktop helper was not found. Run pnpm --filter @abitat_reece/host-daemon build."
        case .readyTimeout:
            return "Abitat desktop helper did not become ready in time."
        }
    }
}
