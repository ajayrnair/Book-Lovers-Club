import Foundation

// Models mirror the JSON shapes returned by the Reading Peeps API
// (the same publicClub / bookView shapes the web and Ionic clients decode).
// Verified against api/handler.js (publicClub, bookView, pollView) and the
// TypeScript interfaces in booklovers-native/src/api.ts.

struct User: Codable, Equatable {
    let id: String
    let name: String
    let email: String
}

struct BookRatings: Codable, Equatable {
    let rating: Double
    let count: Int
}

struct Book: Codable, Equatable, Identifiable {
    var id: String { key }
    let key: String
    let isbn: String?
    let title: String
    let author: String?
    let cover: String?
    let year: String?
    let pageCount: Int?
    let google: BookRatings?
    let hardcover: BookRatings?
    let openlibrary: BookRatings?
    let myRating: Double?
    let memberAverage: Double?
    let memberCount: Int?
    /// Present on library books inside a club payload (who finished this book).
    let finishedBy: [String]?
}

/// A book as returned by searchBooks and sent back by addBooks.
/// The server keys books by ISBN when present, else by title + author.
struct SearchBook: Codable, Equatable {
    let isbn: String?
    let title: String
    let author: String?
    let cover: String?
    let year: String?
    let pageCount: Int?
    let google: BookRatings?
    let hardcover: BookRatings?
    let openlibrary: BookRatings?
}

struct Member: Codable, Equatable, Identifiable {
    var id: String { userId }
    let userId: String
    let name: String
    let role: String  // "admin" or "member"
    let joinedAt: String
}

struct MemberRating: Codable, Equatable {
    let userId: String
    let name: String
    let rating: Double?
}

struct PollOption: Codable, Equatable {
    let book: Book
    let votes: Int
}

struct Poll: Codable, Equatable, Identifiable {
    let id: String
    let runoff: Bool
    let closesAt: String  // ISO 8601 timestamp
    let auto: Bool
    let options: [PollOption]
    let totalVotes: Int
    let myVote: String?
}

struct Meeting: Codable, Equatable {
    var type: String  // "online" or "inperson"
    var link: String
    var address: String
    var date: String  // "yyyy-MM-dd", empty when no date picked
    var time: String? // "HH:mm"

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "online"
        link = try c.decodeIfPresent(String.self, forKey: .link) ?? ""
        address = try c.decodeIfPresent(String.self, forKey: .address) ?? ""
        date = try c.decodeIfPresent(String.self, forKey: .date) ?? ""
        time = try c.decodeIfPresent(String.self, forKey: .time)
    }

    init(type: String, link: String, address: String, date: String, time: String?) {
        self.type = type
        self.link = link
        self.address = address
        self.date = date
        self.time = time
    }
}

struct ClubLocation: Codable, Equatable, Hashable {
    let label: String
    let lat: Double
    let lng: Double
    let placeId: String?
}

struct ProgressEntry: Codable, Equatable {
    let userId: String
    let percent: Int
    let page: Int?
    let totalPages: Int?
    let updatedAt: String
}

struct LastResult: Codable, Equatable {
    let winner: String?
    let tie: [String]?
    let at: String
}

struct Club: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let `private`: Bool
    let format: String?  // "online" or "in-person"
    let location: ClubLocation?
    let genres: [String]?
    let audience: String?
    let specialty: String?
    let memberCount: Int
    let isMember: Bool
    let role: String?  // "admin", "member", or nil when not a member
    let members: [Member]
    let library: [Book]
    let current: Book?
    let currentRatings: [MemberRating]
    let meetingFrequencyWeeks: Int
    let cycleEnd: String?
    let autoPoll: Bool
    let meeting: Meeting
    let week: [String]  // Monday..Sunday as "yyyy-MM-dd"
    let availability: [String: [String]]
    let finishedBy: [String]
    let myFinished: Bool
    let progress: [ProgressEntry]?
    let rsvps: [String: String]  // userId -> "going" | "maybe" | "notgoing"
    let poll: Poll?
    let lastResult: LastResult?

    var isAdmin: Bool { role == "admin" }

    /// Books a poll can choose from: library minus current minus finished-by-anyone.
    var pollCandidates: [Book] {
        library.filter { b in
            (current == nil || b.key != current!.key) && (b.finishedBy ?? []).isEmpty
        }
    }
}

// ---------- API response envelopes ----------

struct AuthResponse: Decodable {
    let token: String
    let user: User
}

struct UserResponse: Decodable {
    let user: User
}

struct ClubResponse: Decodable {
    let club: Club
}

struct ClubsResponse: Decodable {
    let clubs: [Club]
}

struct SearchBooksResponse: Decodable {
    let results: [SearchBook]
}

struct AddByLinkResponse: Decodable {
    let book: SearchBook?
}

struct InviteResult: Decodable, Identifiable {
    var id: String { email }
    let email: String
    let inviteToken: String?
    let sent: Bool
    let error: String?
}

struct InviteResponse: Decodable {
    let emailed: Bool
    let results: [InviteResult]
}

/// Stats payload (super admin only; the server enforces who gets an answer).
struct StatsResponse: Codable, Equatable {
    let scope: String
    let users: StatsUsers
    let clubs: StatsClubs
}

struct StatsUsers: Codable, Equatable {
    let total: Int
    let real: Int
    let test: Int
    let list: [StatsUser]
}

struct StatsUser: Codable, Equatable, Identifiable {
    var id: String { email }
    let name: String
    let email: String
    let createdAt: String
    let isTest: Bool
    let isSuperAdmin: Bool
}

struct StatsClubs: Codable, Equatable {
    let total: Int
    let list: [StatsClub]
}

struct StatsClub: Codable, Equatable {
    let name: String
    let `private`: Bool
    let memberCount: Int
    let members: [StatsMember]?
}

struct StatsMember: Codable, Equatable {
    let name: String?
    let email: String?
    let role: String?
}
