import SwiftUI

struct MeView: View {
    @EnvironmentObject var app: AppState
    @State private var confirmDelete = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let user = app.user {
                    Section {
                        LabeledContent("Name", value: user.name)
                        LabeledContent("Email", value: user.email)
                    }
                    .listRowBackground(Color.rpCream)
                }
                if let user = app.user, ["ajay.r.nair@gmail.com", "hazel@readingpeeps.com"].contains(user.email) {
                    Section {
                        NavigationLink {
                            StatsView()
                        } label: {
                            Label("Stats", systemImage: "chart.bar")
                        }
                    }
                    .listRowBackground(Color.rpCream)
                }
                Section {
                    NavigationLink {
                        AboutView()
                    } label: {
                        Label("About", systemImage: "info.circle")
                    }
                    NavigationLink {
                        HelpView()
                    } label: {
                        Label("Help", systemImage: "questionmark.circle")
                    }
                    Link(destination: URL(string: "https://www.readingpeeps.com/privacy.html")!) {
                        Label("Privacy", systemImage: "hand.raised")
                    }
                } header: { rpSectionHeader("About and help") }
                .listRowBackground(Color.rpCream)
                Section {
                    Button("Sign out") {
                        Task { await app.signOut() }
                    }
                }
                .listRowBackground(Color.rpCream)
                Section {
                    Button("Delete account", role: .destructive) { confirmDelete = true }
                }
                .listRowBackground(Color.rpCream)
            }
            .navigationTitle("Me")
            .brandScreen()
            .errorAlert($errorMessage)
            .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete account", role: .destructive) {
                    Task {
                        do { try await app.deleteAccount() }
                        catch { errorMessage = errorText(error) }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes your account, your ratings and your club memberships. This cannot be undone.")
            }
        }
    }
}

/// What Reading Peeps is, in the same plain words as the website.
struct AboutView: View {
    var body: some View {
        List {
            Section {
                Text("Reading Peeps keeps the logistics of a book club in one place: the shared library, the vote for the next book, where everyone is in the current book, and when you meet.")
                Text("It is not a social network. There is no chat, no feed, and nothing designed to hold your attention. The conversation belongs in the room, with the book.")
                Text("Free forever. No ads.")
                Text("Made by a reader in Bothell, Washington.")
                    .foregroundStyle(.secondary)
            }
            .listRowBackground(Color.rpCream)
        }
        .navigationTitle("About")
        .brandScreen()
    }
}

