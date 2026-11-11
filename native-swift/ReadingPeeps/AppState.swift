import Combine
import Foundation

struct ClubUsage: Codable {
    var count: Int
    var last: Double  // epoch milliseconds, matching the web app's blc_usage
}

/// Session and club-list state for the whole app.
@MainActor
final class AppState: ObservableObject {
    @Published var user: User?
    @Published var clubs: [Club] = []
    @Published var restoring = true

    private var usage: [String: ClubUsage] = [:]
    private static let usageKey = "blc_usage"
    private static let tokenKey = "token"

    init() {
        loadUsage()
    }

    // ---------- session ----------

    func restore() async {
        if let token = Keychain.load(Self.tokenKey), !token.isEmpty {
            APIClient.shared.token = token
            do {
                user = try await APIClient.shared.me()
                await refreshClubs()
            } catch {
                clearLocalSession()
            }
        }
        restoring = false
    }

    func adoptSession(_ auth: AuthResponse) async {
        Keychain.save(auth.token, forKey: Self.tokenKey)
        APIClient.shared.token = auth.token
        user = auth.user
        await refreshClubs()
    }

    /// After Google sign-in returns a token, fetch the account with it.
    func adoptGoogleToken(_ token: String) async throws {
        Keychain.save(token, forKey: Self.tokenKey)
        APIClient.shared.token = token
        do {
            user = try await APIClient.shared.me()
            await refreshClubs()
        } catch {
            clearLocalSession()
            throw error
        }
    }

    func signOut() async {
        await APIClient.shared.signOut()
        clearLocalSession()
    }

    func deleteAccount() async throws {
        try await APIClient.shared.callDiscard("deleteAccount")
        clearLocalSession()
    }

    private func clearLocalSession() {
        Keychain.delete(Self.tokenKey)
        APIClient.shared.token = nil
        user = nil
        clubs = []
    }

    // ---------- clubs ----------

    func refreshClubs() async {
        if let list = try? await APIClient.shared.myClubs() {
            clubs = list
        }
    }

    /// Most used first: open count, then most recent, then list order.
    var orderedClubs: [Club] {
        clubs.enumerated().sorted { a, b in
            let ua = usage[a.element.id] ?? ClubUsage(count: 0, last: 0)
            let ub = usage[b.element.id] ?? ClubUsage(count: 0, last: 0)
            if ua.count != ub.count { return ua.count > ub.count }
            if ua.last != ub.last { return ua.last > ub.last }
            return a.offset < b.offset
        }.map { $0.element }
    }

    func trackUsage(clubId: String) {
        var entry = usage[clubId] ?? ClubUsage(count: 0, last: 0)
        entry.count += 1
        entry.last = Date().timeIntervalSince1970 * 1000
        usage[clubId] = entry
        if let data = try? JSONEncoder().encode(usage) {
            UserDefaults.standard.set(data, forKey: Self.usageKey)
        }
    }

    private func loadUsage() {
        if let data = UserDefaults.standard.data(forKey: Self.usageKey),
           let decoded = try? JSONDecoder().decode([String: ClubUsage].self, from: data) {
            usage = decoded
        }
    }
}
