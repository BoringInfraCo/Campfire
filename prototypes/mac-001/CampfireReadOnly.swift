import Foundation
import SwiftUI

// MAC-001: A disposable, read-only client of the installed Campfire Viewer.
// The Viewer owns the actor and credentials. This app knows only its loopback port.
private let viewerURL = URL(string: "http://127.0.0.1:9415/api/call")!

private struct WorkspaceSummary: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let status: String
    let goalTitle: String?
    let openTaskCount: Int
}

private struct Workspace: Decodable {
    let id: String
    let name: String
    let status: String
}

private struct Goal: Decodable {
    let title: String
    let status: String
}

private struct ContextSlice<Item: Decodable>: Decodable {
    let items: [Item]
    let total: Int
    let returned: Int
    let truncated: Bool
}

private struct WorkTask: Decodable, Identifiable {
    let id: String
    let title: String
    let description: String?
    let status: String
}

private struct Finding: Decodable, Identifiable {
    let id: String
    let summary: String
    let detail: String?
    let currentness: String?
}

private struct Slices: Decodable {
    let tasks: ContextSlice<WorkTask>
    let findings: ContextSlice<Finding>
}

private struct Context: Decodable {
    let workspace: Workspace
    let goal: Goal?
    let slices: Slices
    let generatedAt: String
}

private struct Envelope<Value: Decodable>: Decodable {
    let ok: Bool
    let result: Value?
    let error: String?
    let message: String?
}

private enum ViewerFailure: LocalizedError {
    case unavailable
    case denied
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .unavailable: "Viewer unreachable. Run campfire up, then refresh."
        case .denied: "This workspace is unavailable to the current Campfire actor."
        case .invalidResponse: "Campfire returned an unreadable response."
        }
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

private struct ViewerClient {
    private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)

    func call<Value: Decodable>(_ method: String, params: [String: String] = [:]) async throws -> Value {
        var request = URLRequest(url: viewerURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["method": method, "params": params])
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw ViewerFailure.unavailable
        }
        guard let http = response as? HTTPURLResponse else { throw ViewerFailure.invalidResponse }
        if http.statusCode == 403 || http.statusCode == 404 { throw ViewerFailure.denied }
        guard http.statusCode == 200,
              let envelope = try? JSONDecoder().decode(Envelope<Value>.self, from: data),
              envelope.ok, let result = envelope.result else {
            throw ViewerFailure.invalidResponse
        }
        return result
    }
}

@MainActor
private final class WorkspaceModel: ObservableObject {
    @Published var workspaces: [WorkspaceSummary] = []
    @Published var selectedWorkspaceID: String?
    @Published var context: Context?
    @Published var selectedRecordID: String?
    @Published var loading = false
    @Published var error: String?
    @Published var lastSuccess: Date?

    private let client = ViewerClient()
    private var requestGeneration = 0

    func select(_ id: String) {
        guard id != selectedWorkspaceID else { return }
        selectedWorkspaceID = id
        selectedRecordID = nil
        context = nil
        refresh()
    }

    func refresh() {
        requestGeneration += 1
        let generation = requestGeneration
        loading = true
        error = nil
        Task {
            do {
                let list: [WorkspaceSummary] = try await client.call("list_workspaces")
                guard generation == requestGeneration else { return }
                workspaces = list
                let id = selectedWorkspaceID.flatMap { chosen in list.contains(where: { $0.id == chosen }) ? chosen : nil }
                    ?? list.first?.id
                if id != selectedWorkspaceID {
                    // A revoked/removed workspace must not remain under the next label.
                    context = nil
                    selectedRecordID = nil
                    lastSuccess = nil
                }
                selectedWorkspaceID = id
                guard let id else {
                    context = nil
                    selectedRecordID = nil
                    loading = false
                    return
                }
                let result: Context = try await client.call("get_workspace_context", params: ["workspaceId": id, "participants": "omit"])
                guard generation == requestGeneration, selectedWorkspaceID == id else { return }
                guard result.workspace.id == id else { throw ViewerFailure.invalidResponse }
                context = result
                if let selectedRecordID,
                   !result.slices.tasks.items.contains(where: { $0.id == selectedRecordID }) &&
                   !result.slices.findings.items.contains(where: { $0.id == selectedRecordID }) {
                    self.selectedRecordID = nil
                }
                lastSuccess = Date()
                loading = false
            } catch {
                guard generation == requestGeneration else { return }
                if case ViewerFailure.denied = error {
                    context = nil
                    selectedRecordID = nil
                    lastSuccess = nil
                }
                self.error = error.localizedDescription
                loading = false
            }
        }
    }
}