/// The support page, in app: invites, passwords, deleting, cost, contact.
struct HelpView: View {
    var body: some View {
        List {
            Section {
                Text("An invite is single use and tied to the invited email address. Sign in with that same email to accept it.")
            } header: { rpSectionHeader("Invites") }
            .listRowBackground(Color.rpCream)
            Section {
                Text("On the sign in screen, tap Forgot password. We email you a link that works once and expires in an hour. Set the new password in the browser, then sign in here with it.")
            } header: { rpSectionHeader("Forgot your password") }
            .listRowBackground(Color.rpCream)
            Section {
                Text("Me, then Delete account. It removes your account, your ratings and your club memberships.")
            } header: { rpSectionHeader("Delete your account") }
            .listRowBackground(Color.rpCream)
            Section {
                Text("Club settings, if you are an admin. It asks for confirmation first.")
            } header: { rpSectionHeader("Delete a club") }
            .listRowBackground(Color.rpCream)
            Section {
                Text("Nothing. There are no ads and no payments, and it stays that way.")
            } header: { rpSectionHeader("Cost") }
            .listRowBackground(Color.rpCream)
            Section {
                Link("Ajay.r.nair@gmail.com", destination: URL(string: "mailto:Ajay.r.nair@gmail.com")!)
                Link(destination: URL(string: "https://www.readingpeeps.com/privacy.html")!) {
                    HStack {
                        Text("Privacy, in plain words")
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
            } header: { rpSectionHeader("Contact") }
            .listRowBackground(Color.rpCream)
        }
        .navigationTitle("Help")
        .brandScreen()
    }
}

/// Super admin stats: every account and club, with test account cleanup.
/// The server only answers for the two super admin accounts; the row in
/// Me is display only.
struct StatsView: View {
    @State private var stats: StatsResponse?
    @State private var loadError: String?
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let stats {
                List {
                    Section {
                        LabeledContent("Real accounts", value: "\(stats.users.real)")
                        LabeledContent("Test accounts", value: "\(stats.users.test)")
                        LabeledContent("Clubs", value: "\(stats.clubs.total)")
                    }
                    .listRowBackground(Color.rpCream)
                    if let n = stats.notifications {
                        Section {
                            LabeledContent("Delivered", value: "\(n.total)")
                            LabeledContent("Read", value: "\(n.read)")
                            LabeledContent("Email sent", value: "\(n.email["sent"] ?? 0)")
                            if (n.email["failed"] ?? 0) > 0 {
                                LabeledContent("Email failed", value: "\(n.email["failed"] ?? 0)")
                            }
                        } header: { rpSectionHeader("Notifications") }
                        .listRowBackground(Color.rpCream)
                    }
                    if let t = stats.telemetry {
                        telemetrySection(t)
                    }
                    Section {
                        ForEach(Array(stats.clubs.list.enumerated()), id: \.offset) { _, club in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack {
                                    Text(club.name)
                                    Spacer()
                                    Text("\(club.memberCount) member\(club.memberCount == 1 ? "" : "s")")
                                        .foregroundStyle(.secondary)
                                }
                                ForEach(Array((club.members ?? []).enumerated()), id: \.offset) { _, m in
                                    Text("\(m.name ?? "") · \(m.email ?? "")\(m.role == "admin" ? " · admin" : "")")
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    } header: { rpSectionHeader("Clubs") }
                    .listRowBackground(Color.rpCream)
                    Section {
                        ForEach(stats.users.list.filter { !$0.isTest }) { u in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(u.name)
                                Text(u.email + (u.isSuperAdmin ? " · super admin" : ""))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } header: { rpSectionHeader("Real accounts") }
                    .listRowBackground(Color.rpCream)
                    Section {
                        ForEach(stats.users.list.filter { $0.isTest }) { u in
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(u.name)
                                    Text(u.email)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button("Delete", role: .destructive) {
                                    Task { await deleteTestUser(u.email) }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    } header: { rpSectionHeader("Test accounts") }
                    .listRowBackground(Color.rpCream)
                }
            } else if let loadError {
                ContentUnavailableView("Could not load stats", systemImage: "exclamationmark.triangle", description: Text(loadError))
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Stats")
        .navigationBarTitleDisplayMode(.inline)
        .errorAlert($errorMessage)
        .task { await load() }
        .brandScreen()
    }

    @ViewBuilder
    private func telemetrySection(_ t: StatsTelemetry) -> some View {
        Section {
            LabeledContent("Events", value: "\(t.total)")
            LabeledContent("Last 7 days", value: "\(t.last7Days)")
            LabeledContent("Active people", value: "\(t.activeUsers)")
        } header: { rpSectionHeader("Usage") }
        .listRowBackground(Color.rpCream)
        Section {
            let maxDay = max(1, t.byDay.map(\.count).max() ?? 0)
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(t.byDay) { d in
                    VStack(spacing: 3) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(Color.rpCoral)
                            .frame(height: max(3, 44 * CGFloat(d.count) / CGFloat(maxDay)))
                        Text(String(d.day.suffix(2)))
                            .font(.system(size: 8))
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 4)
        } header: { rpSectionHeader("Last 14 days") }
        .listRowBackground(Color.rpCream)
        barSection("By page", t.byPage)
        barSection("By feature", t.byFeature)
        barSection("By event", t.byName)
        if !t.byUser.isEmpty {
            Section {
                ForEach(Array(t.byUser.enumerated()), id: \.offset) { _, u in
                    LabeledContent(u.name, value: "\(u.events)")
                }
            } header: { rpSectionHeader("People") }
            .listRowBackground(Color.rpCream)
        }
    }

    @ViewBuilder
    private func barSection(_ title: String, _ values: [String: Int]) -> some View {
        if !values.isEmpty {
            let sorted = values.sorted { $0.value > $1.value }
            let maxV = max(1, sorted.first?.value ?? 0)
            Section {
                ForEach(Array(sorted.enumerated()), id: \.offset) { _, pair in
                    HStack(spacing: 8) {
                        Text(pair.key)
                            .font(.subheadline)
                            .frame(width: 110, alignment: .leading)
                            .lineLimit(1)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.rpPill)
                                Capsule().fill(Color.rpCoral)
                                    .frame(width: geo.size.width * CGFloat(pair.value) / CGFloat(maxV))
                            }
                        }
                        .frame(height: 10)
                        Text("\(pair.value)")
                            .font(.subheadline.weight(.bold))
                    }
                }
            } header: { rpSectionHeader(title) }
            .listRowBackground(Color.rpCream)
        }
    }

    private func load() async {
        do { stats = try await APIClient.shared.stats() }
        catch {
            if stats == nil { loadError = errorText(error) }
            else { errorMessage = errorText(error) }
        }
    }

    private func deleteTestUser(_ email: String) async {
        do {
            try await APIClient.shared.callDiscard("deleteTestUser", ["email": email])
            await load()
        } catch { errorMessage = errorText(error) }
    }
}
