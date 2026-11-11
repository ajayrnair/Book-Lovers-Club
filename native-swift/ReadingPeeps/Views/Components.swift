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
    var coverWidth: CGFloat = 44

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CoverView(urlString: cover, width: coverWidth)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                    .lineLimit(2)
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
