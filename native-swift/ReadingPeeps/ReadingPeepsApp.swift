import SwiftUI
import UIKit

@main
struct ReadingPeepsApp: App {
    @StateObject private var appState = AppState()

    init() {
        // Brand chrome, matching the web app: cream bars, plum ink titles,
        // coral tint, set once through the UIKit appearance proxies.
        let cream = UIColor(red: 1.0, green: 249.0 / 255.0, blue: 241.0 / 255.0, alpha: 1)
        let ink = UIColor(red: 58.0 / 255.0, green: 27.0 / 255.0, blue: 46.0 / 255.0, alpha: 1)
        let coral = UIColor(red: 201.0 / 255.0, green: 58.0 / 255.0, blue: 84.0 / 255.0, alpha: 1)
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = cream
        nav.titleTextAttributes = [.foregroundColor: ink]
        nav.largeTitleTextAttributes = [.foregroundColor: ink]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().tintColor = coral
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = cream
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
        UITabBar.appearance().tintColor = coral
    }

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
