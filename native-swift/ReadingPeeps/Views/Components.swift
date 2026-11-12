import SwiftUI

// ---------- covers ----------

struct CoverView: View {
    let urlString: String?
    var width: CGFloat = 44

    var body: some View {
        let height = width * 1.5
        Group {
            if let s = urlString, !s.isEmpty, let url = URL(string: s) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: .fill)
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: width, height: height)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.secondary.opacity(0.25), lineWidth: 0.5))
    }

    private var placeholder: some View {
        ZStack {
            Color.secondary.opacity(0.15)
            Image(systemName: "book.closed")
                .foregroundStyle(.secondary)
        }
    }
}

// ---------- avatars + brand screen ----------

/// Initials avatar in the shared palette. The color comes from the same
/// stable hash of the user id the web app uses, so a person is the same
/// color on the web and in the app.
struct AvatarView: View {
    let name: String
    let userId: String
    var size: CGFloat = 34

    private var initials: String {
        let parts = name.split(separator: " ")
        guard let first = parts.first else { return "?" }
        if parts.count > 1, let last = parts.last {
            return (String(first.prefix(1)) + String(last.prefix(1))).uppercased()
        }
        return String(first.prefix(1)).uppercased()
    }

    private var color: Color {
        var h: UInt32 = 0
        for u in userId.unicodeScalars { h = h &* 31 &+ u.value }
        return Color.rpAvatarColors[Int(h % UInt32(Color.rpAvatarColors.count))]
    }

    var body: some View {
        Text(initials)
            .font(.system(size: size * 0.38, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(color)
            .clipShape(Circle())
    }
}

/// The brand screen treatment, matching the web app exactly: the deep
/// plum page frame with cream cards (list rows) floating on it. Apply to
/// a screen's root list or container.
struct BrandScreen: ViewModifier {
    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background(Color.rpPlumBg)
            .listRowBackground(Color.rpCream)
    }
}

extension View {
    func brandScreen() -> some View { modifier(BrandScreen()) }
}

/// The branding header: logo and wordmark centered in the top bar, the
/// same on every tab. Mirrors the Clubs tab, which set the pattern.
struct BrandBar: ViewModifier {
    func body(content: Content) -> some View {
        content
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
            }
    }
}

extension View {
    func brandBar() -> some View { modifier(BrandBar()) }
}

/// Section header text for branded screens: the plum page shows through
/// behind section headers, so they are set in soft cream instead of the
/// system gray that would vanish on plum.
@ViewBuilder
func rpSectionHeader(_ title: String) -> some View {
    Text(title)
        .font(.footnote.weight(.semibold))
        .foregroundStyle(Color.rpCream.opacity(0.75))
        .textCase(.uppercase)
}

/// The Reading Peeps mark, drawn the way the app icon is: five bookmark
/// ribbons in the brand colors standing on deep plum, each topped with a
/// round head. Used inside the app so the brand is present on screen.
struct LogoView: View {
    var size: CGFloat = 64

    private let heights: [Double] = [0.30, 0.40, 0.34, 0.44, 0.32]

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.24)
                .fill(Color.rpPlum)
            HStack(alignment: .bottom, spacing: size * 0.05) {
                ForEach(0..<5, id: \.self) { i in
                    VStack(spacing: size * 0.035) {
                        Circle()
                            .fill(Color.rpAvatarColors[i])
                            .frame(width: size * 0.115, height: size * 0.115)
                        RoundedRectangle(cornerRadius: size * 0.035)
                            .fill(Color.rpAvatarColors[i])
                            .frame(width: size * 0.115, height: size * heights[i])
                    }
                }
            }
            .padding(.bottom, size * 0.14)
        }
        .frame(width: size, height: size)
    }
}

// ---------- ratings text ----------

private func fmtCount(_ n: Int) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    return f.string(from: NSNumber(value: n)) ?? "\(n)"
}

private func fmtRating(_ v: Double) -> String {
    // 4 -> "4", 4.25 -> "4.25"
    if v == v.rounded() { return String(Int(v)) }
    return String(format: "%.2f", v).replacingOccurrences(of: "0$", with: "", options: .regularExpression)
}

/// "★ 4.17 · Google (1,234) · ★ 3.9 · Hardcover (567)" — the sources that exist.
func externalRatingsText(google: BookRatings?, hardcover: BookRatings?, openlibrary: BookRatings?) -> String {
    var parts: [String] = []
    if let g = google { parts.append("★ \(fmtRating(g.rating)) · Google (\(fmtCount(g.count)))") }
    if let h = hardcover { parts.append("★ \(fmtRating(h.rating)) · Hardcover (\(fmtCount(h.count)))") }
    if let o = openlibrary { parts.append("★ \(fmtRating(o.rating)) · Open Library (\(fmtCount(o.count)))") }
    return parts.joined(separator: " · ")
}

func ratingsText(for book: Book) -> String {
    externalRatingsText(google: book.google, hardcover: book.hardcover, openlibrary: book.openlibrary)
}

func ratingsText(for book: SearchBook) -> String {
    externalRatingsText(google: book.google, hardcover: book.hardcover, openlibrary: book.openlibrary)
}

// ---------- book rows ----------

