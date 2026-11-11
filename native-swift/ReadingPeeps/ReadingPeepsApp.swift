import SwiftUI

@main
struct ReadingPeepsApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .tint(.rpCoral)
                .task {
                    await appState.restore()
                }
        }
    }
}
