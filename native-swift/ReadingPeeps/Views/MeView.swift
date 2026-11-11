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
                }
                if let user = app.user, ["ajay.r.nair@gmail.com", "hazel@readingpeeps.com"].contains(user.email) {
                    Section {
                        NavigationLink {
                            StatsView()
                        } label: {
                            Label("Stats", systemImage: "chart.bar")
                        }
                    }
                }
                Section {
                    Button("Sign out") {
                        Task { await app.signOut() }
                    }
                }
                Section {
                    Button("Delete account", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle("Me")
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
                    Section("Clubs") {
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
                    }
                    Section("Real accounts") {
                        ForEach(stats.users.list.filter { !$0.isTest }) { u in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(u.name)
                                Text(u.email + (u.isSuperAdmin ? " · super admin" : ""))
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                    Section("Test accounts") {
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
                    }
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
