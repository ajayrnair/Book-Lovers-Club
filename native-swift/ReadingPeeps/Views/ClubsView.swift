import SwiftUI

struct ClubsView: View {
    @EnvironmentObject var app: AppState
    @State private var unread = 0
    @State private var clubToLeave: Club?

    var body: some View {
        NavigationStack {
            List {
                Section("My clubs") {
                    if app.orderedClubs.isEmpty {
                        Text("No clubs yet. Find one or start your own below.")
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
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button("Leave", role: .destructive) { clubToLeave = club }
                        }
                        .contextMenu {
                            Button("Leave club", role: .destructive) { clubToLeave = club }
                        }
                    }
                }
                Section("Find and create") {
                    NavigationLink(value: Route.findClubs) {
                        Label("Find a club", systemImage: "magnifyingglass")
                    }
                    NavigationLink(value: Route.createClub) {
                        Label("Create a club", systemImage: "plus.circle")
                    }
                }
            }
            .navigationTitle("Clubs")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink(value: Route.notifications) {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "bell")
                            if unread > 0 {
                                Text("\(unread)")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(Color.rpCoral)
                                    .clipShape(Capsule())
                                    .offset(x: 8, y: -6)
                            }
                        }
                    }
                    .accessibilityLabel(unread > 0 ? "Notifications, \(unread) unread" : "Notifications")
                }
            }
            .navigationDestination(for: Route.self) { route in
                switch route {
                case .club(let id): ClubView(clubId: id)
                case .library(let id): LibraryView(clubId: id)
                case .poll(let id): PollView(clubId: id)
                case .settings(let id): ClubSettingsView(clubId: id)
                case .members(let id): MembersView(clubId: id)
                case .findClubs: FindClubsView().navigationTitle("Find a club")
                case .createClub: CreateClubView().navigationTitle("Create a club")
                case .notifications: NotificationsView()
                }
            }
            .refreshable {
                await app.refreshClubs()
                await refreshUnread()
            }
            .task { await refreshUnread() }
            .onAppear { Task { await refreshUnread() } }
            .confirmationDialog(
                "Leave \(clubToLeave?.name ?? "this club")?",
                isPresented: Binding(get: { clubToLeave != nil }, set: { if !$0 { clubToLeave = nil } }),
                titleVisibility: .visible
            ) {
                Button("Leave", role: .destructive) {
                    if let target = clubToLeave {
                        Task { await leave(target) }
                    }
                    clubToLeave = nil
                }
                Button("Cancel", role: .cancel) { clubToLeave = nil }
            }
        }
    }

    private func refreshUnread() async {
        if let r = try? await APIClient.shared.notifications() {
            unread = r.unread
        }
    }

    private func leave(_ club: Club) async {
        try? await APIClient.shared.callDiscard("leaveClub", ["clubId": club.id])
        await app.refreshClubs()
    }

    private func subtitle(for club: Club) -> String {
        var s = "\(club.memberCount) member\(club.memberCount == 1 ? "" : "s")"
        if let current = club.current {
            s += " · Reading \(current.title)"
        }
        return s
    }
}

/// The notifications inbox: poll and meeting updates. Opening it marks
/// everything read, like the web app's bell view.
struct NotificationsView: View {
    @State private var items: [NotificationItem] = []
    @State private var loaded = false
    @State private var loadError: String?

    var body: some View {
        Group {
            if let loadError {
                ContentUnavailableView("Could not load notifications", systemImage: "exclamationmark.triangle", description: Text(loadError))
            } else if !loaded {
                ProgressView()
            } else if items.isEmpty {
                ContentUnavailableView("Nothing yet", systemImage: "bell.slash", description: Text("Voting and meeting updates will land here."))
            } else {
                List(items) { item in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .font(.body.weight(.semibold))
                        Text(item.body)
                            .font(.subheadline)
                        Text(Dates.shortDate(iso: item.createdAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            let r = try await APIClient.shared.notifications()
            items = r.notifications
            loaded = true
            loadError = nil
            try? await APIClient.shared.callDiscard("markNotificationsRead")
        } catch {
            loadError = errorText(error)
            loaded = true
        }
    }
}
