import Foundation
import XCTest
@testable import AbitatMacCore

final class AbitatMacCoreTests: XCTestCase {
    func testDecodesHelperReadyLine() throws {
        let data = Data("""
        {
          "type": "ready",
          "desktopEndpoint": "http://127.0.0.1:3971",
          "localEndpoint": "http://127.0.0.1:3901",
          "publicEndpoint": "https://workspace.abitat.io",
          "relayEndpoint": "https://workspace.abitat.io",
          "relayId": "relay_test"
        }
        """.utf8)

        let ready = try JSONDecoder.abitat.decode(HelperReadyMessage.self, from: data)

        XCTAssertEqual(ready.desktopEndpoint.absoluteString, "http://127.0.0.1:3971")
        XCTAssertEqual(ready.localEndpoint.absoluteString, "http://127.0.0.1:3901")
        XCTAssertEqual(ready.relayId, "relay_test")
    }

    func testDecodesDesktopProjectAndConversationResponses() throws {
        let projectsData = Data("""
        {
          "projects": [
            {
              "id": "project-a",
              "name": "Abitat_Workspace",
              "conversationCount": 3,
              "updatedAt": "2026-05-27T12:00:00.000Z"
            }
          ]
        }
        """.utf8)
        let conversationsData = Data("""
        {
          "conversations": [
            {
              "id": "thread-a",
              "projectId": "project-a",
              "prompt": "Build native Mac",
              "status": "running",
              "updatedAt": "2026-05-27T12:01:00.000Z"
            }
          ]
        }
        """.utf8)

        let projects = try JSONDecoder.abitat.decode(ProjectsResponse.self, from: projectsData)
        let conversations = try JSONDecoder.abitat.decode(
            ConversationsResponse.self,
            from: conversationsData
        )

        XCTAssertEqual(projects.projects.first?.name, "Abitat_Workspace")
        XCTAssertEqual(conversations.conversations.first?.prompt, "Build native Mac")
    }

    func testFormatsTokenBucketsForCompactNativeUi() {
        XCTAssertEqual(TokenFormatter.compact(0), "0")
        XCTAssertEqual(TokenFormatter.compact(1_250), "1.2K")
        XCTAssertEqual(TokenFormatter.compact(5_940_000), "5.9M")
    }

    func testDecodesPluginSuggestionsWithoutLocalPaths() throws {
        let data = Data("""
        {
          "suggestions": [
            {
              "id": "skill:browser:browser",
              "displayName": "Browser",
              "invocationName": "browser:browser",
              "kind": "skill",
              "pluginName": "browser",
              "skillName": "browser",
              "description": "Browser automation",
              "source": "plugin-skill",
              "keywords": ["browser"]
            }
          ]
        }
        """.utf8)

        let response = try JSONDecoder.abitat.decode(PluginSuggestionsResponse.self, from: data)

        XCTAssertEqual(response.suggestions.first?.id, "skill:browser:browser")
        XCTAssertEqual(response.suggestions.first?.displayName, "Browser")
    }

    func testEncodesSelectedSkillIdsInConversationPayload() throws {
        let input = ConversationInput(
            prompt: "Use @Browser",
            modelSettings: ModelSettings(model: "gpt-5", effort: "medium"),
            skills: [SkillSelection(id: "skill:browser:browser")]
        )

        let payload = try JSONSerialization.jsonObject(
            with: JSONEncoder.abitat.encode(input)
        ) as? [String: Any]
        let skills = payload?["skills"] as? [[String: String]]

        XCTAssertEqual(payload?["prompt"] as? String, "Use @Browser")
        XCTAssertEqual(skills, [["id": "skill:browser:browser"]])
    }

    func testProjectConversationPreviewLimitsCollapsedThreads() {
        let conversations = makeConversations(count: 7)

        let visible = ProjectConversationPreview.visibleConversations(
            conversations,
            isExpanded: false
        )
        let hiddenCount = ProjectConversationPreview.hiddenCount(
            conversations,
            isExpanded: false
        )

        XCTAssertEqual(visible.map(\.id), ["thread-1", "thread-2", "thread-3", "thread-4", "thread-5"])
        XCTAssertEqual(hiddenCount, 2)
    }

    func testProjectConversationPreviewShowsAllExpandedThreads() {
        let conversations = makeConversations(count: 7)

        let visible = ProjectConversationPreview.visibleConversations(
            conversations,
            isExpanded: true
        )
        let hiddenCount = ProjectConversationPreview.hiddenCount(
            conversations,
            isExpanded: true
        )

        XCTAssertEqual(visible.map(\.id), conversations.map(\.id))
        XCTAssertEqual(hiddenCount, 0)
    }

    func testStatusPollingRefreshesSelectedAndActiveProjectsOnly() {
        let completions = [
            CompletionState(
                conversationId: "thread-active",
                projectId: "project-b",
                prompt: "Running task",
                status: "running",
                isComplete: false,
                failed: false,
                updatedAt: nil
            ),
            CompletionState(
                conversationId: "thread-done",
                projectId: "project-c",
                prompt: "Done task",
                status: "approved",
                isComplete: true,
                failed: false,
                updatedAt: nil
            )
        ]

        let projectIds = ProjectConversationRefreshPolicy.statusPollProjectIds(
            selectedProjectId: "project-a",
            completions: completions
        )

        XCTAssertEqual(projectIds, ["project-a", "project-b"])
    }

    func testBackendClientDefaultSessionUsesShortTimeouts() {
        let configuration = BackendClient.defaultSessionConfiguration()

        XCTAssertEqual(configuration.timeoutIntervalForRequest, 8)
        XCTAssertEqual(configuration.timeoutIntervalForResource, 15)
        XCTAssertFalse(configuration.waitsForConnectivity)
    }

    func testBackendClientMessagesDoesNotForceRefreshByDefault() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RequestCaptureURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let endpoint = try XCTUnwrap(URL(string: "http://127.0.0.1:3971"))
        let client = BackendClient(endpoint: endpoint, session: session)
        var capturedURL: URL?
        RequestCaptureURLProtocol.requestHandler = { request in
            capturedURL = request.url
            let url = try XCTUnwrap(request.url)
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )
            )
            return (response, Data(#"{"messages":[]}"#.utf8))
        }
        defer {
            RequestCaptureURLProtocol.requestHandler = nil
        }

        let messages = try await client.messages(conversationId: "codex_thread_thread_fast")
        let components = try XCTUnwrap(
            URLComponents(url: try XCTUnwrap(capturedURL), resolvingAgainstBaseURL: false)
        )
        let queryItems = components.queryItems ?? []

        XCTAssertEqual(messages, [])
        XCTAssertEqual(components.path, "/api/desktop/conversations/codex_thread_thread_fast/messages")
        XCTAssertNil(queryItems.first(where: { $0.name == "forceRefresh" }))
        XCTAssertEqual(queryItems.first(where: { $0.name == "includeRuntime" })?.value, "0")
    }

    private func makeConversations(count: Int) -> [DesktopConversation] {
        (1...count).map { index in
            DesktopConversation(
                id: "thread-\(index)",
                projectId: "project-a",
                prompt: "Prompt \(index)",
                status: "ready",
                updatedAt: nil
            )
        }
    }
}

private final class RequestCaptureURLProtocol: URLProtocol {
    nonisolated(unsafe) static var requestHandler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let requestHandler = Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: BackendClientTestError.missingRequestHandler)
            return
        }

        do {
            let (response, data) = try requestHandler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private enum BackendClientTestError: Error {
    case missingRequestHandler
}
