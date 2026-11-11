import SwiftUI

@main
struct ReadingPeepsApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(appState)
                .tint(.rpCoral)
                .preferredColorScheme(.light)
                .task {
                    await appState.restore()
                }
        }
    }
}
