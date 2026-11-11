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

    // reading progress editor
    @State private var myPercent: Double = 0
    @State private var percentValue: Int = 0
    @State private var pageValue: Int = 0
    @State private var serverPercent: Int = -1
    @State private var serverPage: Int = -1

    // meeting editor (admin)
    @State private var editType = "online"
    @State private var editLink = ""
    @State private var editAddress = ""
    @State private var editTime = Date()
    @State private var editDate = Date()
    @State private var savedVisible = false
    @FocusState private var editorFocus: EditorField?
    @State private var confirmLeave = false

    private enum EditorField { case link, address }

    private var myId: String { app.user?.id ?? "" }

    var body: some View {
        Group {
            if let club {
                List {
                    currentBookSection(club)
                    nextBookSection(club)
                    meetingSection(club)
                    Section {
                        NavigationLink(value: Route.library(clubId)) {
                            Label("Library", systemImage: "books.vertical")
                        }
                    }
                }
                .refreshable { await load() }
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
                        Button("Leave club", role: .destructive) { confirmLeave = true }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
        }
        .task {
            app.trackUsage(clubId: clubId)
            await load()
        }
        .errorAlert($errorMessage)
        .confirmationDialog("Leave \(club?.name ?? "this club")?", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave", role: .destructive) { Task { await leave() } }
            Button("Cancel", role: .cancel) {}
        }
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
        myPercent = Double(percent)
        percentValue = percent
        pageValue = page
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
        Section("Current book") {
            if let current = c.current {
                BookRowView(title: current.title, author: current.author, year: current.year,
                            cover: current.cover, ratings: ratingsText(for: current), coverWidth: 60)
                if let avg = current.memberAverage, let count = current.memberCount, count > 0 {
                    Text("Members ★ \(trimNumber(avg)) (\(count) rating\(count == 1 ? "" : "s"))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Your rating")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    StarRatingView(rating: current.myRating) { value in
                        Task { await rate(bookKey: current.key, value: value) }
                    }
                }
                Toggle("I finished reading", isOn: Binding(
                    get: { c.myFinished },
                    set: { _ in Task { await toggleFinished() } }
                ))
                let rated = c.currentRatings.filter { $0.rating != nil }
                let avg = rated.isEmpty ? nil : rated.reduce(0.0) { $0 + ($1.rating ?? 0) } / Double(rated.count)
                HStack {
                    Text("\(c.finishedBy.count) of \(c.members.count) finished")
                    Spacer()
                    if let avg {
                        Text("Average ★ \(trimNumber(avg))")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                if !c.currentRatings.isEmpty {
                    DisclosureGroup("Ratings") {
                        ForEach(c.currentRatings, id: \.userId) { r in
                            HStack {
                                Text(r.userId == myId ? "You" : r.name)
                                Spacer()
                                Text(r.rating != nil ? "★ \(trimNumber(r.rating!))" : "—")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } else {
                Text("No book picked yet")
                    .foregroundStyle(.secondary)
            }
        }
        if c.current != nil {
            progressSection(c)
        }
    }

    @ViewBuilder
    private func progressSection(_ c: Club) -> some View {
        let current = c.current!
        let total = current.pageCount
        Section("Reading progress") {
            HStack {
                Text("You")
                    .font(.body.weight(.semibold))
                Spacer()
                Text("\(percentValue)%")
                    .foregroundStyle(.secondary)
            }
            Slider(value: $myPercent, in: 0...100, step: 1, onEditingChanged: { editing in
                if !editing {
                    Task { await commitPercent(Int(myPercent.rounded())) }
                }
            })
            .tint(.rpTeal)
            .onChange(of: myPercent) { _, new in
                percentValue = Int(new.rounded())
                if let total {
                    pageValue = Int((new / 100.0 * Double(total)).rounded())
                }
            }
            if let total {
                HStack {
                    Text("Page")
                    TextField("Page", value: $pageValue, format: .number)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 70)
                        .onSubmit { Task { await commitPage(pageValue) } }
                    Text("of \(total)")
                        .foregroundStyle(.secondary)
                    Spacer()
                    Stepper("Page", value: $pageValue, in: 0...total)
                        .labelsHidden()
                        .onChange(of: pageValue) { _, new in
                            // Ignore echoes from the slider; a real step diverges
                            // from the slider-derived page and from the server page.
                            let derived = Int((myPercent / 100.0 * Double(total)).rounded())
                            if new != derived && new != serverPage {
                                Task { await commitPage(new) }
                            }
                        }
                }
            }
            HStack {
                Text("Percent")
                TextField("Percent", value: $percentValue, format: .number)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 70)
                    .onSubmit { Task { await commitPercent(percentValue) } }
                Text("%")
                    .foregroundStyle(.secondary)
                Spacer()
                Stepper("Percent", value: $percentValue, in: 0...100)
                    .labelsHidden()
                    .onChange(of: percentValue) { _, new in
                        if new != Int(myPercent.rounded()) && new != serverPercent {
                            Task { await commitPercent(new) }
                        }
                    }
            }
            ForEach(orderedMembers(c), id: \.userId) { member in
                memberProgressRow(c, member: member)
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
        HStack(spacing: 10) {
            Text(member.userId == myId ? "You" : member.name)
                .frame(width: 92, alignment: .leading)
                .lineLimit(1)
            ProgressView(value: Double(percent), total: 100)
                .tint(finished ? .green : .rpTeal)
            Text(progressLabel(entry: entry, finished: finished))
                .font(.caption)
                .foregroundStyle(finished ? .green : .secondary)
                .frame(width: 96, alignment: .trailing)
        }
    }

    private func progressLabel(entry: ProgressEntry?, finished: Bool) -> String {
        if finished { return "Finished" }
        guard let entry else { return "Not started" }
        if let page = entry.page { return "p. \(page) · \(entry.percent)%" }
        return "\(entry.percent)%"
    }

    // MARK: - next book

    @ViewBuilder
    private func nextBookSection(_ c: Club) -> some View {
        if let poll = c.poll {
            Section("Next book") {
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
            }
        } else if let tie = c.lastResult?.tie, !tie.isEmpty {
            Section("Next book") {
                NavigationLink(value: Route.poll(clubId)) {
                    Label("Poll tied", systemImage: "chart.bar")
                }
            }
        } else if c.library.isEmpty {
            Section("Next book") {
                NavigationLink(value: Route.library(clubId)) {
                    Label("Add books to the library", systemImage: "plus")
                }
            }
        } else if c.pollCandidates.count == 1, let only = c.pollCandidates.first {
            Section("Next book") {
                Button("Pick \(only.title)") {
                    Task { await pickOnly(only) }
                }
            }
        } else if c.pollCandidates.count >= 2 && c.isAdmin {
            Section("Next book") {
                NavigationLink(value: Route.poll(clubId)) {
                    Label("Start a poll", systemImage: "chart.bar")
                }
            }
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

    // MARK: - group meeting

    @ViewBuilder
    private func meetingSection(_ c: Club) -> some View {
        Section("Group meeting") {
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
        }
    }

    @ViewBuilder
    private func weekHeader(_ c: Club) -> some View {
        let first = c.week.first!
        let last = c.week.last!
        if c.isAdmin {
            HStack {
                Button {
                    Task { await shiftWeek(-1) }
                } label: {
                    Text("‹ \(Dates.rangeLabel(first: Dates.shiftDay(first, by: -7), last: Dates.shiftDay(last, by: -7)))")
                }
                .buttonStyle(.bordered)
                Spacer()
                Text(Dates.rangeLabel(first: first, last: last))
                    .font(.body.weight(.semibold))
                    .lineLimit(1)
                Spacer()
                Button {
                    Task { await shiftWeek(1) }
                } label: {
                    Text("\(Dates.rangeLabel(first: Dates.shiftDay(first, by: 7), last: Dates.shiftDay(last, by: 7))) ›")
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
            await load()
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
