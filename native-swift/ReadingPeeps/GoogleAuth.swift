import AuthenticationServices
import UIKit

/// Google sign-in through ASWebAuthenticationSession. The backend's
/// ?native=1 flow returns booklovers://auth#t=<token> on success and
/// booklovers://auth?auth=failed on failure (the same return the Capacitor
/// app used).
final class GoogleAuthController: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func signIn() async throws -> String {
        let start = URL(string: "https://www.readingpeeps.com/api/auth/google?native=1")!
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: start, callbackURLScheme: "booklovers") { url, error in
                if let error = error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let url = url else {
                    continuation.resume(throwing: APIError(status: 0, message: "Google sign-in did not return."))
                    return
                }
                if let token = Self.token(from: url) {
                    continuation.resume(returning: token)
                } else {
                    continuation.resume(throwing: APIError(status: 0, message: "Google sign-in failed. Please try again."))
                }
            }
            session.presentationContextProvider = self
            self.session = session
            if !session.start() {
                continuation.resume(throwing: APIError(status: 0, message: "Could not open Google sign-in."))
            }
        }
    }

    /// The token rides in the URL fragment: booklovers://auth#t=<token>
    private static func token(from url: URL) -> String? {
        guard let fragment = URLComponents(url: url, resolvingAgainstBaseURL: false)?.fragment else { return nil }
        for pair in fragment.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1)
            if parts.count == 2, parts[0] == "t" {
                return String(parts[1]).removingPercentEncoding ?? String(parts[1])
            }
        }
        return nil
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
           let window = scene.windows.first(where: { $0.isKeyWindow }) {
            return window
        }
        return ASPresentationAnchor()
    }
}
