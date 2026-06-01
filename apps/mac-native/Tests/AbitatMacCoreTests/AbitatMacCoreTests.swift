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
}
