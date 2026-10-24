import { mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { openSqliteStore } from "../../src/store/sqlite-store.js";
import { hashToken } from "../../src/service/tokens.js";
import type { CampfireStore } from "../../src/store/store.js";

export const SHR = {
  organizationId: "org_boringinfra",
  teamId: "team_engineering",
  humanId: "hum_sergio",
  humanName: "Sergio",
  agentId: "agt_codex_macbook",
  agentName: "Codex",
  workspaceId: "ws_df6794f33efc459b",
  workspaceName: "Arbora audit",
  goalId: "goal_arbora_audit",
  findingId: "find_5cd543722a044c20",
  decisionId: "dec_arbora_scope",
  artifactId: "art_arbora_report",
  sessionId: "ses_codex_arbora",
  humanToken: `cft_${"a".repeat(32)}`,
  agentToken: `cft_${"b".repeat(32)}`,
} as const;

const human = { actorId: SHR.humanId, actorType: "human" as const };
const agent = { actorId: SHR.agentId, actorType: "agent" as const };

function at(seconds: number): string {
  return new Date(Date.UTC(2026, 9, 23, 12, 0, seconds)).toISOString();
}

export function seedShrLocalWorkspace(databasePath: string): void {
  mkdirSync(join(databasePath, ".."), { recursive: true });
  const store: CampfireStore = openSqliteStore(databasePath);
  try {
    store.createOrganization({ id: SHR.organizationId, name: "Boring Infra Co.", createdAt: at(0) });
    store.createTeam({ id: SHR.teamId, organizationId: SHR.organizationId, name: "Engineering", createdAt: at(1) });
    store.createHuman({ id: SHR.humanId, teamId: SHR.teamId, displayName: SHR.humanName, createdAt: at(2) });
    store.createAgent({
      id: SHR.agentId,
      teamId: SHR.teamId,
      humanId: SHR.humanId,
      name: SHR.agentName,
      harness: "codex",
      model: "gpt-5",
      createdAt: at(3),
    });
    store.createActorToken({
      id: "tok_human_local",
      actor: human,
      tokenHash: hashToken(SHR.humanToken),
      createdAt: at(4),
    });
    store.createActorToken({
      id: "tok_agent_local",
      actor: agent,
      tokenHash: hashToken(SHR.agentToken),
      createdAt: at(5),
    });
    store.createWorkspace({
      id: SHR.workspaceId,
      teamId: SHR.teamId,
      name: SHR.workspaceName,
      description: "Arbora workspace created on the MacBook",
      status: "active",
      createdBy: human,
      createdAt: at(6),
      updatedAt: at(20),
    });
    store.addParticipant({ workspaceId: SHR.workspaceId, actor: human, role: "owner", joinedAt: at(7) });
    store.addParticipant({ workspaceId: SHR.workspaceId, actor: agent, role: "agent", joinedAt: at(8) });
    store.createContribution({
      id: "con_workspace_create",
      workspaceId: SHR.workspaceId,
      actor: human,
      action: "create",
      objectType: "workspace",
      objectId: SHR.workspaceId,
      payload: { name: SHR.workspaceName },
      createdAt: at(6),
    });
    store.createContribution({
      id: "con_human_join",
      workspaceId: SHR.workspaceId,
      actor: human,
      action: "join",
      objectType: "participant",
      objectId: SHR.humanId,
      payload: { role: "owner" },
      createdAt: at(7),
    });
    store.createContribution({
      id: "con_agent_join",
      workspaceId: SHR.workspaceId,
      actor: agent,
      action: "join",
      objectType: "participant",
      objectId: SHR.agentId,
      payload: { role: "agent" },
      createdAt: at(8),
    });
    store.createAgentSession({
      id: SHR.sessionId,
      agentId: SHR.agentId,
      humanId: SHR.humanId,
      workspaceId: SHR.workspaceId,
      harness: "codex",
      startedAt: at(9),
    });
    store.createContribution({
      id: "con_session_register",
      workspaceId: SHR.workspaceId,
      actor: agent,
      agentSessionId: SHR.sessionId,
      action: "register_session",
      objectType: "agent_session",
      objectId: SHR.sessionId,
      payload: { harness: "codex" },
      createdAt: at(9),
    });
    store.createGoal({
      id: SHR.goalId,
      workspaceId: SHR.workspaceId,
      title: "Audit Arbora",
      description: "Verify the billing deployment finding",
      status: "active",
      createdBy: human,
      createdAt: at(10),
      updatedAt: at(10),
    });
    store.createContribution({
      id: "con_goal_create",
      workspaceId: SHR.workspaceId,
      actor: human,
      action: "create",
      objectType: "goal",
      objectId: SHR.goalId,
      payload: { title: "Audit Arbora" },
      createdAt: at(10),
    });
    store.createArtifact({
      id: SHR.artifactId,
      workspaceId: SHR.workspaceId,
      type: "report",
      title: "Arbora audit report",
      uriOrPath: "https://example.invalid/arbora/audit-report",
      metadata: { kind: "audit-report" },
      createdBy: human,
      createdAt: at(11),
    });
    store.createContribution({
      id: "con_artifact_create",
      workspaceId: SHR.workspaceId,
      actor: human,
      action: "create",
      objectType: "artifact",
      objectId: SHR.artifactId,
      payload: { title: "Arbora audit report" },
      createdAt: at(11),
    });
    store.createFinding({
      id: SHR.findingId,
      workspaceId: SHR.workspaceId,
      summary: "Arbora billing deploy used an unverified Worker version",
      detail: "The deploy record points at a Worker version that does not match the migration level.",
      confidence: 0.94,
      sourceArtifactId: SHR.artifactId,
      currentness: "current",
      createdBy: agent,
      agentSessionId: SHR.sessionId,
      createdAt: at(12),
    });
    store.createContribution({
      id: "con_finding_create",
      workspaceId: SHR.workspaceId,
      actor: agent,
      agentSessionId: SHR.sessionId,
      action: "create",
      objectType: "finding",
      objectId: SHR.findingId,
      payload: {
        summary: "Arbora billing deploy used an unverified Worker version",
        confidence: 0.94,
      },
      createdAt: at(12),
    });
    store.insertFindingEvidence({
      id: "fev_arbora_report",
      workspaceId: SHR.workspaceId,
      findingId: SHR.findingId,
      artifactId: SHR.artifactId,
      relation: "supports",
      note: "Deploy log and version stamp",
      createdBy: agent,
      agentSessionId: SHR.sessionId,
      createdAt: at(13),
    });
    store.createContribution({
      id: "con_evidence_create",
      workspaceId: SHR.workspaceId,
      actor: agent,
      agentSessionId: SHR.sessionId,
      action: "update",
      objectType: "finding",
      objectId: SHR.findingId,
      payload: { evidenceId: "fev_arbora_report", relation: "supports" },
      createdAt: at(13),
    });
    store.createDecision({
      id: SHR.decisionId,
      workspaceId: SHR.workspaceId,
      summary: "Hold the billing deploy until the Worker version is verified",
      rationale: "The finding is supported by the deploy report.",
      status: "accepted",
      approvedBy: human,
      createdBy: human,
      createdAt: at(14),
      updatedAt: at(15),
    });
    store.createContribution({
      id: "con_decision_create",
      workspaceId: SHR.workspaceId,
      actor: human,
      action: "create",
      objectType: "decision",
      objectId: SHR.decisionId,
      payload: { status: "accepted" },
      createdAt: at(14),
    });
    store.insertDecisionCitation({
      id: "cit_arbora_finding",
      workspaceId: SHR.workspaceId,
      decisionId: SHR.decisionId,
      findingId: SHR.findingId,
      note: "Direct basis",
      createdBy: human,
      createdAt: at(15),
    });
    store.createContribution({
      id: "con_citation_create",
      workspaceId: SHR.workspaceId,
      actor: human,
      action: "update",
      objectType: "decision",
      objectId: SHR.decisionId,
      payload: { citationId: "cit_arbora_finding" },
      createdAt: at(15),
    });
  } finally {
    store.close();
  }
}

export function writeShrLocalProfile(env: NodeJS.ProcessEnv, databasePath: string): void {
  const configDir = env.CAMPFIRE_CONFIG_DIR!;
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  const profile = {
    version: 1,
    databasePath,
    url: "http://127.0.0.1:9414",
    workspaceId: SHR.workspaceId,
    workspaceName: SHR.workspaceName,
    goalTitle: "Audit Arbora",
    humanId: SHR.humanId,
    humanName: SHR.humanName,
    agentId: SHR.agentId,
    agentName: SHR.agentName,
    harness: "codex",
  };
  const configPath = join(configDir, "config.json");
  writeFileSync(configPath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o644 });
  const credentialsPath = join(configDir, "credentials.json");
  writeFileSync(credentialsPath, `${JSON.stringify({ humanToken: SHR.humanToken, agentToken: SHR.agentToken }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(credentialsPath, 0o600);
}

export function isolatedProfileEnv(root: string): NodeJS.ProcessEnv {
  const home = join(root, "home");
  const config = join(root, "config");
  const data = join(root, "data");
  mkdirSync(home, { recursive: true });
  mkdirSync(config, { recursive: true, mode: 0o700 });
  mkdirSync(data, { recursive: true });
  return {
    ...process.env,
    HOME: home,
    CAMPFIRE_CONFIG_DIR: config,
    CAMPFIRE_DATA_DIR: data,
    CAMPFIRE_URL: undefined,
    CAMPFIRE_TOKEN: undefined,
    CAMPFIRE_HARNESS: undefined,
    CAMPFIRE_ACTOR_ID: undefined,
    CAMPFIRE_ACTOR_TYPE: undefined,
    CAMPFIRE_DB: undefined,
    CAMPFIRE_NO_BROWSER: "1",
  };
}
