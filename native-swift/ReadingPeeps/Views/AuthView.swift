import AuthenticationServices
import SwiftUI

struct AuthView: View {
    @EnvironmentObject var app: AppState
    @State private var mode = 0  // 0 = sign in, 1 = create account
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var errorMessage: String?
    @State private var google = GoogleAuthController()

    var body: some View {
        VStack(spacing: 0) {
            VStack(spacing: 6) {
                LogoView(size: 76)
                Text("Reading Peeps")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Color.rpCream)
                Text("Read together, one book at a time.")
                    .font(.subheadline)
                    .foregroundStyle(Color.rpCream.opacity(0.7))
            }
            .padding(.top, 48)
            .padding(.bottom, 8)

            Form {
                Section {
                    Picker("Account", selection: $mode) {
                        Text("Sign in").tag(0)
                        Text("Create account").tag(1)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                }

                Section {
                    if mode == 1 {
                        TextField("Name", text: $name)
                            .textContentType(.name)
                            .autocorrectionDisabled()
                    }
                    TextField("Email", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Password", text: $password)
                        .textContentType(mode == 1 ? .newPassword : .password)
                }
                .listRowBackground(Color.rpCream)

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.subheadline)
                    }
                    .listRowBackground(Color.rpCream)
                }

                Section {
                    Button {
                        Task { await submit() }
                    } label: {
                        HStack {
                            Spacer()
                            if busy { ProgressView() } else { Text(mode == 1 ? "Create account" : "Sign in") }
                            Spacer()
                        }
                    }
                    .disabled(busy || !formValid)
                }
                .listRowBackground(Color.rpCream)

                Section {
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.fullName, .email]
                    } onCompletion: { result in
                        Task { await handleApple(result) }
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 44)
                }
                .listRowBackground(Color.rpCream)

                Section {
                    Button {
                        Task { await googleSignIn() }
                    } label: {
                        HStack {
                            Spacer()
                            Text("Sign in with Google")
                            Spacer()
                        }
                    }
                    .disabled(busy)
                }
                .listRowBackground(Color.rpCream)
            }
            .scrollContentBackground(.hidden)
            .listRowBackground(Color.rpCream)
        }
        .background(Color.rpPlumBg)
    }

    private var formValid: Bool {
        let e = email.trimmingCharacters(in: .whitespaces)
        if e.isEmpty || password.isEmpty { return false }
        if mode == 1 && name.trimmingCharacters(in: .whitespaces).isEmpty { return false }
        return true
    }

    private func submit() async {
        busy = true
        errorMessage = nil
        do {
            let auth: AuthResponse
            if mode == 1 {
                auth = try await APIClient.shared.signUp(
                    name: name.trimmingCharacters(in: .whitespaces),
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password)
            } else {
                auth = try await APIClient.shared.signIn(
                    email: email.trimmingCharacters(in: .whitespaces),
                    password: password)
            }
            await app.adoptSession(auth)
        } catch {
            errorMessage = errorText(error)
        }
        busy = false
    }

    private func handleApple(_ result: Result<ASAuthorization, Error>) async {
        switch result {
        case .failure(let error):
            // Closing the Apple sheet is not an error worth showing.
            if let e = error as? ASAuthorizationError, e.code == .canceled { return }
            errorMessage = "Apple sign in failed. Please try again."
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let identityToken = String(data: tokenData, encoding: .utf8) else {
                errorMessage = "Apple sign in failed. Please try again."
                return
            }
            busy = true
            errorMessage = nil
            do {
                let name = credential.fullName.map { PersonNameComponentsFormatter().string(from: $0) } ?? ""
                let auth = try await APIClient.shared.signInWithApple(identityToken: identityToken, name: name)
                await app.adoptSession(auth)
            } catch {
                errorMessage = errorText(error)
            }
            busy = false
        }
    }

    private func googleSignIn() async {
        busy = true
        errorMessage = nil
        do {
            let token = try await google.signIn()
            try await app.adoptGoogleToken(token)
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            // The person closed the Google sheet; nothing to say.
        } catch {
            errorMessage = errorText(error)
        }
        busy = false
    }
}
