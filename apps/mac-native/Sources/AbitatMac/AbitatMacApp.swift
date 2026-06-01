import SwiftUI

@main
struct AbitatMacApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .frame(minWidth: 1180, minHeight: 740)
                .task {
                    model.start()
                }
                .onDisappear {
                    model.stop()
                }
        }
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Refresh") {
                    Task { await model.refreshAll() }
                }
                .keyboardShortcut("r", modifiers: [.command])
            }
        }
    }
}
