import Foundation

// Decoder-only companion to CampfireReadOnly.swift. These are the exact fields
// the SwiftUI prototype consumes from the same Viewer context response.
struct Workspace: Decodable {
    let id: String
    let name: String
    let status: String
}

struct Goal: Decodable {
    let title: String
    let status: String
}

struct ContextSlice<Item: Decodable>: Decodable {
    let items: [Item]
    let total: Int
    let returned: Int
    let truncated: Bool
}

struct WorkTask: Decodable {
    let id: String
    let title: String
    let description: String?
    let status: String
}

struct Finding: Decodable {
    let id: String
    let summary: String
    let detail: String?
    let currentness: String?
}

struct Slices: Decodable {
    let tasks: ContextSlice<WorkTask>
    let findings: ContextSlice<Finding>
}

struct Context: Decodable {
    let workspace: Workspace
    let goal: Goal?
    let slices: Slices
    let generatedAt: String
}

struct Envelope<Value: Decodable>: Decodable {
    let ok: Bool
    let result: Value?
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: swift ParityDecode.swift <viewer-response.json>\n".utf8))
    exit(64)
}

let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let envelope = try JSONDecoder().decode(Envelope<Context>.self, from: data)
guard envelope.ok, let context = envelope.result else {
    throw NSError(domain: "CampfireParity", code: 1)
}

let output: [String: Any] = [
    "workspaceId": context.workspace.id,
    "workspaceName": context.workspace.name,
    "goalTitle": context.goal?.title ?? "",
    "taskIds": context.slices.tasks.items.map(\.id),
    "findingIds": context.slices.findings.items.map(\.id),
    "tasks": [
        "total": context.slices.tasks.total,
        "returned": context.slices.tasks.returned,
        "truncated": context.slices.tasks.truncated,
    ],
    "findings": [
        "total": context.slices.findings.total,
        "returned": context.slices.findings.returned,
        "truncated": context.slices.findings.truncated,
    ],
]

let encoded = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
FileHandle.standardOutput.write(encoded)
FileHandle.standardOutput.write(Data("\n".utf8))
