import SwiftUI

/// Explore: find a public club with the same facets the API supports, or
/// create a club. Finding and creating live here, not on the home screen.
struct ExploreView: View {
    @EnvironmentObject var app: AppState
    @State private var tab = 0  // 0 = find, 1 = create

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Picker("Explore", selection: $tab) {
                    Text("Find a club").tag(0)
                    Text("Create a club").tag(1)
                }
                .pickerStyle(.segmented)
                .padding()
                if tab == 0 {
                    FindClubsView()
                } else {
                    CreateClubView()
                }
            }
            .navigationTitle("Explore")
        }
    }
}

// MARK: - genre multi-select sheet

struct GenrePickerSheet: View {
    @Binding var selected: Set<String>
    var cap: Int = 0  // 0 = no cap
    @Environment(\.dismiss) private var dismiss
    @State private var notice: String?

    var body: some View {
        NavigationStack {
            List {
                if let notice {
                    Text(notice)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                ForEach(GENRES, id: \.self) { genre in
                    Button {
                        if selected.contains(genre) {
                            selected.remove(genre)
                        } else if cap > 0 && selected.count >= cap {
                            notice = "Up to \(cap) genres"
                        } else {
                            selected.insert(genre)
                        }
                    } label: {
                        HStack {
                            Text(genre)
                                .foregroundStyle(.primary)
                            Spacer()
                            if selected.contains(genre) {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(Color.rpCoral)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Genres")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

// MARK: - find

private struct FindClubsView: View {
    @EnvironmentObject var app: AppState
    @State private var name = ""
    @State private var format = "any"  // any | online | in-person
    @State private var genres: Set<String> = []
    @State private var audience = ""   // "" = any
    @State private var specialty = ""
    @State private var place: Place?
    @State private var radiusKm = 25
    @State private var results: [Club] = []
    @State private var hasSearched = false
    @State private var searching = false
    @State private var errorMessage: String?
    @State private var showGenres = false
    @State private var inviteText = ""
    @State private var inviteMessage: String?

    var body: some View {
        List {
            Section {
                TextField("Club name", text: $name)
                    .autocorrectionDisabled()
                Picker("Format", selection: $format) {
                    Text("Any").tag("any")
                    Text("Online").tag("online")
                    Text("In person").tag("in-person")
                }
                .pickerStyle(.segmented)
                Button {
                    showGenres = true
                } label: {
                    HStack {
                        Text("Genres")
                            .foregroundStyle(.primary)
                        Spacer()
                        Text(genres.isEmpty ? "Any" : "\(genres.count) picked")
                            .foregroundStyle(.secondary)
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Picker("Audience", selection: $audience) {
                    Text("Any").tag("")
                    ForEach(AUDIENCES, id: \.self) { a in Text(a).tag(a) }
                }
                TextField("Specialty", text: $specialty)
                    .autocorrectionDisabled()
                Picker("Near", selection: $place) {
                    Text("Anywhere").tag(Place?.none)
                    ForEach(PLACES) { p in Text(p.label).tag(Place?.some(p)) }
                }
                if place != nil {
                    Picker("Distance", selection: $radiusKm) {
                        Text("10 km").tag(10)
                        Text("25 km").tag(25)
                        Text("50 km").tag(50)
                    }
                    .pickerStyle(.segmented)
                }
                Button {
                    Task { await search() }
                } label: {
                    HStack {
                        Spacer()
                        if searching { ProgressView() } else { Text("Search") }
                        Spacer()
                    }
                }
                .disabled(searching)
            }

            if hasSearched {
                Section("Results") {
                    if results.isEmpty {
                        Text("No clubs match")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(results) { club in
                        resultRow(club)
                    }
                }
            }

            Section("Have an invite?") {
                TextField("Invite link or code", text: $inviteText)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Button("Join with invite") {
                    Task { await joinWithInvite() }
                }
                .disabled(inviteText.trimmingCharacters(in: .whitespaces).isEmpty)
                if let inviteMessage {
                    Text(inviteMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .sheet(isPresented: $showGenres) {
            GenrePickerSheet(selected: $genres)
        }
        .errorAlert($errorMessage)
        .task { await search() }
    }

    @ViewBuilder
    private func resultRow(_ club: Club) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(club.name)
                Text(resultSubtitle(club))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let genres = club.genres, !genres.isEmpty {
                    Text(genres.joined(separator: ", "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let audience = club.audience, !audience.isEmpty {
                    Text(audience)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let specialty = club.specialty, !specialty.isEmpty {
                    Text(specialty)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if club.isMember {
                Text("Joined")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Button("Join") {
                    Task { await join(club) }
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private func resultSubtitle(_ club: Club) -> String {
        var s = "\(club.memberCount) member\(club.memberCount == 1 ? "" : "s")"
        if club.format == "in-person" {
            s += " · \(club.location?.label ?? "In person")"
        } else {
            s += " · Online"
        }
        return s
    }

    private func baseParams() -> [String: Any] {
        var base: [String: Any] = [:]
        let q = name.trimmingCharacters(in: .whitespaces)
        if !q.isEmpty { base["q"] = q }
        if format != "any" { base["format"] = format }
        if !audience.isEmpty { base["audience"] = audience }
        let sp = specialty.trimmingCharacters(in: .whitespaces)
        if !sp.isEmpty { base["specialty"] = sp }
        if let place {
            base["near"] = ["lat": place.lat, "lng": place.lng, "radiusKm": radiusKm]
        }
        return base
    }

    private func search() async {
        searching = true
        do {
            let base = baseParams()
            var clubs: [Club]
            if genres.isEmpty {
                clubs = try await APIClient.shared.searchClubs(base)
            } else {
                // The API takes one genre per call; intersect client-side,
                // the same approach as the web app.
                var acc: [Club]?
                for genre in genres {
                    var params = base
                    params["genre"] = genre
                    let hits = try await APIClient.shared.searchClubs(params)
                    acc = acc == nil ? hits : acc!.filter { c in hits.contains { $0.id == c.id } }
                }
                clubs = acc ?? []
            }
            results = clubs
            hasSearched = true
        } catch {
            errorMessage = errorText(error)
        }
        searching = false
    }

    private func join(_ club: Club) async {
        do {
            try await APIClient.shared.callDiscard("joinClub", ["clubId": club.id])
            await app.refreshClubs()
            await search()
        } catch { errorMessage = errorText(error) }
    }

    private func joinWithInvite() async {
        let raw = inviteText.trimmingCharacters(in: .whitespaces)
        var token = raw
        if let range = raw.range(of: "invite=", options: .caseInsensitive) {
            token = String(raw[range.upperBound...]).split(separator: "&").first.map(String.init) ?? token
        } else if raw.count > 20, raw.contains("/") {
            token = raw.split(separator: "/").last.map(String.init) ?? raw
        }
        do {
            let club = try await APIClient.shared.acceptInvite(token: token)
            inviteText = ""
            inviteMessage = "Joined \(club.name)"
            await app.refreshClubs()
        } catch {
            inviteMessage = errorText(error)
        }
    }
}

// MARK: - create

private struct CreateClubView: View {
    @EnvironmentObject var app: AppState
    @State private var name = ""
    @State private var isPrivate = true
    @State private var format = "online"
    @State private var place: Place?
    @State private var genres: Set<String> = []
    @State private var audience = ""
    @State private var specialty = ""
    @State private var showGenres = false
    @State private var errorMessage: String?
    @State private var createdMessage: String?
    @State private var busy = false

    var body: some View {
        List {
            Section {
                TextField("Club name", text: $name)
            }
            Section("Visibility") {
                Picker("Visibility", selection: $isPrivate) {
                    Text("Private").tag(true)
                    Text("Public").tag(false)
                }
                .pickerStyle(.segmented)
            }
            Section("Format") {
                Picker("Format", selection: $format) {
                    Text("Online").tag("online")
                    Text("In person").tag("in-person")
                }
                .pickerStyle(.segmented)
                if format == "in-person" {
                    Picker("Place", selection: $place) {
                        Text("Pick a place").tag(Place?.none)
                        ForEach(PLACES) { p in Text(p.label).tag(Place?.some(p)) }
                    }
                }
            }
            Section {
                Button {
                    showGenres = true
                } label: {
                    HStack {
                        Text("Genres")
                            .foregroundStyle(.primary)
                        Spacer()
                        Text(genres.isEmpty ? "None" : "\(genres.count) picked")
                            .foregroundStyle(.secondary)
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Picker("Audience", selection: $audience) {
                    Text("Not set").tag("")
                    ForEach(AUDIENCES, id: \.self) { a in Text(a).tag(a) }
                }
                TextField("Specialty (optional)", text: $specialty)
            }
            if let createdMessage {
                Section {
                    Text(createdMessage)
                        .foregroundStyle(.secondary)
                }
            }
            Section {
                Button {
                    Task { await create() }
                } label: {
                    HStack {
                        Spacer()
                        if busy { ProgressView() } else { Text("Create club") }
                        Spacer()
                    }
                }
                .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || (format == "in-person" && place == nil))
            }
        }
        .sheet(isPresented: $showGenres) {
            GenrePickerSheet(selected: $genres, cap: 8)
        }
        .errorAlert($errorMessage)
    }

    private func create() async {
        busy = true
        createdMessage = nil
        do {
            var payload: [String: Any] = [
                "name": name.trimmingCharacters(in: .whitespaces),
                "private": isPrivate,
                "format": format,
                "genres": Array(genres),
                "audience": audience,
                "specialty": specialty.trimmingCharacters(in: .whitespaces),
            ]
            if format == "in-person", let place {
                payload["location"] = ["label": place.label, "lat": place.lat, "lng": place.lng]
            }
            let club = try await APIClient.shared.createClub(payload)
            name = ""
            genres = []
            audience = ""
            specialty = ""
            place = nil
            createdMessage = "\(club.name) is created. It is in your Clubs list."
            await app.refreshClubs()
        } catch {
            errorMessage = errorText(error)
        }
        busy = false
    }
}
