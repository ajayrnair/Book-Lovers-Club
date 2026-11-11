import SwiftUI

/// Club settings for admins: members, meeting frequency, delete club.
struct ClubSettingsView: View {
    let clubId: String
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var club: Club?
    @State private var loadError: String?
    @State private var errorMessage: String?
    @State private var freqWeeks = 2
    @State private var autoPoll = false
    @State private var confirmDelete = false
    @State private var templateText = ""
    @State private var templateLoaded = false
    @State private var templateSaved = false

    var body: some View {
        Group {
            if let club {
                List {
                    Section {
                        NavigationLink(value: Route.members(clubId)) {
                            Label("Members", systemImage: "person.2")
                        }
                    }
                    Section("Meeting frequency") {
                        Picker("Meets every", selection: freqBinding(club)) {
                            ForEach(1...8, id: \.self) { w in
                                Text("\(w) week\(w == 1 ? "" : "s")").tag(w)
                            }
                        }
                        Toggle("Auto-poll", isOn: autoPollBinding(club))
                        Text("Start a poll automatically a week before the cycle ends")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Section("Discussion questions") {
                        TextField("One question per line", text: $templateText, axis: .vertical)
                            .lineLimit(4...10)
                        Button("Save template") {
                            Task { await saveTemplate() }
                        }
                        if templateSaved {
                            Text("Saved")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Text("These questions start the list for every new book. Members can add more for each book.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    Section {
                        Button("Delete club", role: .destructive) { confirmDelete = true }
                    }
                }
            } else if let loadError {
                ContentUnavailableView("Could not load settings", systemImage: "exclamationmark.triangle", description: Text(loadError))
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .errorAlert($errorMessage)
        .confirmationDialog("Delete \(club?.name ?? "this club") for everyone?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete club", role: .destructive) { Task { await deleteClub() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This cannot be undone.")
        }
    }

    private func load() async {
        do {
            let fresh = try await APIClient.shared.club(id: clubId)
            club = fresh
            loadError = nil
            freqWeeks = fresh.meetingFrequencyWeeks
            autoPoll = fresh.autoPoll
            if !templateLoaded {
                templateText = (fresh.discussion?.template ?? []).joined(separator: "\n")
                templateLoaded = true
            }
        } catch {
            if club == nil { loadError = errorText(error) }
            else { errorMessage = errorText(error) }
        }
    }

    // Custom bindings: a save fires only for a genuine change, never for the
    // values load() just synced.
    private func freqBinding(_ c: Club) -> Binding<Int> {
        Binding(
            get: { freqWeeks },
            set: { new in
                freqWeeks = new
                if new != c.meetingFrequencyWeeks {
                    Task { await saveSettings() }
                }
            }
        )
    }

    private func autoPollBinding(_ c: Club) -> Binding<Bool> {
        Binding(
            get: { autoPoll },
            set: { new in
                autoPoll = new
                if new != c.autoPoll {
                    Task { await saveSettings() }
                }
            }
        )
    }

    private func saveSettings() async {
        do {
            let updated = try await APIClient.shared.clubSettings(clubId: clubId, [
                "meetingFrequencyWeeks": freqWeeks,
                "autoPoll": autoPoll,
            ])
            club = updated
        } catch { errorMessage = errorText(error) }
    }

    private func saveTemplate() async {
        let questions = templateText.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        do {
            let updated: ClubResponse = try await APIClient.shared.call("setDiscussionTemplate", ["clubId": clubId, "questions": questions])
            club = updated.club
            templateSaved = true
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            templateSaved = false
        } catch { errorMessage = errorText(error) }
    }

    private func deleteClub() async {
        do {
            try await APIClient.shared.callDiscard("deleteClub", ["clubId": clubId])
            await app.refreshClubs()
            dismiss()
        } catch { errorMessage = errorText(error) }
    }
}

/// Members list with admin tools and the email invite form.
struct MembersView: View {
    let clubId: String
    @EnvironmentObject var app: AppState

    @State private var club: Club?
    @State private var loadError: String?
    @State private var errorMessage: String?
    @State private var emails = ""
    @State private var inviteResults: [InviteResult] = []
    @State private var emailed = true
    @State private var sending = false
    @State private var memberToRemove: Member?

    private var myId: String { app.user?.id ?? "" }

    var body: some View {
        Group {
            if let club {
                List {
                    Section {
                        ForEach(club.members) { member in
                            memberRow(club, member: member)
                        }
                    }
                    if club.isAdmin {
                        inviteSection
                    }
                }
                .refreshable { await load() }
            } else if let loadError {
                ContentUnavailableView("Could not load members", systemImage: "exclamationmark.triangle", description: Text(loadError))
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Members")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .errorAlert($errorMessage)
        .confirmationDialog(
            "Remove \(memberToRemove?.name ?? "this member")?",
            isPresented: Binding(get: { memberToRemove != nil }, set: { if !$0 { memberToRemove = nil } }),
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                if let member = memberToRemove {
                    Task { await removeMember(member) }
                }
                memberToRemove = nil
            }
            Button("Cancel", role: .cancel) { memberToRemove = nil }
        }
    }

    @ViewBuilder
    private func memberRow(_ c: Club, member: Member) -> some View {
        let adminCount = c.members.filter { $0.role == "admin" }.count
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(member.userId == myId ? "You" : member.name)
                if member.role == "admin" {
                    Text("Admin")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if c.isAdmin {
                Menu {
                    if member.role == "admin" {
                        if adminCount > 1 {
                            Button("Remove admin") { Task { await adminAction("removeAdmin", userId: member.userId) } }
                        }
                    } else {
                        Button("Make admin") { Task { await adminAction("makeAdmin", userId: member.userId) } }
                    }
                    if member.userId != myId {
                        Button("Remove from club", role: .destructive) { memberToRemove = member }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var inviteSection: some View {
        Section("Invite members") {
            TextField("Emails to invite, separated by commas", text: $emails, axis: .vertical)
                .lineLimit(3...6)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
            Button {
                Task { await sendInvites() }
            } label: {
                HStack {
                    if sending { ProgressView() }
                    Text("Send invites")
                }
            }
            .disabled(sending || emails.trimmingCharacters(in: .whitespaces).isEmpty)
            if !emailed && !inviteResults.isEmpty {
                Text("Email sending isn't switched on. Send these links yourself:")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            ForEach(inviteResults) { result in
                inviteResultRow(result)
            }
            if inviteResults.contains(where: { $0.sent }) {
                Text("The email comes from Reading Peeps (invites@readingpeeps.com), with the subject \"You're invited to join \(club?.name ?? "your club") on Reading Peeps\". Tell them to look for that in their inbox, and to check spam if it is not there.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func inviteResultRow(_ result: InviteResult) -> some View {
        if result.sent {
            Label("Invite sent to \(result.email)", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        } else if let token = result.inviteToken {
            VStack(alignment: .leading, spacing: 2) {
                Text("Couldn't email \(result.email)")
                Text("https://www.readingpeeps.com/?invite=\(token)")
                    .font(.caption)
                    .textSelection(.enabled)
            }
        } else {
            Text("\(result.email): \(result.error ?? "not invited")")
                .foregroundStyle(.secondary)
        }
    }

    private func load() async {
        do {
            club = try await APIClient.shared.club(id: clubId)
            loadError = nil
        } catch {
            if club == nil { loadError = errorText(error) }
            else { errorMessage = errorText(error) }
        }
    }

    private func adminAction(_ action: String, userId: String) async {
        do {
            try await APIClient.shared.callDiscard(action, ["clubId": clubId, "userId": userId])
            await load()
        } catch { errorMessage = errorText(error) }
    }

    private func removeMember(_ member: Member) async {
        do {
            try await APIClient.shared.callDiscard("removeMember", ["clubId": clubId, "userId": member.userId])
            await load()
            await app.refreshClubs()
        } catch { errorMessage = errorText(error) }
    }

    private func sendInvites() async {
        sending = true
        do {
            let response = try await APIClient.shared.createInvite(clubId: clubId, emailList: emails)
            emailed = response.emailed
            inviteResults = response.results
            if response.results.allSatisfy({ $0.sent }) {
                emails = ""
            }
        } catch {
            errorMessage = errorText(error)
        }
        sending = false
    }
}
