import SwiftUI

struct ClubsView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        NavigationStack {
            List {
                Section("My clubs") {
                    if app.orderedClubs.isEmpty {
                        Text("No clubs yet. Find one or start your own in Explore.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(app.orderedClubs) { club in
                        NavigationLink(value: Route.club(club.id)) {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(club.name)
                                    Text(subtitle(for: club))
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Spacer()
                                if club.`private` {
                                    Image(systemName: "lock.fill")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Clubs")
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .club(let id): ClubView(clubId: id)
                case .library(let id): LibraryView(clubId: id)
                case .poll(let id): PollView(clubId: id)
                case .settings(let id): ClubSettingsView(clubId: id)
                case .members(let id): MembersView(clubId: id)
                }
            }
            .refreshable {
                await app.refreshClubs()
            }
        }
    }

    private func subtitle(for club: Club) -> String {
        var s = "\(club.memberCount) member\(club.memberCount == 1 ? "" : "s")"
        if let current = club.current {
            s += " · Reading \(current.title)"
        }
        return s
    }
}
