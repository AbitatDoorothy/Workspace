import Foundation

final class SignalingClient {
    private let apiUrl: URL
    private let hostToken: String
    private let sessionId: String
    private let urlSession: URLSession

    init(config: HelperConfig, urlSession: URLSession = .shared) {
        self.apiUrl = config.apiUrl
        self.hostToken = config.hostToken
        self.sessionId = config.sessionId
        self.urlSession = urlSession
    }

    func updateStatus(_ status: String, errorMessage: String? = nil) async throws {
        var body: [String: Any] = ["status": status]
        if let errorMessage {
            body["errorMessage"] = errorMessage
        }

        _ = try await request(
            path: "/api/remote-control/host/sessions/\(sessionId)",
            method: "PATCH",
            body: body
        )
    }

    func pollSignals() async throws -> [RemoteSignal] {
        let data = try await request(
            path: "/api/remote-control/host/sessions/\(sessionId)/signals",
            method: "GET"
        )
        let decoded = try JSONDecoder().decode([String: [RemoteSignal]].self, from: data)
        return decoded["signals"] ?? []
    }

    func sendSignal(type: String, recipientMachineId: String, payload: [String: Any]) async throws {
        _ = try await request(
            path: "/api/remote-control/host/sessions/\(sessionId)/signals",
            method: "POST",
            body: [
                "recipientMachineId": recipientMachineId,
                "type": type,
                "payload": payload
            ]
        )
    }

    private func request(path: String, method: String, body: [String: Any]? = nil) async throws -> Data {
        guard let url = URL(string: path, relativeTo: apiUrl)?.absoluteURL else {
            throw HelperError.request("Invalid request path \(path)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(hostToken)", forHTTPHeaderField: "Authorization")

        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await urlSession.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 500

        guard (200..<300).contains(statusCode) else {
            throw HelperError.request("\(statusCode) \(String(data: data, encoding: .utf8) ?? "")")
        }

        return data
    }
}
