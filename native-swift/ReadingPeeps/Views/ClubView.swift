import SwiftUI

/// The club screen, in Ajay's settled order:
/// Current book, Next book, Group meeting, Library. Settings is the
/// gear in the toolbar (admins); Leave club sits in the toolbar menu.
struct ClubView: View {
    let clubId: String
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var club: Club?
    @State private var loadError: String?
    @State private var errorMessage: String?

    // reading progress editor (sheet)
    @State private var serverPercent: Int = -1
    @State private var serverPage: Int = -1
    @State private var showingProgressEditor = false

    // discussion questions composers
    @State private var qGroupText = ""
    @State private var qMineText = ""

    // meeting editor (admin)
    @State private var editType = "online"
    @State private var editLink = ""
    @State private var editAddress = ""
    @State private var editTime = Date()
    @State private var editDate = Date()
    @State private var savedVisible = false
    @FocusState private var editorFocus: EditorField?
    @State private var confirmLeave = false
    @State private var showRevertPicker = false

    private enum EditorField { case link, address }

    private var myId: String { app.user?.id ?? "" }

    var body: some View {
        Group {
            if let club {
                List {
                    currentBookSection(club)
                    Section {
                        NavigationLink(value: Route.library(clubId)) {
                            Label("Library", systemImage: "books.vertical")
                        }
                    }
                    .listRowBackground(Color.rpCream)
                    nextBookSection(club)
                    meetingSection(club)
                    discussionSection(club)
                }
                .refreshable { await load() }
                .brandScreen()
            } else if let loadError {
                ContentUnavailableView("Could not load the club", systemImage: "exclamationmark.triangle", description: Text(loadError))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(club?.name ?? "Club")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let club {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if club.isAdmin {
                        NavigationLink(value: Route.settings(clubId)) {
                            Image(systemName: "gearshape")
                        }
                    }
                    Menu {
                        if club.isAdmin && (!(club.history ?? []).isEmpty || club.library.count > 1) {
                            Button { showRevertPicker = true } label: {
                                Label("Revert to a previous book", systemImage: "arrow.uturn.backward")
                            }
                        }
                        Button("Leave club", role: .destructive) { confirmLeave = true }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .task {
            app.trackUsage(clubId: clubId)
            APIClient.shared.track("page_view", page: "club", clubId: clubId)
            await load()
        }
        .errorAlert($errorMessage)
        .confirmationDialog("Leave \(club?.name ?? "this club")?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave", role: .destructive) { Task { await leave() } }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showRevertPicker) { revertPicker }
    }

    // MARK: - loading & syncing

    private func load() async {
        do {
            let fresh = try await APIClient.shared.club(id: clubId)
            club = fresh
            loadError = nil
            syncProgress(fresh)
            syncMeetingEditor(fresh)
        } catch {
            if club == nil { loadError = errorText(error) }
            else { errorMessage = errorText(error) }
        }
    }

    private func present(_ error: Error) {
        errorMessage = errorText(error)
    }

    private func syncProgress(_ c: Club) {
        guard let current = c.current else { return }
        let entry = c.progress?.first { $0.userId == myId }
        let percent = entry?.percent ?? (c.myFinished ? 100 : 0)
        let total = current.pageCount
        let page = entry?.page ?? (total != nil ? Int((Double(percent) / 100.0 * Double(total!)).rounded()) : 0)
        serverPercent = percent
        serverPage = page
    }

    private func syncMeetingEditor(_ c: Club) {
        editType = c.meeting.type
        editLink = c.meeting.link
        editAddress = c.meeting.address
        editTime = Dates.dateFromTime(c.meeting.time)
        if let d = localDate(fromDay: c.meeting.date) { editDate = d }
        else if let first = c.week.first, let d = localDate(fromDay: first) { editDate = d }
    }

    // DatePicker works in local time; convert with a local formatter.
    private func localDayString(_ d: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func localDate(fromDay s: String) -> Date? {
        guard !s.isEmpty else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: s)
    }

    // MARK: - current book

    @ViewBuilder
    private func currentBookSection(_ c: Club) -> some View {
        Section {
            if let current = c.current {
                VStack(alignment: .leading, spacing: 5) {
                    BookRowView(title: current.title, author: current.author, year: current.year,
                                cover: current.cover, ratings: ratingsText(for: current),
                                badge: (c.lastResult?.winner ?? nil) == current.key ? "Won the club vote" : nil,
                                coverWidth: 60)
                    if let result = c.lastResult, let winner = result.winner, winner == current.key {
                        ReactionChipsView(chips: c.pollReactions ?? []) { emoji in
                            Task { await react(type: "poll", bookKey: nil, subject: nil, emoji: emoji) }
                        }
                        .padding(.leading, 72)
                    }
                }
                if let s = current.synopsis, !s.isEmpty {
                    SynopsisView(text: s)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your rating")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    StarRatingView(rating: current.myRating) { value in
                        Task { await rate(bookKey: current.key, value: value) }
                    }
                }
                if let avg = current.memberAverage, let count = current.memberCount, count > 0 {
                    Text("Members ★ \(trimNumber(avg)) (\(count) rating\(count == 1 ? "" : "s"))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if !c.currentRatings.isEmpty {
                    DisclosureGroup("Ratings") {
                        ForEach(c.currentRatings, id: \.userId) { r in
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 10) {
                                    AvatarView(name: r.name, userId: r.userId)
                                    Text(r.userId == myId ? "You" : r.name)
                                        .font(.body.weight(.semibold))
                                        .lineLimit(1)
                                    if let rating = r.rating {
                                        Text("★ \(trimNumber(rating))")
                                            .font(.subheadline.weight(.bold))
                                            .foregroundStyle(Color.rpInk)
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 2)
                                            .background(Color.rpPill)
                                            .clipShape(Capsule())
                                    } else {
                                        Text("Not rated")
                                            .font(.subheadline)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                }
                                if r.rating != nil && r.userId != myId {
                                    ReactionChipsView(chips: r.reactions ?? []) { emoji in
                                        Task { await react(type: "rating", bookKey: current.key, subject: r.userId, emoji: emoji) }
                                    }
                                    .padding(.leading, 44)
                                }
                            }
                        }
                    }
                }
                Toggle("I finished reading", isOn: Binding(
                    get: { c.myFinished },
                    set: { _ in Task { await toggleFinished() } }
                ))
                Text("\(c.finishedBy.count) of \(c.members.count) finished")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Text("No book picked yet")
                    .foregroundStyle(.secondary)
            }
        } header: { rpSectionHeader("Current book") }
        .listRowBackground(Color.rpCream)
        if c.current != nil {
            progressSection(c)
        }
    }

    @ViewBuilder
    private func progressSection(_ c: Club) -> some View {
        let current = c.current!
        let total = current.pageCount
        Section {
            ForEach(orderedMembers(c), id: \.userId) { member in
                memberProgressRow(c, member: member)
            }
        } header: { rpSectionHeader("Reading progress") }
        .listRowBackground(Color.rpCream)
        .sheet(isPresented: $showingProgressEditor) {
            ProgressEditorSheet(
                total: total,
                initialPercent: max(serverPercent, 0),
                initialPage: max(serverPage, 0)
            ) { percent, page in
                Task {
                    if let page { await commitPage(page) }
                    else { await commitPercent(percent) }
                }
            }
        }
    }

    private func orderedMembers(_ c: Club) -> [Member] {
        c.members.sorted { a, b in
            (a.userId == myId ? 0 : 1) < (b.userId == myId ? 0 : 1)
        }
    }

    @ViewBuilder
    private func memberProgressRow(_ c: Club, member: Member) -> some View {
        let entry = c.progress?.first { $0.userId == member.userId }
        let finished = (entry?.percent ?? 0) >= 100 || c.finishedBy.contains(member.userId)
        let percent = entry?.percent ?? (finished ? 100 : 0)
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 10) {
                AvatarView(name: member.name, userId: member.userId)
                Text(member.userId == myId ? "You" : member.name)
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                progressStat(entry: entry, finished: finished)
                if member.userId == myId {
                    Button("Update") { showingProgressEditor = true }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
            }
            ProgressView(value: Double(percent), total: 100)
                .tint(finished ? .green : .rpTeal)
            if finished && member.userId != myId, let current = c.current {
                ReactionChipsView(chips: entry?.reactions ?? []) { emoji in
                    Task { await react(type: "finish", bookKey: current.key, subject: member.userId, emoji: emoji) }
                }
                .padding(.leading, 44)
            }
        }
    }

