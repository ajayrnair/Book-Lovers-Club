import SwiftUI

/// In-stack routes for the Clubs tab.
enum Route: Hashable {
    case club(String)
    case library(String)
    case poll(String)
    case settings(String)
    case members(String)
    case findClubs
    case createClub
    case notifications
}

struct RootView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        Group {
            if app.restoring {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Reading Peeps")
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }
            } else if app.user == nil {
                AuthView()
            } else {
                TabView {
                    ClubsView()
                        .tabItem { Label("Clubs", systemImage: "books.vertical") }
                    AddBooksView()
                        .tabItem { Label("Add Books", systemImage: "plus.circle") }
                    MeView()
                        .tabItem { Label("Me", systemImage: "person.circle") }
                }
            }
        }
    }
}
