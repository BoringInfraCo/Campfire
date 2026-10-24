# SHR-001 snapshot manifest

**Status:** Frozen for schema v1. The exporter and Worker share this allowlist
through `src/domain/publication.ts`; neither side may infer extra columns.

## 1. Included tables and fields

| Table | Included fields | Notes |
| --- | --- | --- |
| `workspaces` | id, name, description, status, created_by_actor_id/type, created_at, updated_at | `team_id` is rewritten to the hosted enrollment team |
| `humans` | id, display_name, external_identity, created_at | Only referenced humans; team rewritten; owner row updated with snapshot provenance after enrollment |
| `agents` | id, human_id, name, harness, model, created_at | `instance_metadata` excluded; owner-agent rows updated with snapshot provenance after enrollment |
| `workspace_participants` | actor_id, actor_type, role, joined_at | Owner must be the publishing human |
| `agent_sessions` | id, agent_id, human_id, harness, started_at, ended_at | Preserves active/ended state |
| `goals` | id, title, description, status, creator, agent_session_id, timestamps | Exactly the selected workspace |
| `tasks` | id, title, description, status, assignee, creator, agent_session_id, timestamps | Exactly the selected workspace |
| `findings` | id, summary, detail, confidence, source_artifact_id, currentness, predecessor/successor, correction fields, creator, session, created_at | Evidence is separate |
| `decisions` | id, summary, rationale, status, approver, predecessor/successor, supersede fields, creator, session, timestamps | Citations are separate |
| `artifacts` | id, type, title, uri_or_path, metadata, creator, session, created_at | URI must be HTTP(S); metadata is bounded and scanned |
| `contributions` | id, actor, session, action, object_type, object_id, payload, append_position, created_at | Positions must be contiguous from 1 |
| `finding_transitions` | finding_id, successor_id, kind, reason, actor, session, created_at | Edges validated |
| `decision_transitions` | decision_id, successor_id, kind, reason, actor, session, created_at | Edges validated |
| `finding_evidence` | id, finding_id, artifact_id, relation, note, actor, session, created_at | References validated |
| `decision_citations` | id, decision_id, finding_id, note, actor, session, created_at | References validated |

## 2. Excluded state

| Source | Decision |
| --- | --- |
| `actor_tokens` | Never exported. Fresh hosted credentials are minted locally; only hashes are enrolled. |
| `workspace_invites` | Never imported. A consumed invite is historical provenance and is allowed; an open invite fails publication. |
| `enrollment_invitations` | Any workspace row fails publication. Historical contribution provenance may remain. |
| `managed_agent_slots` | Any workspace row fails publication. |
| `action_proposals`, `action_target_reservations`, `action_receipts`, `action_mutation_receipts` | Any workspace row fails publication; action history is not partially imported. |
| `github_source_bindings` | Any workspace row fails publication. |
| `github_ingress_deliveries` | Any delivery for a source bound to this workspace fails publication. |
| `github_ingress_receipts` | Any workspace row fails publication. |
| `domain_events` | Derived outbox state; not collaboration state. Excluded rather than replayed. |
| `webhook_deliveries` | Instance operation; excluded. No external delivery is replayed. |
| `telemetry_claims`, `telemetry_install_tokens` | Instance operation and telemetry authority; excluded. |
| `schema_migrations` | Hosted schema is owned by the Worker and its migrations. |
| `agents.instance_metadata` | Auxiliary harness metadata is excluded to avoid provider/secret leakage. |
| Raw transcripts, prompts, tool arguments, webhook secrets, provider credentials | Never represented in the schema; credential-shaped values are refused if found in allowed text/auxiliary fields. |

## 3. Relationships validated before a write

- `workspace.id == snapshot.workspaceId`.
- `owner.humanId` is a human participant with role `owner`.
- `workspace.createdByActorId` resolves to an imported human or agent.
- Every participant resolves to an imported human or agent.
- Every session resolves to an imported agent and human.
- Goal/task/finding/decision/artifact creator actors resolve.
- Task assignee and decision approver, when present, resolve.
- Finding source artifact, predecessor, successor, corrected-by, and session
  references resolve.
- Decision predecessor, successor, superseded-by, and session references resolve.
- Evidence and citation finding/artifact/decision references resolve.
- Transition finding/decision/actor/session references resolve.
- Contribution actor/session resolves; object type is in the allowlist.
- Contribution append positions are exactly `1..tip` with no duplicates.
- Counts match array lengths and the source tip.
- No duplicate ids in any object family.
- Total rows and canonical bytes are within the frozen limits.

## 4. Presentation checks at the boundary

- Artifact `uri_or_path` must be `http://` or `https://`; `file:`, absolute
  paths, UNC paths, and `~` paths are refused.
- Artifact URL query keys/values are scanned for credential-shaped names/values.
- Artifact metadata and contribution payloads are bounded JSON; secret-like keys
  (`token`, `secret`, `password`, `credential`, `authorization`, `api_key`,
  `webhook`, `cookie`, `private_key`) and prototype keys (`__proto__`,
  `constructor`, `prototype`) are refused.
- **Every string in the snapshot** is scanned, including finding summaries and
  details, decision rationales, task descriptions, notes, workspace names, and
  external identities. Credential-shaped strings (`cft_`, `cfe_`, `cfr_`, `sk-`,
  GitHub token prefixes, `Bearer ...`, private-key headers) absolute
  filesystem paths, URL userinfo, and credential-bearing URL query/fragment keys
  are refused.
- `externalIdentity` is preserved as structured identity; it is not a verified
  account or an invitation authority.
- The snapshot workspace id and name must equal the source workspace recorded at
  hosted enrollment.

## 5. Size and visibility

The import is one D1 batch. 500 rows and 256 KiB keep the slice well below a
single-batch statement/body budget. A workspace above either limit is refused
with `reduce_workspace_scope`; no chunking and no partial visibility exist in v1.
Because the batch is atomic, ordinary reads and invitations cannot observe a
half-imported workspace. The publication receipt is the last statement in the
same batch.
