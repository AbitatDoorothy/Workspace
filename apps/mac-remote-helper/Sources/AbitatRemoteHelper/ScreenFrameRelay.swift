import AppKit
import CoreGraphics
import Foundation

final class ScreenFrameRelay {
    private let client: SignalingClient
    private let recipientMachineId: String
    private var isRunning = false

    init(client: SignalingClient, recipientMachineId: String) {
        self.client = client
        self.recipientMachineId = recipientMachineId
    }

    func start() {
        guard !isRunning else {
            return
        }

        isRunning = true
        Task {
            while isRunning {
                do {
                    if let frame = captureFrame() {
                        try await client.sendSignal(
                            type: "frame",
                            recipientMachineId: recipientMachineId,
                            payload: frame
                        )
                    }
                } catch {
                    // Status polling remains alive; frame drops should not end input control.
                }

                try? await Task.sleep(nanoseconds: 750_000_000)
            }
        }
    }

    func stop() {
        isRunning = false
    }

    private func captureFrame() -> [String: Any]? {
        let displayId = CGMainDisplayID()
        guard let image = CGDisplayCreateImage(displayId) else {
            return nil
        }

        let representation = NSBitmapImageRep(cgImage: image)
        guard
            let data = representation.representation(
                using: .jpeg,
                properties: [.compressionFactor: 0.45]
            )
        else {
            return nil
        }

        return [
            "dataUrl": "data:image/jpeg;base64,\(data.base64EncodedString())",
            "height": image.height,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "width": image.width
        ]
    }
}
