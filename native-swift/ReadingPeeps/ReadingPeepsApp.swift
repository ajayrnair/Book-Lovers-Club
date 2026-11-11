import SwiftUI
import UIKit

@main
struct ReadingPeepsApp: App {
    @StateObject private var appState = AppState()

    init() {
        // Brand chrome, matching the web app: deep plum bars with cream
        // titles and coral tint, set once through the UIKit appearance
        // proxies. The web's header and bottom nav are plum the same way.
        let cream = UIColor(red: 1.0, green: 249.0 / 255.0, blue: 241.0 / 255.0, alpha: 1)
        let plum = UIColor(red: 46.0 / 255.0, green: 14.0 / 255.0, blue: 40.0 / 255.0, alpha: 1)
        let coral = UIColor(red: 201.0 / 255.0, green: 58.0 / 255.0, blue: 84.0 / 255.0, alpha: 1)
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = plum
        nav.titleTextAttributes = [.foregroundColor: cream]
        nav.largeTitleTextAttributes = [.foregroundColor: cream]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().tintColor = coral
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = plum
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
        UITabBar.appearance().tintColor = coral
        UITabBar.appearance().unselectedItemTintColor = UIColor(red: 1.0, green: 249.0 / 255.0, blue: 241.0 / 255.0, alpha: 0.55)
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
