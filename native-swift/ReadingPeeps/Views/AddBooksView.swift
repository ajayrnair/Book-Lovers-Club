import SwiftUI

/// Add books: pick target clubs, search and tap to select, or add by link.
/// Used as a tab (no preset) and as a sheet from a club's library (preset).
struct AddBooksView: View {
    var presetClubId: String? = nil
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss

    @State private var clubs: [Club] = []
    @State private var selectedClubs: Set<String> = []
    @State private var loadError: String?
    @State private var query = ""
    @State private var results: [SearchBook] = []
    @State private var selectedResults: Set<Int> = []
    @State private var searching = false
    @State private var searchError: String?
    @State private var hasSearched = false
    @State private var link = ""
    @State private var linkMessage: String?
    @State private var statusMessage: String?
    @State private var busy = false
    // Club context (preset): results add in place, one tap per book.
    @State private var addedIndices: Set<Int> = []
    @State private var addingIndex: Int?

    var body: some View {
        NavigationStack {
            Group {
                if loadError != nil && clubs.isEmpty {
                    ContentUnavailableView("Could not load your clubs", systemImage: "exclamationmark.triangle", description: Text(loadError ?? ""))
                } else if clubs.isEmpty {
                    ProgressView()
                } else {
                    List {
                        searchSection
                        toSection
                        linkSection
                        if let statusMessage {
                            Section {
                                Text(statusMessage)
                                    .foregroundStyle(.secondary)
                            }
                            .listRowBackground(Color.rpCream)
                        }
                        resultsSection
                    }
                    .brandScreen()
                }
            }
            .navigationTitle("Add books")
            .brandBar()
            .safeAreaInset(edge: .bottom) {
                if !selectedResults.isEmpty {
                    Button {
                        Task { await addSelected() }
                    } label: {
                        Text("Add \(selectedResults.count) book\(selectedResults.count == 1 ? "" : "s")")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(busy || selectedClubs.isEmpty)
                    .padding(.horizontal)
                    .padding(.vertical, 8)
                    .background(.bar)
                }
            }
            .task { await loadClubs() }
            .sensoryFeedback(.success, trigger: addedIndices.count)
        }
    }

    // MARK: - sections

    private var searchSection: some View {
        Section {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Title or author", text: $query)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { Task { await search() } }
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
        } header: { rpSectionHeader("Search") }
        .listRowBackground(Color.rpCream)
    }

    private var toSection: some View {
        Section {
            ForEach(clubs) { club in
                Button {
                    if selectedClubs.contains(club.id) { selectedClubs.remove(club.id) }
                    else { selectedClubs.insert(club.id) }
                } label: {
                    HStack {
                        Text(club.name)
                            .foregroundStyle(.primary)
                        Spacer()
                        if selectedClubs.contains(club.id) {
                            Image(systemName: "checkmark")
                                .foregroundStyle(Color.rpCoral)
                        }
                    }
                }
                .buttonStyle(.plain)
            }
        } header: { rpSectionHeader("To") }
        .listRowBackground(Color.rpCream)
    }

    private var linkSection: some View {
        Section {
            TextField("Amazon, Goodreads, Google Books or Open Library link", text: $link)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
            Button("Add from link") {
                Task { await addFromLink() }
            }
            .disabled(busy || link.trimmingCharacters(in: .whitespaces).isEmpty || selectedClubs.isEmpty)
            if let linkMessage {
                Text(linkMessage)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } header: { rpSectionHeader("Add by link") }
        .listRowBackground(Color.rpCream)
    }

    @ViewBuilder
    private var resultsSection: some View {
        if searching {
            Section {
                HStack { ProgressView(); Text("Searching…").foregroundStyle(.secondary) }
            } header: { rpSectionHeader("Results") }
            .listRowBackground(Color.rpCream)
        } else if let searchError {
            Section {
                Text(searchError).foregroundStyle(.red).font(.subheadline)
            } header: { rpSectionHeader("Results") }
            .listRowBackground(Color.rpCream)
        } else if hasSearched {
            Section {
                if results.isEmpty {
                    Text("Nothing found")
                        .foregroundStyle(.secondary)
                }
                ForEach(Array(results.enumerated()), id: \.offset) { index, book in
                    if presetClubId != nil {
                        HStack(alignment: .top, spacing: 10) {
                            BookRowView(title: book.title, author: book.author, year: book.year,
                                        cover: book.cover, ratings: ratingsText(for: book))
                            Spacer()
                            if addedIndices.contains(index) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else if addingIndex == index {
                                ProgressView()
                            } else {
                                Button {
                                    Task { await addOne(index) }
                                } label: {
                                    Image(systemName: "plus.circle.fill")
                                        .font(.title3)
                                        .foregroundStyle(Color.rpCoral)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Add \(book.title)")
                            }
                        }
                    } else {
                        Button {
                            if selectedResults.contains(index) { selectedResults.remove(index) }
                            else { selectedResults.insert(index) }
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                BookRowView(title: book.title, author: book.author, year: book.year,
                                            cover: book.cover, ratings: ratingsText(for: book))
                                Spacer()
                                if selectedResults.contains(index) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Color.rpViolet)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            } header: { rpSectionHeader("Results") }
            .listRowBackground(Color.rpCream)
        }
    }

    // MARK: - actions

    private func loadClubs() async {
        do {
            let list = try await APIClient.shared.myClubs()
            clubs = list
            loadError = nil
            if let presetClubId {
                selectedClubs = [presetClubId]
            } else if selectedClubs.isEmpty {
                selectedClubs = Set(list.map { $0.id })
            }
        } catch {
            loadError = errorText(error)
        }
    }

    private func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        searching = true
        searchError = nil
        statusMessage = nil
        do {
            results = try await APIClient.shared.searchBooks(q: q)
            selectedResults = []
            addedIndices = []
            hasSearched = true
        } catch {
            searchError = errorText(error)
            results = []
            hasSearched = true
        }
        searching = false
    }

    /// Club context: add one search result to the preset club right away;
    /// the plus morphs into a checkmark.
    private func addOne(_ index: Int) async {
        guard let presetClubId, !addedIndices.contains(index), addingIndex == nil else { return }
        addingIndex = index
        do {
            let book = APIClient.jsonObject(results[index])
            try await APIClient.shared.callDiscard("addBooks", ["clubIds": [presetClubId], "books": [book]])
            addedIndices.insert(index)
            await app.refreshClubs()
        } catch {
            statusMessage = errorText(error)
        }
        addingIndex = nil
    }

    private func addSelected() async {
        guard !selectedClubs.isEmpty else { return }
        busy = true
        do {
            let books = selectedResults.sorted().map { APIClient.jsonObject(results[$0]) }
            try await APIClient.shared.callDiscard("addBooks", ["clubIds": Array(selectedClubs), "books": books])
            let count = selectedResults.count
            selectedResults = []
            await app.refreshClubs()
            if presetClubId != nil {
                dismiss()
            } else {
                statusMessage = "Added \(count) book\(count == 1 ? "" : "s")"
            }
        } catch {
            statusMessage = errorText(error)
        }
        busy = false
    }

    private func addFromLink() async {
        let url = link.trimmingCharacters(in: .whitespaces)
        guard !url.isEmpty, !selectedClubs.isEmpty else { return }
        busy = true
        linkMessage = nil
        do {
            let book = try await APIClient.shared.addByLink(url: url, clubIds: Array(selectedClubs))
            link = ""
            await app.refreshClubs()
            if presetClubId != nil {
                dismiss()
            } else {
                linkMessage = "Added \(book?.title ?? "book")"
            }
        } catch {
            linkMessage = errorText(error)
        }
        busy = false
    }
}