private struct CampfireScreen: View {
    @StateObject private var model = WorkspaceModel()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Campfire").font(.largeTitle.bold())
                    Text("Shared work · read-only feasibility")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Refresh", action: model.refresh)
                    .keyboardShortcut("r", modifiers: .command)
                    .accessibilityLabel("Refresh Campfire workspace")
            }
            HStack {
                Picker("Workspace", selection: Binding(
                    get: { model.selectedWorkspaceID ?? "" },
                    set: { model.select($0) }
                )) {
                    ForEach(model.workspaces) { workspace in
                        Text(workspace.name).tag(workspace.id)
                    }
                }
                .disabled(model.workspaces.isEmpty)
                Spacer()
                if model.loading { ProgressView().accessibilityLabel("Loading workspace") }
                if let lastSuccess = model.lastSuccess {
                    Text("Last read \(lastSuccess.formatted(date: .omitted, time: .shortened))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if let error = model.error {
                Text(model.context == nil ? error : "Stale view · \(error)")
                    .foregroundStyle(.red)
                    .accessibilityAddTraits(.isStaticText)
            }
            if let context = model.context {
                Divider()
                Text(context.workspace.name).font(.title2.bold())
                Text("Workspace \(context.workspace.id) · \(context.workspace.status)")
                    .font(.caption).foregroundStyle(.secondary)
                Text(context.goal?.title ?? "No goal recorded")
                    .font(.headline)
                HStack(spacing: 18) {
                    Text("Tasks \(context.slices.tasks.returned) of \(context.slices.tasks.total)")
                    Text("Findings \(context.slices.findings.returned) of \(context.slices.findings.total)")
                }
                .font(.subheadline)
                if context.slices.tasks.truncated || context.slices.findings.truncated {
                    Text("Partial overview · more records exist in Campfire")
                        .foregroundStyle(.orange)
                }
                Divider()
                HStack(alignment: .top, spacing: 20) {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Work").font(.headline)
                            ForEach(context.slices.tasks.items) { task in
                                recordButton(task.id, task.title, task.status)
                            }
                            Text("Findings").font(.headline).padding(.top, 10)
                            ForEach(context.slices.findings.items) { finding in
                                recordButton(finding.id, finding.summary, finding.currentness ?? "current")
                            }
                            if context.slices.tasks.items.isEmpty && context.slices.findings.items.isEmpty {
                                Text("No work or findings in this overview.").foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity)
                    Divider()
                    detail(context).frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if model.loading {
                Spacer()
                Text("Reading authorized workspace…").foregroundStyle(.secondary)
                Spacer()
            } else if model.workspaces.isEmpty && model.error == nil {
                Spacer()
                Text("No workspace available to this Campfire actor.").foregroundStyle(.secondary)
                Spacer()
            }
        }
        .padding(24)
        .frame(minWidth: 780, minHeight: 520)
        .onAppear { model.refresh() }
    }

    private func recordButton(_ id: String, _ title: String, _ status: String) -> some View {
        Button {
            model.selectedRecordID = id
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).fontWeight(.medium).lineLimit(2)
                Text("\(status) · \(id)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(model.selectedRecordID == id ? Color.accentColor.opacity(0.14) : Color.secondary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(title), \(status), \(id)")
    }

    @ViewBuilder
    private func detail(_ context: Context) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Selected record").font(.headline)
            if let id = model.selectedRecordID,
               let task = context.slices.tasks.items.first(where: { $0.id == id }) {
                Text(task.title).font(.title3.bold())
                Text("\(task.status) · \(task.id)").font(.caption).foregroundStyle(.secondary)
                Text(task.description ?? "No description recorded.")
            } else if let id = model.selectedRecordID,
                      let finding = context.slices.findings.items.first(where: { $0.id == id }) {
                Text(finding.summary).font(.title3.bold())
                Text("\(finding.currentness ?? "current") · \(finding.id)")
                    .font(.caption).foregroundStyle(.secondary)
                Text(finding.detail ?? "No detail recorded.")
            } else {
                Text("Select a task or finding to inspect its returned summary.")
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Text("Orientation generated \(context.generatedAt)")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

@main
private struct CampfireReadOnlyApp: App {
    var body: some Scene {
        WindowGroup("Campfire MAC-001") { CampfireScreen() }
    }
}
