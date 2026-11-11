import Foundation

struct APIError: Error, LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

/// Client for the Reading Peeps JSON API: POST { action, ...params } with a
/// Bearer token, exactly the contract the web and Ionic clients use.
final class APIClient {
    static let shared = APIClient()
    static let endpoint = URL(string: "https://www.readingpeeps.com/api/handler")!

    /// Session token, set by AppState. Read at call time.
    var token: String?

    private init() {}

    private func rawCall(_ action: String, _ params: [String: Any]) async throws -> Data {
        var body: [String: Any] = params
        body["action"] = action
        var req = URLRequest(url: Self.endpoint)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = token, !token.isEmpty {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status < 200 || status >= 300 {
            var message = "HTTP \(status)"
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let e = obj["error"] as? String {
                message = e
            }
            throw APIError(status: status, message: message)
        }
        return data
    }

    func call<T: Decodable>(_ action: String, _ params: [String: Any] = [:]) async throws -> T {
        let data = try await rawCall(action, params)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(status: 0, message: "The server sent back something the app could not read.")
        }
    }

    /// For actions whose response body the app does not model (the server
    /// usually returns the updated club; the caller reloads what it needs).
    func callDiscard(_ action: String, _ params: [String: Any] = [:]) async throws {
        _ = try await rawCall(action, params)
    }

    /// Convert an Encodable value into a JSON object for use as a parameter.
    static func jsonObject<T: Encodable>(_ value: T) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(value),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return obj
    }
}

// ---------- typed endpoints ----------

extension APIClient {
    func me() async throws -> User {
        let r: UserResponse = try await call("me")
        return r.user
    }

    func signIn(email: String, password: String) async throws -> AuthResponse {
        try await call("signin", ["email": email, "password": password])
    }

    func signUp(name: String, email: String, password: String) async throws -> AuthResponse {
        try await call("signup", ["name": name, "email": email, "password": password])
    }

    func signOut() async {
        try? await callDiscard("signout")
    }

    func myClubs() async throws -> [Club] {
        let r: ClubsResponse = try await call("myClubs")
        return r.clubs
    }

    func club(id: String) async throws -> Club {
        let r: ClubResponse = try await call("club", ["clubId": id])
        return r.club
    }

    func clubSettings(clubId: String, _ params: [String: Any]) async throws -> Club {
        var p = params
        p["clubId"] = clubId
        let r: ClubResponse = try await call("clubSettings", p)
        return r.club
    }

    func searchBooks(q: String) async throws -> [SearchBook] {
        let r: SearchBooksResponse = try await call("searchBooks", ["q": q])
        return r.results
    }

    func addByLink(url: String, clubIds: [String]) async throws -> SearchBook? {
        let r: AddByLinkResponse = try await call("addByLink", ["url": url, "clubIds": clubIds])
        return r.book
    }

    func searchClubs(_ params: [String: Any]) async throws -> [Club] {
        let r: ClubsResponse = try await call("searchClubs", params)
        return r.clubs
    }

    func createClub(_ payload: [String: Any]) async throws -> Club {
        let r: ClubResponse = try await call("createClub", payload)
        return r.club
    }

    func acceptInvite(token: String) async throws -> Club {
        let r: ClubResponse = try await call("acceptInvite", ["inviteToken": token])
        return r.club
    }

    func createInvite(clubId: String, emailList: String) async throws -> InviteResponse {
        try await call("createInvite", ["clubId": clubId, "emailList": emailList])
    }
}

/// One retry after ~0.9 s, the pattern the web/native clients use for the two
/// actions with a known read-after-write race (setCurrent, setProgress).
func withRetry(_ op: () async throws -> Void) async throws {
    do {
        try await op()
    } catch {
        try await Task.sleep(nanoseconds: 900_000_000)
        try await op()
    }
}

func errorText(_ error: Error) -> String {
    if let e = error as? APIError { return e.message }
    if let e = error as? URLError {
        if e.code == .notConnectedToInternet || e.code == .networkConnectionLost {
            return "No internet connection."
        }
        return "Network error. Please try again."
    }
    return error.localizedDescription
}
