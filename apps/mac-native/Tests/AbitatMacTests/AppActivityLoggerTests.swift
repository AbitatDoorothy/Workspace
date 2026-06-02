import Foundation
import XCTest
@testable import AbitatMac

final class AppActivityLoggerTests: XCTestCase {
    func testActivityLoggerRedactsSensitiveStringsAndBoundsLongFields() throws {
        let fileURL = try temporaryLogURL()
        let logger = AppActivityLogger(fileURL: fileURL, maxStringLength: 12)

        logger.log(
            "send.start",
            fields: [
                "prompt": "secret prompt body",
                "promptLength": 18,
                "selectedConversationId": "thread-a",
                "longField": "abcdefghijklmnopqrstuvwxyz"
            ]
        )
        logger.flush()

        let data = try String(contentsOf: fileURL, encoding: .utf8)

        XCTAssertFalse(data.contains("secret prompt body"))
        XCTAssertTrue(data.contains(#""prompt":"[redacted]""#))
        XCTAssertTrue(data.contains(#""promptLength":18"#))
        XCTAssertTrue(data.contains(#""longField":"abcdefghijk…""#))
    }

    func testActivityLoggerRedactsSensitiveBackendErrorBodies() throws {
        let fileURL = try temporaryLogURL()
        let logger = AppActivityLogger(fileURL: fileURL, maxStringLength: 240)

        logger.log(
            "loadConversationDetails.error",
            fields: [
                "error": #"HTTP 500 {"prompt":"secret prompt body","message":"private message","token":"token-123","fileContents":"source code"}"#,
                "stage": "messages",
                "statusCode": 500
            ]
        )
        logger.flush()

        let data = try String(contentsOf: fileURL, encoding: .utf8)

        XCTAssertFalse(data.contains("secret prompt body"))
        XCTAssertFalse(data.contains("private message"))
        XCTAssertFalse(data.contains("token-123"))
        XCTAssertFalse(data.contains("source code"))
        XCTAssertTrue(data.contains(#""error":"[redacted]""#))
        XCTAssertTrue(data.contains(#""statusCode":500"#))
    }

    func testActivityLoggerBoundsLogFileOnDisk() throws {
        let fileURL = try temporaryLogURL()
        let logger = AppActivityLogger(
            fileURL: fileURL,
            maxStringLength: 80,
            maxFileBytes: 700
        )

        for index in 0..<30 {
            logger.log(
                "polling.tick.end",
                fields: [
                    "index": index,
                    "selectedConversationId": "thread-\(index)",
                    "longField": String(repeating: "x", count: 60)
                ]
            )
        }
        logger.flush()

        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let size = try XCTUnwrap(attributes[.size] as? Int)
        let data = try String(contentsOf: fileURL, encoding: .utf8)

        XCTAssertLessThanOrEqual(size, 700)
        XCTAssertFalse(data.contains(#""index":0"#))
        XCTAssertTrue(data.contains(#""index":29"#))
    }

    private func temporaryLogURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("abitat-activity-log-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("activity.jsonl")
    }
}
