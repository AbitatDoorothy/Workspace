import Foundation

final class AppActivityStallWatchdog: @unchecked Sendable {
    private let logger: AppActivityLogger
    private let threshold: TimeInterval
    private let interval: TimeInterval
    private let queue = DispatchQueue(label: "ai.alook.abitat.mac.stall-watchdog")

    private var heartbeatTask: Task<Void, Never>?
    private var timer: DispatchSourceTimer?
    private var lastHeartbeat = Date()
    private var lastReportedHeartbeat: Date?
    private var isRunning = false

    init(
        logger: AppActivityLogger,
        threshold: TimeInterval = 3,
        interval: TimeInterval = 1
    ) {
        self.logger = logger
        self.threshold = threshold
        self.interval = interval
    }

    func start() {
        queue.async {
            guard !self.isRunning else {
                return
            }
            self.isRunning = true
            self.lastHeartbeat = Date()
            self.lastReportedHeartbeat = nil
            self.startTimer()
            self.startHeartbeatTask()
            self.logger.log("watchdog.start", fields: [
                "thresholdMs": Int(self.threshold * 1_000),
                "intervalMs": Int(self.interval * 1_000)
            ])
        }
    }

    func stop() {
        queue.async {
            guard self.isRunning else {
                return
            }
            self.isRunning = false
            self.heartbeatTask?.cancel()
            self.heartbeatTask = nil
            self.timer?.cancel()
            self.timer = nil
            self.logger.log("watchdog.stop")
        }
    }

    private func startTimer() {
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { [weak self] in
            self?.checkHeartbeat()
        }
        self.timer = timer
        timer.resume()
    }

    private func startHeartbeatTask() {
        heartbeatTask = Task.detached(priority: .background) { [weak self] in
            while !Task.isCancelled {
                await MainActor.run {
                    self?.recordHeartbeat()
                }
                let nanoseconds = UInt64(max(0.1, self?.interval ?? 1) * 1_000_000_000)
                try? await Task.sleep(nanoseconds: nanoseconds)
            }
        }
    }

    private func recordHeartbeat() {
        queue.async {
            guard self.isRunning else {
                return
            }
            self.lastHeartbeat = Date()
        }
    }

    private func checkHeartbeat() {
        guard isRunning else {
            return
        }
        let elapsed = Date().timeIntervalSince(lastHeartbeat)
        guard elapsed >= threshold, lastReportedHeartbeat != lastHeartbeat else {
            return
        }
        lastReportedHeartbeat = lastHeartbeat
        logger.log("main_actor.stall", fields: [
            "elapsedMs": Int(elapsed * 1_000),
            "thresholdMs": Int(threshold * 1_000)
        ])
    }
}