    @ViewBuilder
    private func progressStat(entry: ProgressEntry?, finished: Bool) -> some View {
        if finished {
            Text("Finished")
                .font(.body.weight(.bold))
                .foregroundStyle(.green)
        } else if let entry {
            HStack(spacing: 0) {
                Text("\(entry.percent)%")
                    .font(.body.weight(.bold))
                if let page = entry.page {
                    Text(" · p. \(page)")
                        .foregroundStyle(.secondary)
                }
            }
        } else {
            Text("Not started")
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - next book

    @ViewBuilder
    private func nextBookSection(_ c: Club) -> some View {
        if let poll = c.poll {
            Section {
                NavigationLink(value: Route.poll(clubId)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(pollTitle(c, poll: poll))
                            .font(.body)
                        Text(pollStatusLine(poll))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
            } header: { rpSectionHeader("Next book") }
            .listRowBackground(Color.rpCream)
        } else if let pending = c.pendingWinner {
            Section {
                VStack(alignment: .leading, spacing: 2) {
                    Text(pending.title)
                        .font(.body)
                    Text("Won the club vote. It becomes the current book when the meeting date is set.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            } header: { rpSectionHeader("Next book") }
            .listRowBackground(Color.rpCream)
        } else if let tie = c.lastResult?.tie, !tie.isEmpty {
            Section {
                NavigationLink(value: Route.poll(clubId)) {
                    Label("Poll tied", systemImage: "chart.bar")
                }
            } header: { rpSectionHeader("Next book") }
            .listRowBackground(Color.rpCream)
        } else if c.library.isEmpty {
            Section {
                NavigationLink(value: Route.library(clubId)) {
                    Label("Add books to the library", systemImage: "plus")
                }
            } header: { rpSectionHeader("Next book") }
            .listRowBackground(Color.rpCream)
        } else if c.pollCandidates.count == 1, let only = c.pollCandidates.first {
            Section {
                Button("Pick \(only.title)") {
                    Task { await pickOnly(only) }
                }
            } header: { rpSectionHeader("Next book") }
            .listRowBackground(Color.rpCream)
        } else if c.pollCandidates.count >= 2 && c.isAdmin {
            Section {
                NavigationLink(value: Route.poll(clubId)) {
                    Label("Start a poll", systemImage: "chart.bar")
                }
            } header: { rpSectionHeader("Next book") }
            .listRowBackground(Color.rpCream)
        }
    }

    private func pollTitle(_ c: Club, poll: Poll) -> String {
        var t = c.current != nil ? "Pick the next book" : "Pick a book"
        if poll.runoff { t += " · Runoff" }
        return t
    }

    private func pollStatusLine(_ poll: Poll) -> String {
        var line: String
        if poll.totalVotes > 0, let leader = poll.options.max(by: { $0.votes < $1.votes }) {
            line = "\(leader.book.title) leads · \(poll.totalVotes) vote\(poll.totalVotes == 1 ? "" : "s")"
        } else {
            line = "No votes yet"
        }
        if let myVote = poll.myVote, let mine = poll.options.first(where: { $0.book.key == myVote }) {
            line += " · Your vote: \(mine.book.title)"
        }
        let closes = Dates.shortDate(iso: poll.closesAt)
        if !closes.isEmpty { line += " · Closes \(closes)" }
        return line
    }

    // MARK: - discussion questions

    @ViewBuilder
    private func discussionSection(_ c: Club) -> some View {
        if c.current != nil, let d = c.discussion {
            Section {
                Text("For the group")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if d.group.isEmpty {
                    Text("No questions yet")
                        .foregroundStyle(.secondary)
                }
                ForEach(d.group) { q in
                    HStack(alignment: .top, spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(q.text)
                            if let by = q.byName, !by.isEmpty {
                                Text(by)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if q.mine == true || c.isAdmin {
                            Button("Remove") {
                                Task { await removeQuestion(id: q.id, scope: "group") }
                            }
                            .font(.subheadline)
                        }
                    }
                }
                HStack {
                    TextField("Add a question for the group", text: $qGroupText)
                    Button { Task { await addQuestion(scope: "group") } } label: {
                        Image(systemName: "plus")
                            .font(.body.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(Color.rpCoral)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(qGroupText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                Text("Yours, only you see these")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if d.mine.isEmpty {
                    Text("None yet")
                        .foregroundStyle(.secondary)
                }
                ForEach(d.mine) { q in
                    HStack(alignment: .top, spacing: 8) {
                        Text(q.text)
                        Spacer()
                        Button("Remove") {
                            Task { await removeQuestion(id: q.id, scope: "private") }
                        }
                        .font(.subheadline)
                    }
                }
                HStack {
                    TextField("Add a private question", text: $qMineText)
                    Button { Task { await addQuestion(scope: "private") } } label: {
                        Image(systemName: "plus")
                            .font(.body.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(Color.rpCoral)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(qMineText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } header: { rpSectionHeader("Discussion questions") }
            .listRowBackground(Color.rpCream)
        }
    }

    // MARK: - group meeting

    @ViewBuilder
    private func meetingSection(_ c: Club) -> some View {
        Section {
            Text("Meets every \(c.meetingFrequencyWeeks) week\(c.meetingFrequencyWeeks > 1 ? "s" : "")")
                .foregroundStyle(.secondary)

            if c.week.count == 7 {
                weekHeader(c)
            }

            if !c.meeting.date.isEmpty {
                meetingSetRows(c)
            } else {
                availabilityRows(c)
            }

            if c.meeting.type == "online" {
                if !c.meeting.link.isEmpty, let url = URL(string: c.meeting.link) {
                    Link("Join online", destination: url)
                } else {
                    Text("Online")
                        .foregroundStyle(.secondary)
                }
            } else {
                if !c.meeting.address.isEmpty {
                    Label(c.meeting.address, systemImage: "mappin.and.ellipse")
                        .foregroundStyle(.secondary)
                } else {
                    Text("In person")
                        .foregroundStyle(.secondary)
                }
            }

            if c.isAdmin {
                meetingEditor(c)
            }
        } header: { rpSectionHeader("Group meeting") }
        .listRowBackground(Color.rpCream)
    }

    @ViewBuilder
    private func weekHeader(_ c: Club) -> some View {
        let first = c.week.first!
        let last = c.week.last!
        if c.isAdmin {
            HStack(spacing: 8) {
                Button {
                    Task { await shiftWeek(-1) }
                } label: {
                    Text("‹ \(Dates.rangeLabel(first: Dates.shiftDay(first, by: -7), last: Dates.shiftDay(last, by: -7)))")
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                Text(Dates.rangeLabel(first: first, last: last))
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                Button {
                    Task { await shiftWeek(1) }
                } label: {
                    Text("\(Dates.rangeLabel(first: Dates.shiftDay(first, by: 7), last: Dates.shiftDay(last, by: 7))) ›")
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .font(.subheadline)
        } else {
            HStack {
                Spacer()
                Text(Dates.rangeLabel(first: first, last: last))
                    .font(.body.weight(.semibold))
                Spacer()
            }
        }
    }

    @ViewBuilder
    private func meetingSetRows(_ c: Club) -> some View {
        let time = Dates.timeLabel(c.meeting.time)
        Text(time.isEmpty ? Dates.longDate(c.meeting.date) : "\(Dates.longDate(c.meeting.date)) · \(time)")
            .font(.body.weight(.semibold))
        HStack(spacing: 10) {
            RSVPButton(title: "Going", selected: c.rsvps[myId] == "going") {
                Task { await rsvp("going") }
            }
            RSVPButton(title: "Not going", selected: c.rsvps[myId] == "notgoing") {
                Task { await rsvp("notgoing") }
            }
            Spacer()
        }
        let going = c.members.filter { c.rsvps[$0.userId] == "going" }
        let notGoing = c.members.filter { c.rsvps[$0.userId] == "notgoing" }
        if !going.isEmpty || !notGoing.isEmpty {
            DisclosureGroup("\(going.count) going") {
                ForEach(going, id: \.userId) { m in
                    HStack { Text(m.userId == myId ? "You" : m.name); Spacer(); Text("Going").foregroundStyle(.secondary) }
                }
                ForEach(notGoing, id: \.userId) { m in
                    HStack { Text(m.userId == myId ? "You" : m.name); Spacer(); Text("Not going").foregroundStyle(.secondary) }
                }
            }
        }
    }

    @ViewBuilder
    private func availabilityRows(_ c: Club) -> some View {
        Text("Pick the days you are available")
            .font(.subheadline)
            .foregroundStyle(.secondary)
        let mine = Set(c.availability[myId] ?? [])
        HStack(spacing: 6) {
            ForEach(c.week, id: \.self) { day in
                let count = c.availability.values.filter { $0.contains(day) }.count
                Button {
                    Task { await toggleDay(day) }
                } label: {
                    VStack(spacing: 2) {
                        Text(Dates.weekdayShort(day))
                            .font(.caption2)
                        Text(Dates.dayNumber(day))
                            .font(.body.weight(.semibold))
                        Text(count > 0 ? "\(count) ✓" : " ")
                            .font(.caption2)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 7)
                    .background(mine.contains(day) ? Color.rpCoral : Color.secondary.opacity(0.12))
                    .foregroundStyle(mine.contains(day) ? .white : .primary)
                    .clipShape(RoundedRectangle(cornerRadius: 9))
                }
                .buttonStyle(.plain)
            }
        }
        if c.isAdmin {
            adminAvailabilitySummary(c)
        }
    }

    @ViewBuilder
    private func adminAvailabilitySummary(_ c: Club) -> some View {
        let counts = c.week.map { day in (day: day, count: c.availability.values.filter { $0.contains(day) }.count) }
        let best = counts.max(by: { $0.count < $1.count })
        if let best, best.count > 0 {
            Text("Most available: \(Dates.longDate(best.day)) · \(best.count) of \(c.members.count)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            ForEach(counts.filter { $0.count > 0 }, id: \.day) { item in
                let names = c.members.filter { (c.availability[$0.userId] ?? []).contains(item.day) }
                    .map { $0.userId == myId ? "You" : $0.name }
                HStack {
                    Text(Dates.longDate(item.day))
                    Spacer()
                    Text(names.joined(separator: ", "))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .font(.caption)
            }
        } else {
            Text("Nobody has answered yet")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func meetingEditor(_ c: Club) -> some View {
        // The pickers write through custom bindings whose setters fire only on
        // user interaction; load() syncs the backing state directly, so a
        // reload can never trigger a save by itself.
        Group {
            DatePicker("Meeting date", selection: dateBinding(c), in: dateRange(c), displayedComponents: .date)
            DatePicker("Time", selection: timeBinding(c), displayedComponents: .hourAndMinute)
            Picker("Where", selection: typeBinding(c)) {
                Text("Online").tag("online")
                Text("In person").tag("inperson")
            }
            .pickerStyle(.segmented)
            if editType == "online" {
                TextField("Meeting link", text: $editLink)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .focused($editorFocus, equals: .link)
                    .onSubmit { Task { await saveMeeting() } }
            } else {
                TextField("Address", text: $editAddress)
                    .focused($editorFocus, equals: .address)
                    .onSubmit { Task { await saveMeeting() } }
            }
            if savedVisible {
                Text("Saved")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .onChange(of: editorFocus) { old, _ in
            if old != nil {
                Task { await saveMeeting() }
            }
        }
    }

    private func dateBinding(_ c: Club) -> Binding<Date> {
        Binding(
            get: { editDate },
            set: { new in
                editDate = new
                let day = localDayString(new)
                if day != c.meeting.date {
                    Task { await pickDate(day) }
                }
            }
        )
    }

    private func timeBinding(_ c: Club) -> Binding<Date> {
        Binding(
            get: { editTime },
            set: { new in
                editTime = new
                if Dates.timeString(new) != (c.meeting.time ?? "") {
                    Task { await saveMeeting() }
                }
            }
        )
    }

    private func typeBinding(_ c: Club) -> Binding<String> {
        Binding(
            get: { editType },
            set: { new in
                editType = new
                if new != c.meeting.type {
                    Task { await saveMeeting() }
                }
            }
        )
    }

    private func dateRange(_ c: Club) -> ClosedRange<Date> {
        let start = localDate(fromDay: c.week.first ?? "") ?? Date()
        let end = localDate(fromDay: Dates.shiftDay(c.week.last ?? "", by: 28)) ?? start.addingTimeInterval(28 * 86400)
        return start...end
    }

    // MARK: - actions

    private func react(type: String, bookKey: String?, subject: String?, emoji: String) async {
        var params: [String: Any] = ["clubId": clubId, "type": type, "emoji": emoji]
        if let bookKey { params["bookKey"] = bookKey }
        if let subject { params["subjectUserId"] = subject }
        do {
            try await APIClient.shared.callDiscard("react", params)
            await load()
        } catch { present(error) }
    }

    private func addQuestion(scope: String) async {
        let text = (scope == "group" ? qGroupText : qMineText).trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        do {
            try await APIClient.shared.callDiscard("addDiscussionQuestion", ["clubId": clubId, "text": text, "scope": scope])
            if scope == "group" { qGroupText = "" } else { qMineText = "" }
            await load()
        } catch { present(error) }
    }

    private func removeQuestion(id: String, scope: String) async {
        do {
            try await APIClient.shared.callDiscard("removeDiscussionQuestion", ["clubId": clubId, "questionId": id, "scope": scope])
            await load()
        } catch { present(error) }
    }

    private func rate(bookKey: String, value: Double) async {
        do {
            try await APIClient.shared.callDiscard("rate", ["bookKey": bookKey, "rating": value])
            await load()
        } catch { present(error) }
    }

    private func toggleFinished() async {
        guard let c = club, let current = c.current else { return }
        do {
            if c.myFinished {
                // Un-finishing drops the flag only; progress stays as is.
                try await APIClient.shared.callDiscard("toggleFinished", ["clubId": clubId])
            } else {
                // Finishing means the book is done: progress goes to 100
                // percent, the server derives the final page from the
                // book's page count, and 100 percent adds the finished
                // entry on the server by itself.
                try await withRetry {
                    try await APIClient.shared.callDiscard("setProgress", ["clubId": c.id, "bookKey": current.key, "percent": 100])
                }
            }
            await load()
            await app.refreshClubs()
        } catch { present(error) }
    }

    private func commitPercent(_ percent: Int) async {
        guard let c = club, let current = c.current else { return }
        let clamped = min(100, max(0, percent))
        do {
            try await withRetry {
                try await APIClient.shared.callDiscard("setProgress", ["clubId": c.id, "bookKey": current.key, "percent": clamped])
            }
            APIClient.shared.track("progress_set", page: "club", feature: "progress", clubId: c.id)
            await load()
        } catch { present(error) }
    }

    private func commitPage(_ page: Int) async {
        guard let c = club, let current = c.current, let total = current.pageCount else { return }
        let clamped = min(total, max(0, page))
        do {
            try await withRetry {
                try await APIClient.shared.callDiscard("setProgress", ["clubId": c.id, "bookKey": current.key, "page": clamped])
            }
            APIClient.shared.track("progress_set", page: "club", feature: "progress", clubId: c.id)
            await load()
        } catch { present(error) }
    }

    private func revertRow(_ book: Book) -> some View {
        Button(book.title) {
            showRevertPicker = false
            Task { await revertTo(book) }
        }
        .foregroundStyle(.primary)
    }

    private var revertPicker: some View {
        NavigationStack {
            List {
                if let hist = club?.history, !hist.isEmpty {
                    Section("Previous books") {
                        ForEach(hist, id: \.key) { book in revertRow(book) }
                    }
                }
                let histKeys = Set((club?.history ?? []).map { $0.key })
                let others = (club?.library ?? []).filter { $0.key != club?.current?.key && !histKeys.contains($0.key) }
                if !others.isEmpty {
                    Section("Library") {
                        ForEach(others, id: \.key) { book in revertRow(book) }
                    }
                }
            }
            .brandScreen()
            .navigationTitle("Revert to a previous book")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showRevertPicker = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func revertTo(_ book: Book) async {
        do {
            try await withRetry {
                try await APIClient.shared.callDiscard("revertTo", ["clubId": clubId, "bookKey": book.key])
            }
            await load()
            await app.refreshClubs()
        } catch { present(error) }
    }

    private func pickOnly(_ book: Book) async {
        do {
            try await withRetry {
                try await APIClient.shared.callDiscard("setCurrent", ["clubId": clubId, "bookKey": book.key])
            }
            await load()
            await app.refreshClubs()
        } catch { present(error) }
    }

    private func toggleDay(_ day: String) async {
        guard let c = club else { return }
        var mine = Set(c.availability[myId] ?? [])
        if mine.contains(day) { mine.remove(day) } else { mine.insert(day) }
        do {
            try await APIClient.shared.callDiscard("availability", ["clubId": clubId, "days": Array(mine)])
            await load()
        } catch { present(error) }
    }

    private func rsvp(_ status: String) async {
        guard let c = club else { return }
        let current = c.rsvps[myId]
        do {
            try await APIClient.shared.callDiscard("rsvp", ["clubId": clubId, "status": current == status ? "" : status])
            await load()
        } catch { present(error) }
    }

    private func shiftWeek(_ weeks: Int) async {
        do {
            try await APIClient.shared.callDiscard("shiftMeetingWeek", ["clubId": clubId, "weeks": weeks])
            await load()
        } catch { present(error) }
    }

    private func pickDate(_ day: String) async {
        do {
            try await APIClient.shared.callDiscard("pickDate", ["clubId": clubId, "date": day])
            await load()
        } catch { present(error) }
    }

    /// Autosaves the meeting editor fields (type, link, address, time) through
    /// clubSettings, like the web editor. The date itself goes through pickDate.
    private func saveMeeting() async {
        guard let c = club else { return }
        let time = Dates.timeString(editTime)
        if editType == c.meeting.type, editLink == c.meeting.link,
           editAddress == c.meeting.address, time == (c.meeting.time ?? "") {
            return
        }
        do {
            let updated = try await APIClient.shared.clubSettings(clubId: clubId, [
                "meeting": [
                    "type": editType,
                    "link": editLink,
                    "address": editAddress,
                    "time": time,
                ],
            ])
            club = updated
            syncProgress(updated)
            savedVisible = true
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            savedVisible = false
        } catch { present(error) }
    }

    private func leave() async {
        do {
            try await APIClient.shared.callDiscard("leaveClub", ["clubId": clubId])
            await app.refreshClubs()
            dismiss()
        } catch { present(error) }
    }
}

/// The Update progress sheet: a slider and a page stepper kept in sync,
/// committed on Done. With a page count the displayed page is what gets
/// saved; without one, the percent is.
private struct ProgressEditorSheet: View {
    let total: Int?
    let initialPercent: Int
    let initialPage: Int
    var onCommit: (_ percent: Int, _ page: Int?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var percent: Double = 0
    @State private var page: Int = 0
    @State private var savedTick = 0

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Text("Percent")
                        Spacer()
                        Text("\(Int(percent.rounded()))%")
                            .foregroundStyle(.secondary)
                    }
                    Slider(value: $percent, in: 0...100, step: 1)
                        .tint(.rpTeal)
                        .onChange(of: percent) { _, new in
                            if let total {
                                page = Int((new / 100.0 * Double(total)).rounded())
                            }
                        }
                    if let total {
                        Stepper("Page \(page) of \(total)", value: $page, in: 0...total)
                            .onChange(of: page) { _, new in
                                percent = total > 0 ? Double(new) / Double(total) * 100.0 : 0
                            }
                    }
                } header: { rpSectionHeader("Your progress") }
                .listRowBackground(Color.rpCream)
            }
            .navigationTitle("Update progress")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        onCommit(Int(percent.rounded()), total != nil ? page : nil)
                        savedTick += 1
                        dismiss()
                    } label: {
                        Image(systemName: "checkmark")
                    }
                    .tint(.rpCoral)
                }
            }
            .onAppear {
                percent = Double(initialPercent)
                page = initialPage
            }
            .sensoryFeedback(.success, trigger: savedTick)
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}

private struct RSVPButton: View {
    let title: String
    let selected: Bool
    var action: () -> Void

    var body: some View {
        if selected {
            Button(title, action: action).buttonStyle(.borderedProminent)
        } else {
            Button(title, action: action).buttonStyle(.bordered)
        }
    }
}

/// 4.25 -> "4.25", 4.0 -> "4"
func trimNumber(_ v: Double) -> String {
    if v == v.rounded() { return String(Int(v)) }
    return String(format: "%.1f", v)
}
