import Foundation

@main
struct AbitatRemoteHelper {
    static func main() async {
        do {
            let config = try HelperConfig.load(
                arguments: Array(CommandLine.arguments.dropFirst()),
                environment: ProcessInfo.processInfo.environment
            )
            let client = SignalingClient(config: config)
            let injector = InputInjector()
            let frameRelay = ScreenFrameRelay(client: client, recipientMachineId: config.clientMachineId)
            var seenSignals = Set<String>()

            try await client.updateStatus("active")

            if config.screenEnabled {
                frameRelay.start()
            }

            while !Task.isCancelled {
                let signals = try await client.pollSignals()

                for signal in signals where !seenSignals.contains(signal.id) {
                    seenSignals.insert(signal.id)

                    if config.inputEnabled {
                        injector.handle(signal: signal)
                    }
                }

                try await Task.sleep(nanoseconds: 350_000_000)
            }

            frameRelay.stop()
            try await client.updateStatus("ended")
        } catch {
            let message = String(describing: error)
            fputs("AbitatRemoteHelper failed: \(message)\n", stderr)

            if let config = try? HelperConfig.load(
                arguments: Array(CommandLine.arguments.dropFirst()),
                environment: ProcessInfo.processInfo.environment
            ) {
                let client = SignalingClient(config: config)
                try? await client.updateStatus("failed", errorMessage: message)
            }

            Foundation.exit(1)
        }
    }
}
