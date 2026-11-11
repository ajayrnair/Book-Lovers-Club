import SwiftUI

/// The club library in three groups: Current book, To read, Read.
/// Choosing the club's book happens in the Next book flow, not here.
struct LibraryView: View {
    let clubId: String

    @State private var club: Club?
    @State private var loadError: String?
    @State private var errorMessage: String?
    @State private var showAddBooks = false

    var body: some View {
        Group {
            if let club {
                List {
                    if club.library.isEmpty {
                        Section {
                            Text("No books yet")
                                .foregroundStyle(.secondary)
                            Button("Add books") { showAddBooks = true }
                        }
                        .listRowBackground(Color.rpCream)
                    } else {
                        groups(club)
                    }
                }
                .refreshable { await load() }
                .brandScreen()
            } else if let loadError {
                ContentUnavailableView("Could not load the library", systemImage: "exclamationmark.triangle", description: Text(loadError))
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Library")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showAddBooks = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add books")
            }
        }
        .sheet(isPresented: $showAddBooks, onDismiss: { Task { await load() } }) {
            NavigationStack {
                AddBooksView(presetClubId: clubId)
            }
        }
        .task { await load() }
        .errorAlert($errorMessage)
    }

    @ViewBuilder
    private func groups(_ c: Club) -> some View {
        let curKey = c.current?.key
        let current = curKey != nil ? c.library.first { $0.key == curKey } : nil
        let rest = c.library.filter { $0.key != curKey }
        let read = rest.filter { !($0.finishedBy ?? []).isEmpty }
        let toRead = rest.filter { ($0.finishedBy ?? []).isEmpty }
        if let current {
            Section { bookRows(c, books: [current]) } header: { rpSectionHeader("Current book") }
            .listRowBackground(Color.rpCream)
        }
        if !toRead.isEmpty {
            Section { bookRows(c, books: toRead) } header: { rpSectionHeader("To read") }
            .listRowBackground(Color.rpCream)
        }
        if !read.isEmpty {
            Section { bookRows(c, books: read) } header: { rpSectionHeader("Read") }
            .listRowBackground(Color.rpCream)
        }
    }

    @ViewBuilder
    private func bookRows(_ c: Club, books: [Book]) -> some View {
        ForEach(books) { book in
            VStack(alignment: .leading, spacing: 6) {
                BookRowView(title: book.title, author: book.author, year: book.year,
                            cover: book.cover, ratings: ratingsText(for: book))
                if let memberAvg = book.memberAverage, let memberCount = book.memberCount, memberCount > 0 {
                    Text("Members ★ \(trimNumber(memberAvg)) (\(memberCount))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let finishedBy = book.finishedBy, !finishedBy.isEmpty {
                    Text("Finished by \(finishedBy.count) of \(c.members.count)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let s = book.synopsis, !s.isEmpty {
                    SynopsisView(text: s)
                }
                HStack(spacing: 8) {
                    Text("Your rating")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    StarRatingView(rating: book.myRating) { value in
                        Task { await rate(bookKey: book.key, value: value) }
                    }
                }
            }
            .padding(.vertical, 2)
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

    private func rate(bookKey: String, value: Double) async {
        do {
            try await APIClient.shared.callDiscard("rate", ["bookKey": bookKey, "rating": value])
            await load()
        } catch { errorMessage = errorText(error) }
    }
}
