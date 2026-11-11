import SwiftUI

struct MeView: View {
    @EnvironmentObject var app: AppState
    @State private var confirmDelete = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if let user = app.user {
                    Section {
                        LabeledContent("Name", value: user.name)
                        LabeledContent("Email", value: user.email)
                    }
                }
                Section {
                    Button("Sign out") {
                        Task { await app.signOut() }
                    }
                }
                Section {
                    Button("Delete account", role: .destructive) { confirmDelete = true }
                }
            }
            .navigationTitle("Me")
            .errorAlert($errorMessage)
            .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete account", role: .destructive) {
                    Task {
                        do { try await app.deleteAccount() }
                        catch { errorMessage = errorText(error) }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This removes your account, your ratings and your club memberships. This cannot be undone.")
            }
        }
    }
}
