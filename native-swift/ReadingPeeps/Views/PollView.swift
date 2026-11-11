import SwiftUI

/// The poll screen: running poll with tap-to-vote rows, the tie-break state,
/// and the admin start form.
struct PollView: View {
    let clubId: String
    @Environment(\.dismiss) private var dismiss

    @State private var club: Club?
    @State private var loadError: String?
    @State private var errorMessage: String?
    @State private var endDate = Date()
    @State private var endDateTouched = false

    var body: some View {
        Group {
            if let club {
                List {
                    content(club)
                }
                .refreshable { await load() }
            } else if let loadError {
                ContentUnavailableView("Could not load the poll", systemImage: "exclamationmark.triangle", description: Text(loadError))
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Poll")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .errorAlert($errorMessage)
    }

    @ViewBuilder
    private func content(_ c: Club) -> some View {
        if let poll = c.poll {
            runningPoll(c, poll: poll)
        } else if let tie = c.lastResult?.tie, !tie.isEmpty {
            tieBreak(c, tieKeys: tie)
        } else {
            startForm(c)
        }
    }

    // MARK: - states

    @ViewBuilder
    private func runningPoll(_ c: Club, poll: Poll) -> some View {
        Section {
            ForEach(poll.options, id: \.book.key) { option in
                Button {
                    Task { await vote(bookKey: option.book.key) }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        CoverView(urlString: option.book.cover)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(option.book.title)
                                .foregroundStyle(.primary)
                            if let author = option.book.author, !author.isEmpty {
                                Text(author)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                            if poll.myVote == option.book.key {
                                Text("Your vote")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Color.rpViolet)
                            } else if poll.totalVotes > 0 {
                                ProgressView(value: Double(option.votes), total: Double(max(poll.totalVotes, 1)))
                                    .tint(.rpViolet)
                            }
                        }
                        Spacer()
                        if poll.myVote == option.book.key {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(Color.rpViolet)
                        }
                        Text("\(option.votes)")
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.primary)
                    }
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text(poll.runoff ? "Runoff" : (c.current != nil ? "Pick the next book" : "Pick a book"))
        } footer: {
            let closes = Dates.shortDate(iso: poll.closesAt)
            Text("\(poll.totalVotes) vote\(poll.totalVotes == 1 ? "" : "s")\(closes.isEmpty ? "" : " · Closes \(closes)")")
        }
        if c.isAdmin {
            Section {
                Button("Close poll", role: .destructive) {
                    Task { await closePoll() }
                }
            }
        }
    }

    @ViewBuilder
    private func tieBreak(_ c: Club, tieKeys: [String]) -> some View {
        let tied = tieKeys.compactMap { key in c.library.first { $0.key == key } }
        Section {
            Text("The poll tied between \(tied.count) books.")
                .foregroundStyle(.secondary)
            ForEach(tied) { book in
                BookRowView(title: book.title, author: book.author, year: book.year,
                            cover: book.cover, ratings: ratingsText(for: book))
                if c.isAdmin {
                    Button("Pick this book") {
                        Task { await adminPick(bookKey: book.key) }
                    }
                }
            }
        }
        if c.isAdmin {
            Section {
                Button("Run a one-day runoff") {
                    Task { await runoff() }
                }
            }
        } else {
            Section {
                Text("The admin picks the winner.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private func startForm(_ c: Club) -> some View {
        if !c.isAdmin {
            Section {
                Text("No poll is running. An admin can start one.")
                    .foregroundStyle(.secondary)
            }
        } else if c.pollCandidates.count < 2 {
            Section {
                Text("No poll is running. A poll needs at least two books that nobody has finished yet.")
                    .foregroundStyle(.secondary)
            }
        } else {
            Section(c.current != nil ? "Pick the next book" : "Pick a book") {
                DatePicker("End date", selection: $endDate, displayedComponents: .date)
                    .onChange(of: endDate) { _, _ in endDateTouched = true }
                Button("Start poll") {
                    Task { await startPoll() }
                }
            }
            Text("Defaults to one day before the next meeting, and never runs past a week.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - loading & actions

    private func load() async {
        do {
            let fresh = try await APIClient.shared.club(id: clubId)
            club = fresh
            loadError = nil
            if !endDateTouched {
                let def = Dates.defaultPollEnd(meetingDate: fresh.meeting.date)
                let f = DateFormatter()
                f.locale = Locale(identifier: "en_US_POSIX")
                f.dateFormat = "yyyy-MM-dd"
                if let d = f.date(from: def) { endDate = d }
            }
        } catch {
            if club == nil { loadError = errorText(error) }
            else { errorMessage = errorText(error) }
        }
    }

    private func vote(bookKey: String) async {
        do {
            try await APIClient.shared.callDiscard("vote", ["clubId": clubId, "bookKey": bookKey])
            await load()
        } catch { errorMessage = errorText(error) }
    }

    private func closePoll() async {
        do {
            try await APIClient.shared.callDiscard("closePoll", ["clubId": clubId])
            dismiss()
        } catch { errorMessage = errorText(error) }
    }

    private func adminPick(bookKey: String) async {
        do {
            try await APIClient.shared.callDiscard("adminPick", ["clubId": clubId, "bookKey": bookKey])
            dismiss()
        } catch { errorMessage = errorText(error) }
    }

    private func runoff() async {
        do {
            try await APIClient.shared.callDiscard("runoff", ["clubId": clubId])
            await load()
        } catch { errorMessage = errorText(error) }
    }

    private func startPoll() async {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        let end = f.string(from: endDate)
        do {
            try await APIClient.shared.callDiscard("startPoll", ["clubId": clubId, "endDate": end])
            await load()
        } catch { errorMessage = errorText(error) }
    }
}