struct BookRowView: View {
    let title: String
    let author: String?
    let year: String?
    let cover: String?
    var ratings: String = ""
    var badge: String? = nil
    var coverWidth: CGFloat = 44

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CoverView(urlString: cover, width: coverWidth)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .center, spacing: 6) {
                    Text(title)
                        .font(.body)
                        .lineLimit(2)
                    if let badge {
                        HStack(spacing: 3) {
                            Image(systemName: "checkmark")
                                .font(.caption2.weight(.bold))
                            Text(badge)
                                .font(.caption.weight(.semibold))
                        }
                        .foregroundStyle(Color.rpInk)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Color.rpPill)
                        .clipShape(Capsule())
                        .fixedSize()
                    }
                }
                if let subtitle = subtitleText {
                    Text(subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if !ratings.isEmpty {
                    Text(ratings)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
    }

    private var subtitleText: String? {
        var bits: [String] = []
        if let a = author, !a.isEmpty { bits.append(a) }
        if let y = year, !y.isEmpty { bits.append(y) }
        return bits.isEmpty ? nil : bits.joined(separator: " · ")
    }
}

/// A few lines of the book's synopsis with a More/Less toggle, so the full
/// text never floods the screen. Mirrors the web app's clamped synopsis.
struct SynopsisView: View {
    let text: String
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(text)
                .font(.subheadline)
                .lineLimit(expanded ? nil : 3)
            Button(expanded ? "Less" : "More") {
                withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.rpCoral)
            .buttonStyle(.plain)
        }
    }
}

// ---------- star rating (half steps) ----------

/// "Your rating" editor: five stars, tap the left or right half of a star for
/// half steps, plus a plain Clear button when a rating is set. Built from real
/// Buttons; commits immediately on tap, like the web app's star strip.
struct StarRatingView: View {
    let rating: Double?
    var onCommit: (Double) -> Void

    @State private var display: Double = 0

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 0) {
                ForEach(0..<5, id: \.self) { star in
                    Image(systemName: symbol(for: star))
                        .font(.title3)
                        .foregroundStyle(Color.rpCoral)
                        .frame(width: 30, height: 34)
                }
            }
            .overlay(
                HStack(spacing: 0) {
                    ForEach(0..<10, id: \.self) { half in
                        Button {
                            onCommit(Double(half + 1) / 2.0)
                        } label: {
                            Color.clear.frame(width: 15, height: 34)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Rate \(String(format: "%.1f", Double(half + 1) / 2.0)) stars")
                    }
                }
            )
            if (rating ?? 0) > 0 {
                Button("Clear") { onCommit(0) }
                    .font(.subheadline)
            }
            Spacer()
        }
        .onAppear { display = rating ?? 0 }
        .onChange(of: rating) { _, new in display = new ?? 0 }
    }

    private func symbol(for star: Int) -> String {
        let fill = display - Double(star)
        if fill >= 0.75 { return "star.fill" }
        if fill >= 0.25 { return "star.leadinghalf.fill" }
        return "star"
    }
}

// ---------- reactions ----------

let reactionPalette = ["❤️", "👏", "🔥", "😮", "😂", "🎉"]

/// Emoji reactions on a finish, a rating, or a poll result. One small
/// slot in a fixed place: an empty smiley when you have not reacted, your
/// emoji in that same slot once you have. Tapping the slot opens the
/// palette; tapping your own emoji there removes it, another replaces it.
/// Other people's reactions sit beside the slot as small count chips.
struct ReactionChipsView: View {
    let chips: [ReactionChip]
    var canReact: Bool = true
    var onReact: (String) -> Void

    @State private var paletteOpen = false
    @State private var showWho = false

    private var myEmoji: String? { chips.first(where: { $0.mine })?.emoji }

    var body: some View {
        HStack(spacing: 5) {
            ForEach(chips, id: \.emoji) { chip in
                let others = chip.count - (chip.mine ? 1 : 0)
                if others > 0 {
                    Button {
                        showWho = true
                    } label: {
                        Text("\(chip.emoji) \(others)")
                            .font(.caption2.weight(.medium))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(Color.secondary.opacity(0.10))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            if canReact {
                if paletteOpen {
                    ForEach(reactionPalette, id: \.self) { emoji in
                        Button {
                            paletteOpen = false
                            onReact(emoji)
                        } label: {
                            Text(emoji)
                                .font(.subheadline)
                                .padding(3)
                                .background(emoji == myEmoji ? Color.rpCoral.opacity(0.18) : Color.clear)
                                .clipShape(Circle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                Button {
                    withAnimation { paletteOpen.toggle() }
                } label: {
                    Group {
                        if !paletteOpen, let mine = myEmoji {
                            Text(mine).font(.subheadline)
                        } else {
                            Image(systemName: paletteOpen ? "xmark" : "face.smiling")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: 24, height: 24)
                    .background(!paletteOpen && myEmoji != nil ? Color.rpCoral.opacity(0.15) : Color.clear)
                    .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(myEmoji == nil ? "Add a reaction" : "Your reaction. Tap to change or remove it")
            }
        }
        .sheet(isPresented: $showWho) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Reactions")
                    .font(.headline)
                ForEach(chips.filter { $0.count > 0 }, id: \.emoji) { chip in
                    HStack(spacing: 9) {
                        Text(chip.emoji).font(.title3)
                        Text(chip.names.joined(separator: ", "))
                            .foregroundStyle(.primary)
                    }
                }
                Spacer()
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .presentationDetents([.medium])
        }
    }
}

// ---------- error presentation ----------

extension View {
    /// Standard error alert bound to a message string (nil/empty hides it).
    func errorAlert(_ message: Binding<String?>) -> some View {
        alert("Something went wrong", isPresented: Binding(
            get: { message.wrappedValue != nil },
            set: { if !$0 { message.wrappedValue = nil } }
        )) {
            Button("OK", role: .cancel) { message.wrappedValue = nil }
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }
}
