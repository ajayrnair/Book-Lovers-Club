import SwiftUI

struct ClubsView: View {
    @EnvironmentObject var app: AppState
    @State private var unread = 0
    @State private var clubToLeave: Club?

    var body: some View {
        NavigationStack {
            List {
                Section {
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
                } header: { rpSectionHeader("My clubs") }
                .listRowBackground(Color.rpCream)
                Section {
                    NavigationLink(value: Route.findClubs) {
                        Label("Find a club", systemImage: "magnifyingglass")
                    }
                    NavigationLink(value: Route.createClub) {
                        Label("Create a club", systemImage: "plus.circle")
                    }
                } header: { rpSectionHeader("Find and create") }
                .listRowBackground(Color.rpCream)
            }
            .navigationTitle("Clubs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(spacing: 7) {
                        LogoView(size: 24)
                        Text("Reading Peeps")
                            .font(.headline)
                            .foregroundStyle(Color.rpCream)
                    }
                }
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
            .onAppear { APIClient.shared.track("page_view", page: "clubs"); Task { await refreshUnread() } }
            .brandScreen()
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
                List {
                    ForEach(items) { item in
                        Section {
                            notificationRow(item)
                        }
                    }
                }
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .brandScreen()
    }

    private func notificationRow(_ item: NotificationItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: iconName(for: item.type))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(iconColor(for: item.type))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(Dates.relativeLabel(iso: item.createdAt))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Text(item.body)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            if !item.read {
                Circle()
                    .fill(Color.rpCoral)
                    .frame(width: 8, height: 8)
                    .padding(.top, 4)
            }
        }
        .padding(.vertical, 2)
    }

    private func iconName(for type: String) -> String {
        switch type {
        case "meeting", "meeting_reminder": return "calendar"
        case "poll": return "chart.bar"
        case "poll_result": return "book.fill"
        default: return "bell.fill"
        }
    }

    private func iconColor(for type: String) -> Color {
        switch type {
        case "meeting", "meeting_reminder": return Color.rpTeal
        case "poll": return Color.rpViolet
        case "poll_result": return Color.rpCoral
        default: return Color.rpPlum
        }
    }

    private func load() async {
        do {
            let r = try await APIClient.shared.notifications()
            items = r.notifications
            loaded = true
            loadError = nil
            try? await APIClient.shared.callDiscard("markNotificationsRead", ["via": "app"])
        } catch {
            loadError = errorText(error)
            loaded = true
        }
    }
}
