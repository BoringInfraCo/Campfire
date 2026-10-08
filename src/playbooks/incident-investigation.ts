/**
 * The incident-investigation workspace playbook (WOW-001).
 *
 * Static, harness-independent guidance for recording an investigation so a
 * later person or agent can continue it from authorized workspace state alone.
 * It adds no domain object, no lifecycle, and no write path. It contains no
 * workspace data and requires no model. Wording is frozen before the first
 * pilot run; see docs/Campfire-v1.13-WOW-001-Prove-a-Way-of-Working.md 4.1.
 */
export interface PlaybookStage {
  readonly id: string;
  readonly title: string;
  readonly guidance: readonly string[];
}

export interface PlaybookDefinition {
  readonly kind: "campfire_playbook";
  readonly schemaVersion: 1;
  readonly name: "incident-investigation";
  readonly version: string;
  readonly stages: readonly PlaybookStage[];
  readonly rules: readonly string[];
}

export const INCIDENT_INVESTIGATION_PLAYBOOK: PlaybookDefinition = {
  kind: "campfire_playbook",
  schemaVersion: 1,
  name: "incident-investigation",
  version: "1.0.0",
  stages: [
    {
      id: "frame",
      title: "Frame",
      guidance: [
        "Reuse the incident goal or create one.",
        "Record the symptom as a finding: summary states the user-visible failure; detail states impact, affected surface, start and latest observed time, and scope.",
        "Register the alert, log excerpt, or report as an artifact and cite it as evidence from the symptom finding.",
        "Never state a cause in the symptom finding.",
      ],
    },
    {
      id: "facts",
      title: "Facts",
      guidance: [
        "Record each observed fact as its own finding as it is learned.",
        "detail carries the observation time and the exact signal.",
        "Cite evidence promptly, using a follow-up citation call when the create operation cannot attach it.",
        "Do not merge inference into a fact.",
      ],
    },
    {
      id: "hypotheses",
      title: "Hypotheses",
      guidance: [
        "Record each hypothesis as a finding with confidence and a detail that states what would confirm or refute it.",
        "A hypothesis is never stated as fact.",
        "Record the step that tests it as a task; record the result as a new finding or a correction.",
      ],
    },
    {
      id: "corrections",
      title: "Corrections",
      guidance: [
        "When a recorded fact or hypothesis is wrong, correct or withdraw it through the existing path with a reason.",
        "Never silently overwrite a record and never leave a refuted hypothesis current.",
        "To replace a decision, propose a new decision with replacesDecisionId and accept it only after explicit authorized approval, with a reason.",
        "Retire a choice through retire_decision with a reason.",
      ],
    },
    {
      id: "converge",
      title: "Converge",
      guidance: [
        "Record the cause as a finding with confidence and cited evidence.",
        "If the evidence is inconclusive, say so explicitly and record what remains unknown and what test would resolve it.",
        "Never present an uncited cause as fact.",
      ],
    },
    {
      id: "decide",
      title: "Decide",
      guidance: [
        "Propose the response as a decision with rationale and basis citations to the relevant findings, whose evidence cites artifacts.",
        "Acceptance requires explicit approval from an authorized actor; never approve your own proposal automatically.",
        "A replacement names its predecessor and, if accepted, records the reason.",
      ],
    },
    {
      id: "continuable",
      title: "Leave it continuable",
      guidance: [
        "Record follow-up work as tasks with assignees where known.",
        "Check that the workspace answers: what happened, what is believed, what response is proposed or approved, what is next, what is uncertain.",
        "Do not paste transcripts or unrelated conversation into state.",
      ],
    },
  ],
  rules: [
    "One statement per finding and one choice per decision.",
    "Register evidence and cite it promptly through the available operations.",
    "Distinguish observation, inference, and choice.",
    "Record the acting identity and session honestly.",
    "Keep uncertainty visible.",
    "needsReview remains a read-time result and is never faked.",
    "Acceptance of a decision requires explicit approval from an authorized actor; an agent never approves its own proposal automatically.",
  ],
};
