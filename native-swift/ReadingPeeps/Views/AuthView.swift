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
    @State private var showForgot = false
    @State private var forgotEmail = ""
    @State private var forgotSent = false
    @State private var forgotBusy = false

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
                    HStack(spacing: 4) {
                        modeButton(0, "Sign in")
                        modeButton(1, "Create account")
                    }
                    .padding(4)
                    .background(Color.white.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .listRowInsets(EdgeInsets())
                }
                .listRowBackground(Color.clear)

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
                            if busy {
                                ProgressView().tint(Color.rpCream)
                            } else {
                                Text(mode == 1 ? "Create account" : "Sign in")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(Color.rpCream)
                            }
                            Spacer()
                        }
                        .frame(height: 50)
                        .background(formValid && !busy ? Color.rpCoral : Color.rpCoral.opacity(0.4))
                        .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(busy || !formValid)
                    .listRowInsets(EdgeInsets())
                }
                .listRowBackground(Color.clear)

                if mode == 0 {
                    Section {
                        Button("Forgot password?") {
                            forgotEmail = email.trimmingCharacters(in: .whitespaces)
                            forgotSent = false
                            showForgot = true
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.rpCoral)
                        .frame(maxWidth: .infinity)
                        .buttonStyle(.plain)
                        .listRowInsets(EdgeInsets())
                    }
                    .listRowBackground(Color.clear)
                }

                Section {
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.fullName, .email]
                    } onCompletion: { result in
                        Task { await handleApple(result) }
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 50)
                    .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
                    .listRowInsets(EdgeInsets())
                }
                .listRowBackground(Color.clear)

                Section {
                    Button {
                        Task { await googleSignIn() }
                    } label: {
                        HStack(spacing: 10) {
                            Spacer()
                            Image("GoogleG")
                                .resizable()
                                .frame(width: 20, height: 20)
                            Text("Sign in with Google")
                                .font(.body.weight(.medium))
                                .foregroundStyle(Color(red: 31.0 / 255.0, green: 31.0 / 255.0, blue: 31.0 / 255.0))
                            Spacer()
                        }
                        .frame(height: 50)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 25, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(busy)
                    .listRowInsets(EdgeInsets())
                }
                .listRowBackground(Color.clear)
            }
            .scrollContentBackground(.hidden)
            .listRowBackground(Color.rpCream)
        }
        .background(Color.rpPlumBg)
        .sheet(isPresented: $showForgot) {
            NavigationStack {
                Form {
                    if forgotSent {
                        Section {
                            Text("If that email has an account, a reset link is on its way. It works once and expires in an hour. Open it, set a new password, then sign in here with it.")
                        }
                        .listRowBackground(Color.rpCream)
                    } else {
                        Section {
                            TextField("Email", text: $forgotEmail)
                                .textContentType(.emailAddress)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                        } header: {
                            Text("We will email you a link to set a new password.")
                                .foregroundStyle(Color.rpCream.opacity(0.75))
                        }
                        .listRowBackground(Color.rpCream)
                        Section {
                            Button {
                                Task { await sendReset() }
                            } label: {
                                HStack {
                                    Spacer()
                                    if forgotBusy { ProgressView() } else { Text("Email me a reset link") }
                                    Spacer()
                                }
                            }
                            .disabled(forgotBusy || forgotEmail.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                        .listRowBackground(Color.rpCream)
                    }
                }
                .scrollContentBackground(.hidden)
                .background(Color.rpPlumBg)
                .navigationTitle("Forgot password")
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(Color.rpPlumBg, for: .navigationBar)
                .toolbarColorScheme(.dark, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(forgotSent ? "Done" : "Cancel") { showForgot = false }
                            .foregroundStyle(Color.rpCream)
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private func modeButton(_ value: Int, _ label: String) -> some View {
        Button {
            mode = value
        } label: {
            Text(label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(mode == value ? Color.rpInk : Color.rpCream)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .background(mode == value ? Color.rpCream : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func sendReset() async {
        forgotBusy = true
        do {
            try await APIClient.shared.requestPasswordReset(email: forgotEmail.trimmingCharacters(in: .whitespaces))
        } catch {
            // The answer is the same either way, by design.
        }
        forgotSent = true
        forgotBusy = false
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
