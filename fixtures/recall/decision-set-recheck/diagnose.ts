/**
 * Unscored recipient diagnostic for the RCL-003 §0 decision-projection correction.
 *
 * This is NOT a pilot. It scores nothing, produces no verdict, and does not
 * rerun, rescore, or read as a rerun of any RCL pilot. Its only question is
 * behavioural: does a fresh OpenCode recipient handed the CORRECTED offline
 * packet still lift a superseded decision's rationale into a live condition?
 *
 *   npx tsx fixtures/recall/decision-set-recheck/diagnose.ts
 *
 * Shape follows `fixtures/recall/rcl-002/diagnose.ts` (seed through the real
 * service, project, delete the credential and database, spawn a fresh sandboxed
 * harness process with nothing but a packet) and the sandbox-profile discipline
 * of `fixtures/recall/rcl-003/run.ts` (both path spellings, `.git` denied, host
 * OpenCode/Codex state denied, `PWD` pinned to the arm directory).
 *
 * Output lives outside the checkout at `~/.campfire-pilot/decision-set-recheck`
 * and never inside `~/.campfire-pilot/rcl-003`.
 *
 * The five checks are declared below, before any run, and are recorded pass or
 * fail. They are not assertions that abort the diagnostic when they fail: a
 * failing check is the measurement.
 *
 * Check 1 classifies the answer rather than matching literal markers, and it
 * records which kind of pass occurred. A pass by substance (the condition was
 * raised and rejected) is a different observation from a pass by silence (no
 * signal was found at all); the first version of this check reported the second
 * as the first, which is why a `not-raised` result now carries its own search
 * record and never claims more than it searched. A reading the routine cannot
 * settle is recorded as `indeterminate` and is never reported as a pass.
 *
 *   npx tsx fixtures/recall/decision-set-recheck/diagnose.ts --self-test
 *
 * `--self-test` runs the check 1 classifier offline over synthetic answers and
 * the retained October 12 answer. It seeds nothing, spawns nothing, reads no
 * packet, and touches nothing outside this file. It is a regression guard, not
 * evidence: 9 of its 28 cases are in-sample and 19 were written to defeat the
 * routine, 5 of which lock a known safe-direction failure in place on purpose.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parseOpencodeEvents } from "../../../src/acceptance/real/opencode-events.js";
import { DECISION_SET_LINKED_NEXT_STEP, type CampfireHandoffPacket } from "../../../src/domain/recall.js";
import type { ActorRef } from "../../../src/domain/types.js";
import { createCampfireService } from "../../../src/service/campfire-service.js";
import type { ActorContext } from "../../../src/service/authorization.js";
import { openSqliteStore } from "../../../src/store/sqlite-store.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(homedir(), ".campfire-pilot/decision-set-recheck");
const ARM_DIR = join(OUT, "arm");
const WORK_DIR = join(ARM_DIR, "work");
const PRIVATE_DIR = join(ARM_DIR, "private");
const INSPECT_DIR = join(OUT, "inspect");
const DB_PATH = join(PRIVATE_DIR, "campfire.db");
/** The recipient harness and model the RCL-003 recipients used (RUN-LOCK.md). */
const OPENCODE_BIN = "/Users/sergio/.opencode/bin/opencode";
const OPENCODE_VERSION = "2.0.26";
const OPENCODE_MODEL = "opencode-go/glm-5.2#max";
const RECIPIENT_BUDGET_MINUTES = 10;
/** Prior pilot roots hold prior packets, answers, and event streams. */
const OLD_PILOT_ROOTS = ["rcl-001", "rcl-002", "rcl-003"].map((name) => resolve(homedir(), `.campfire-pilot/${name}`));

const TEAM_ID = "team_dsr";
const QUERY = "the ledger export";
const GOAL = "Ship the ledger export.";
const TASK = "Set the ledger export release rule.";
const FINDING = "The release log for the ledger export stops at 02:00 and no page follows it.";
const PREDECESSOR_SUMMARY = "Release the ledger export nightly at 02:00.";
/**
 * The trap. It lives only in the superseded predecessor's rationale and reads
 * like a live operational precondition, which is the whole point: the text is
 * entirely reasonable, and lifting it is the RCL-003 S2 recipient failure.
 */
const PREDECESSOR_RATIONALE =
  "The nightly run hid a two-hour outage before anyone was paged, so keep the 02:00 job disabled until two on-request releases have run twice with no operator escalation.";
const REPLACEMENT_SUMMARY = "Release the ledger export on operator request only.";
const REPLACEMENT_RATIONALE = "Operator-requested releases only, and keep the 02:00 job disabled.";
const SUPERSEDE_REASON = "the nightly run hid a two-hour outage before anyone was paged";
const DECOY_SUMMARY = "Publish the ledger export changelog weekly.";
/** The distinct clause the recipient must never apply as a current condition. */
const PRECONDITION = "until two on-request releases have run twice with no operator escalation";
/** Newer accepted decisions on other topics, so the keyed pair is off page one. */
const FILLER_COUNT = 11;

/**
 * The recipient prompt. It mirrors the RCL-003 recipient continuation shape and
 * says nothing about supersession, history, or rationales. Any signal about a
 * superseded rationale must come from the packet, not from here.
 */
const PROMPT = [
  "Using only the offline packet, continue the ledger export release work. State the goal, the prior evidence you rely on, the decision status, the next action, and any uncertainty. The packet is the file packet.json in this directory.",
  "",
  "The offline packet is the file packet.json in this directory. Do not use a Campfire credential or a live workspace.",
].join("\n");

interface SeedFacts {
  workspaceId: string;
  predecessorId: string;
  replacementId: string;
  decoyId: string;
  findingId: string;
  readerId: string;
  query: string;
}

/* ------------------------------------------------------------------------- *
 * Checks. Declared here, before the run, and never tuned to an outcome.
 * ------------------------------------------------------------------------- */

/* ------------------------------------------------------------------------- *
 * The superseded condition: its semantic shape, derived rather than quoted
 *
 * The first version of check 1 looked for three literal fragments of the
 * superseded clause ("two on-request releases", "twice with no operator
 * escalation", "have run twice"). On the October 12 answer it matched none of
 * them, printed "the answer never mentions the superseded precondition", and
 * returned pass. The answer did mention it — as "any condition about waiting
 * for clean on-request releases" — and correctly rejected it. That was a pass
 * produced by silence, and silence is not evidence of absence.
 *
 * The routine below works from the clause's shape instead:
 *
 *   1. Derive the condition clause from the rationale the fixture was seeded
 *      with ("... disabled UNTIL two on-request releases have run twice with
 *      no operator escalation").
 *   2. Decide which of that clause's words are DISTINCTIVE: they occur nowhere
 *      in the rest of the seeded text, so no current decision, finding, or
 *      supersession reason could be the thing an answer is talking about. Shared
 *      words — "two" (the two-hour outage), "release", "operator", "run" — are
 *      deliberately NOT reference signals on their own, because the current
 *      replacement rule is about operator-requested releases too. Reading those
 *      as a reference is what turns a correct answer into noise.
 *   3. Cut the answer into clauses — the smallest unit one qualifier may
 *      govern — and classify each reference clause by how it frames the
 *      condition.
 *
 * This is a heuristic, and a narrow one. It is a declared vocabulary over clause
 * shapes, with no comprehension of the answer and no model behind it. It can
 * miss a paraphrase that falls outside the declared patterns, and a sentence
 * that both denies and applies the condition in one breath is reported
 * unsettled rather than resolved. Every run records that caveat next to the
 * bit, and `not-raised` says what was searched instead of asserting what is
 * absent.
 *
 * The bias is one-directional on purpose. A live gate is never allowed to pass
 * because a marker near it looked like a disclaimer, and a clause the routine
 * cannot place is `indeterminate`, which is not a pass. The price is false
 * failures: a correct rejection the vocabulary cannot read is reported as
 * unsettled rather than as a pass by substance. Those are listed, named, and
 * locked in `--self-test` so the price is visible rather than assumed.
 * ------------------------------------------------------------------------- */

/** How the answer treats the superseded condition. Recorded beside the boolean. */
type PreconditionStance = "not-raised" | "raised-and-rejected" | "raised-as-live" | "indeterminate";

/**
 * Emitted with every check 1 result so a reader is never left guessing a bit.
 *
 * The bias is stated here as well as enforced in the code: when the routine
 * cannot place a clause it says so (`indeterminate`, which never passes), and
 * when two readings are possible it takes the one that fails. The only pass it
 * offers from a clause that carries the condition's vocabulary is a clause that
 * marks that condition superseded *and* applies no gate to it.
 */
const PRECONDITION_HEURISTIC_CAVEAT =
  "heuristic: a declared lexical vocabulary over clause shapes, not comprehension. "
  + "It reads one clause at a time, so a sentence mixing an assertion and a denial of the condition is reported unsettled rather than resolved either way. "
  + "It can miss a paraphrase outside the declared patterns. "
  + "not-raised is an absence of signal, never evidence of absence; indeterminate is never a pass.";

/** Connectives that introduce a condition rather than a reason. */
const CONDITION_CONNECTIVES = /\b(?:until|before|prior to|ahead of|once|as soon as|unless|only after|only when|whenever)\b/i;

/** Function words carry no identifying content. */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "with", "no", "not", "is", "are", "was", "were",
  "be", "been", "being", "it", "that", "this", "as", "at", "by", "for", "from", "so", "then", "than",
  "there", "their", "they", "them", "we", "you", "our", "has", "have", "had", "do", "does", "did",
  "will", "would", "can", "could",
]);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contentWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z][a-z-]*/g) ?? []) {
    if (word.length <= 2 || STOPWORDS.has(word)) continue;
    words.add(word);
    // A compound counts as its head too: "two-hour outage" is why the clause's
    // "two" is known elsewhere and is not distinctive.
    const head = word.split("-")[0];
    if (head !== undefined && head.length > 2 && !STOPWORDS.has(head)) words.add(head);
  }
  return words;
}

/**
 * The gate itself, cut out of the rationale at its conditional connective. The
 * rationale's first clause is a reason ("the nightly run hid a two-hour
 * outage"), so the last conditional clause is the precondition. The connective
 * is returned separately: it is gate vocabulary, and it is not a distinguishing
 * feature — every "until" in an answer, including the current rule's, would
 * match it.
 */
function conditionClause(rationale: string): { introducedBy: string; body: string } {
  const clauses = rationale
    .split(/[;,.]|\bso\b|\bbecause\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const conditional = clauses.filter((part) => CONDITION_CONNECTIVES.test(part));
  const chosen = conditional[conditional.length - 1] ?? "";
  const match = CONDITION_CONNECTIVES.exec(chosen);
  const at = match?.index ?? -1;
  const connective = match?.[0] ?? "";
  return { introducedBy: connective.trim(), body: (at >= 0 ? chosen.slice(at + connective.length) : chosen).trim() };
}

interface ConditionShape {
  introducedBy: string;
  body: string;
  distinctive: ReadonlyArray<{ term: string; pattern: RegExp }>;
  shared: string[];
}

function deriveConditionShape(rationale: string, siblings: readonly string[]): ConditionShape {
  const { introducedBy, body } = conditionClause(rationale);
  const outsideTheClause = rationale.replace(body, " ").replace(introducedBy, " ");
  const elsewhere = new Set<string>();
  for (const text of [outsideTheClause, ...siblings]) {
    for (const word of contentWords(text)) elsewhere.add(word);
  }
  const distinctive: Array<{ term: string; pattern: RegExp }> = [];
  const shared: string[] = [];
  for (const word of contentWords(body)) {
    if (elsewhere.has(word)) shared.push(word);
    else distinctive.push({ term: word, pattern: new RegExp(`\\b${escapeRegExp(word)}\\b`, "i") });
  }
  // A degenerate shape matches nothing in any answer, so every answer would come
  // out `not-raised`: the exact silent pass this routine exists to remove. Fail
  // loudly here rather than measure nothing.
  if (body.length === 0 || distinctive.length === 0) {
    fail(`the superseded condition clause "${body}" yielded no distinctive term; check 1 cannot classify and must not report not-raised`);
  }
  return { introducedBy, body, distinctive, shared };
}

/**
 * The shape of the condition this run measures. `siblings` is every other piece
 * of seeded text an answer could legitimately be quoting; a clause word that
 * also lives there is not distinctive and cannot raise a reference by itself.
 */
const CONDITION = deriveConditionShape(PREDECESSOR_RATIONALE, [
  PREDECESSOR_SUMMARY,
  FINDING,
  SUPERSEDE_REASON,
  REPLACEMENT_SUMMARY,
  REPLACEMENT_RATIONALE,
]);

/**
 * Paraphrase coverage the seeded rationale does not spell out. Declared, not
 * derived, and recorded as declared in every result so nobody mistakes these
 * for something the fixture taught the routine.
 *
 * "page" and "paged" are deliberately absent: the fixture's own finding says
 * "no page follows it", and admitting that word as an escalation synonym would
 * raise a reference out of a sentence about the current evidence. A paraphrase
 * that says "nobody was paged" and nothing else is therefore a miss, not a
 * false positive.
 *
 * `operator-requested` is likewise deliberately absent, in the other direction:
 * it is the current replacement rule's own wording ("Operator-requested
 * releases only"), so admitting it as a reference signal would raise a
 * reference out of a sentence that is only restating the live rule.
 *
 * These patterns only ever ADD references, which can cost the run a `FAIL` or an
 * `indeterminate` and cannot produce a pass. That is the direction to widen in.
 */
const DECLARED_PARAPHRASES: ReadonlyArray<{ term: string; declared: string; pattern: RegExp }> = [
  { term: "clean-release", declared: "clean / quiet / uneventful releases", pattern: /\b(?:clean|cleanly|quiet|quietly|uneventful|uneventfully|incident[- ]free|no\s+incidents?)\b/i },
  { term: "release-count", declared: "a count of releases before the gate clears", pattern: /\b(?:two|2|three|3|several|successive|consecutive|multiple|a\s+few|a\s+couple(?:\s+of)?|a\s+handful(?:\s+of)?)\b[^.!?]{0,24}\b(?:releases?|runs?|deploys?|ships?|publishes?)\b/i },
  { term: "un-escalated", declared: "nobody paged, escalated, woken or called", pattern: /\b(?:nobody|no\s?one|no\s+human)\s+(?:was\s+|being\s+|got\s+|gets\s+|is\s+|are\s+|had\s+to\s+be\s+|has\s+to\s+be\s+|have\s+to\s+be\s+)?(?:paged|escalated|notified|interrupted|pinged|woken(?:\s+up)?|roused|called|disturbed|badgered)\b/i },
];

/** Conditional and gate vocabulary, used to describe shape and to spot near misses. */
const GATE_VOCABULARY: ReadonlyArray<{ term: string; pattern: RegExp }> = [
  { term: "until", pattern: /\buntil\b/i },
  { term: "before", pattern: /\bbefore\b/i },
  { term: "once/only-after/only-when", pattern: /\b(?:once|as soon as|only after|only when)\b/i },
  { term: "subject-to/contingent-on", pattern: /\b(?:prior to|ahead of|subject to|contingent on|depends? on)\b/i },
  { term: "condition-noun", pattern: /\b(?:precondition|prerequisite|requirement|gate|criterion|criteria|condition|conditions|clause)\b/i },
  { term: "wait-for", pattern: /\b(?:wait(?:s|ed|ing)?\s+(?:for|on)|pending)\b/i },
  { term: "obligation", pattern: /\b(?:must|shall|has to|have to|needs? to|is required to|are required to)\b/i },
];

/**
 * Wording that declares the clause NOT current. Declared, not derived.
 *
 * Every entry is a whole-phrase, word-bounded pattern, and every one is tested
 * against a single CLAUSE (see `clauses`) rather than against the whole
 * sentence. That scoping is the point: a qualifier must not be able to qualify
 * an assertion it does not govern. The earlier version of this list held the
 * bare string "must not" and was applied as a sentence substring, which made
 * "must not ship until <condition>" — a prohibition, and the sharpest possible
 * statement of a live gate — read as a historical disclaimer and pass the check
 * with the strongest claim the file makes.
 *
 * Prohibition is therefore absent here. It lives in the two scoped lists below,
 * where a prohibition is either a gate (the default) or a statement about the
 * clause's own standing (the one exception, and it is narrow).
 */
const HISTORICAL_QUALIFIERS: readonly RegExp[] = [
  /\bsupersed(?:e|es|ed|ing)\b/i,
  /\bno longer\b/i,
  /\bnot\s+(?:a\s+)?current\b/i,
  /\bhistor(?:y|ical|ically)\b/i,
  /\bformer(?:ly)?\b/i,
  /\b(?:was|were|is|are|been|being)\s+replaced\b/i,
  /\b(?:does|do|did)\s+not\s+apply\b/i,
  /\bdoesn't\s+apply\b/i,
  /\bnot\s+(?:a\s+)?live\b/i,
  /\bexplains?\s+why\b/i,
  /\bonly\s+explains?\b/i,
  /\bnot\s+applicable\b/i,
  /\bnot\s+in\s+(?:force|effect|use)\b/i,
];

/**
 * A prohibition: an obligation whose fulfilment is denied.
 *
 * It states a gate more sharply than the affirmative ever does — "must not ship
 * until <condition>" is the condition applied as a current rule — so it is LIVE.
 * The one thing it is not is a statement that the clause is not in force, which
 * is what `PROHIBITS_USE_OF_CLAUSE` below covers.
 */
const PROHIBITION = /\b(?:must|shall|should|will|may)\s+not\b|\b(?:cannot|can't|mustn't)\b/i;

/**
 * The narrow exception: a prohibition whose object is the clause's being used,
 * not anything in the world. "It must not be assumed that the export is gated
 * on ...", "this must not be applied". This is the only sense in which the
 * phrase "must not" marks a rejection, and it is scoped to that object instead
 * of to the sentence.
 */
const PROHIBITS_USE_OF_CLAUSE =
  /\b(?:must|shall|should|can|could|may)\s+not\s+be\s+(?:assumed|taken|applied|treated|used|read|relied\s+on|adopted|cited|inferred|carried\s+out|held\s+to|acted\s+on)\b/i;

/** Declared rejection phrasings: carrying no weight is a rejection. */
const REJECTION_PHRASES: readonly RegExp[] = [
  /\b(?:carry|carries|has|have)\s+no\s+(?:current|present|force|weight|bearing|effect)\b/i,
  /\bno\s+(?:current|present)\s+(?:weight|force|bearing|effect)\b/i,
  /\bdoes\s+not\s+(?:gate|block|govern|apply|bind|constrain)\b/i,
  /\bnot\s+in\s+(?:force|effect|use)\b/i,
  /\bno\s+longer\s+(?:applies|governs|in\s+force|carries)\b/i,
  /\bcannot\s+be\s+applied\b/i,
  /\bnot\s+something\s+to\s+apply\b/i,
  // A denial that no obligation exists. It is the negation of a gate, so it is a
  // rejection and it also denies the gate words next to it (see `denies`).
  /\bno\s+(?:need|requirement|obligation|reason)\s+to\b/i,
];

const REQUEST_VERB = /\b(seek|seeks|seeking|request|requests|requesting|ask|asks|require|requires|required|need|needs|needed|await|awaits|pending|outstanding|before acting|before executing|before running|should be recorded|recommend)\b/i;
const REQUEST_TARGET = /\b(retire|retirement|retired|review|reviewed|replace|replacement|supersede|supersession|transition|resolve|resolution)\b/i;
/** A sentence that denies or records-already the need is not a request for one. */
const NOT_A_REQUEST = /\b(no|not|never|none|neither|already|without|recorded|does not|do not|isn't|aren't|nothing|unneeded|unnecessary)\b/i;
const OPERATIVE_WORDING = /\b(operative|replacement|replaced|supersedes|governs|governing|takes precedence|current rule|in force|is the rule|must apply|shall apply)\b/i;
/** The decoy is a proposal. Mentioning it as a proposal is not promoting it. */
const PROPOSAL_QUALIFIER = /\b(proposed|proposal|not accepted|unaccepted|no accepted|is not a rule|not a release rule|suggestion|pending|not yet|never accepted)\b/i;

/** Verbs that make a nearby condition noun a present-tense assertion of it. */
const STANCE_VERBS = "(?:is|are|remains?|stays?|counts?|acts?|applies?|governs?|binds?|serves? as)";
/** What the condition can be predicated of. "rule" is here only as a release rule. */
const CONDITION_NOUNS = /\b(?:precondition|prerequisite|requirement|gate|criterion|criteria|condition|conditions|clause|release rule)\b/i;
/** Anything that un-does an assertion in the clause. */
const NEGATION = /\b(?:not|no|never|none|neither|without|nor|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|cannot|can't)\b/i;
/**
 * What counts as a denial when the routine asks "is this gate word negated?".
 * `NEGATION` alone misses the phrasing that denies the gate without negating any
 * single word in it — "there is no need to wait for ...", "no requirement
 * exists to wait for ...". Those are denials of the gate, and the gate word is
 * right beside them. The window this is tested over is short, so a denial that
 * belongs to a different part of the clause does not reach.
 */
const DENIAL = /\b(?:not|no|never|none|neither|without|nor|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|cannot|can't)\b|\bno\s+(?:need|requirement|obligation|reason)\s+to\b/i;
/** How much text before a hit may carry a negation without un-doing it. */
const NEGATION_LOOKBACK = 24;

/**
 * Every declared spelling of a modal obligation. `matchAll`, because a clause
 * can carry more than one and a later un-negated one still counts.
 */
const OBLIGATION_MODAL =
  /\b(?:must|shall|should|will)\b|\b(?:has|have|had)\s+to\b|\bneeds?\s+to\b|\b(?:is|are|was|were)\s+required\s+to\b|\bremains?\s+required\s+to\b/gi;
/** The obligation trailing "not" and "never": "must not", "shall never". */
const OBLIGATION_TRAILING_NEGATION = /^\s*(?:not|never)\b/i;
/** What satisfying the obligation looks like, as the clause's own shape words it. */
const OBLIGATION_SATISFIED =
  /\b(?:wait|waits|be met|be satisfied|be complete|has run|have run|run|runs|running|occur|occurred|pass|passed|clear|cleared|reach|reached)\b/i;

/**
 * Whether the obligation at `match` stands at all.
 *
 * A negated obligation is not an obligation, and the negation lands in more than
 * one place. It follows the modal ("must not", "shall never") or precedes it
 * ("no longer has to", "there is no need to", "never has to"). The earlier code
 * only ever looked after the modal while its comment claimed to handle both, so
 * a correct rejection — "the export no longer has to wait for ..." — was read as
 * an obligation to satisfy the condition and failed the check.
 */
function obligationStands(clause: string, match: RegExpExecArray): boolean {
  const before = clause.slice(Math.max(0, match.index - NEGATION_LOOKBACK), match.index);
  const after = clause.slice(match.index + match[0].length);
  return !NEGATION.test(before) && !OBLIGATION_TRAILING_NEGATION.test(after);
}

/**
 * Gate and block vocabulary, global because a clause can hold several and one
 * negated occurrence must not silence the rest. It is the same gate vocabulary
 * `GATE_VOCABULARY` declares, minus the condition nouns that branch 1 already
 * reads as an assertion — `liveFraming` used to consult a narrower private list
 * than the file declared.
 */
const GATE_FRAMING =
  /\b(?:gated|gates|gatekeeping|gatekept|blocks?|blocked|blocking|holds? up|holding back|subject to|contingent on|depends? on|waits? on|waits? for|pending)\b/gi;

/** Asking for progress toward a condition is applying it, however it is labelled. */
const TRACKING = /\b(log|logs|logged|logging|track|tracking|tracked|count|counts|counting|tally|towards?|work toward|make progress on)\b/gi;

interface CheckResult {
  id: string;
  question: string;
  pass: boolean;
  detail: string;
  evidence: string[];
  /** Check 1 only: what the answer does with the condition, beside the bit. */
  classification?: PreconditionStance;
  /** Check 1 only: what kind of pass this is, so silence is never read as substance. */
  passBasis?: "substance" | "absence-of-signal" | null;
  /** Check 1 only: a human has to read the answer before any claim is made. */
  requiresHumanRead?: boolean;
  /** Check 1 only: the caveat that travels with the classification. */
  heuristic?: string;
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => (part.length > 0));
}

/**
 * The unit of assertion: the smallest stretch of text one qualifier may
 * govern.
 *
 * Finer than a sentence, on purpose. A qualifier says something about a
 * condition; it must not be allowed to reach across a semicolon, a comma, or a
 * dash to qualify an assertion it does not govern. With sentence granularity,
 * "Two on-request releases ... before the export may ship; that reading does
 * not apply to the current rule" was one unit, the disclaimer governed the
 * assertion, and the clause was recorded as rejected.
 *
 * The cost is that a sentence mixing a denial and an assertion is now two
 * readings rather than one, which usually lands on `indeterminate`. That is the
 * intended direction: prose that contradicts itself is not a settled rejection.
 *
 * `sentences` above is kept at sentence granularity because checks 2-5 quote
 * evidence in sentences and a half-clause is worse evidence.
 */
function clauses(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+|;|,\s+|\s*—\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Whether the clause declares the condition not current. Never a bare substring. */
function rejectsCondition(clause: string): boolean {
  return HISTORICAL_QUALIFIERS.some((pattern) => pattern.test(clause))
    || PROHIBITS_USE_OF_CLAUSE.test(clause)
    || REJECTION_PHRASES.some((pattern) => pattern.test(clause));
}

/** Why a clause treats the condition as live, or undefined when it does not. */
function liveFraming(clause: string): string | undefined {
  // A prohibition is an obligation whose fulfilment is denied. "Must not ship
  // until <condition>" applies the condition as a current rule more sharply than
  // any affirmative phrasing of the same gate does, so it is LIVE.
  //
  // The one exclusion is a prohibition whose object is the clause's own use:
  // "must not be applied", "must not be assumed". That is a statement about the
  // clause's standing, not about the world, so it is read as a rejection marker
  // (`PROHIBITS_USE_OF_CLAUSE`) rather than as a gate. It is an exclusion from
  // ONE branch only. It deliberately does not suppress the branches below: a
  // clause that both forbids relying on the clause and states a live gate is
  // contradictory prose, and the safe reading of that is `raised-as-live`, not
  // the pass a blanket suppression would produce.
  const deniesUse = PROHIBITS_USE_OF_CLAUSE.test(clause);

  // A present-tense assertion about a condition noun. The gap between the verb
  // and the noun is checked for a denial, so "is explicitly not a current
  // condition" reads as a rejection and not as an assertion.
  const asserted = new RegExp(`\\b${STANCE_VERBS}\\b([^.!?]{0,48}?)\\b${CONDITION_NOUNS.source}`, "gi");
  for (const match of clause.matchAll(asserted)) {
    if (!DENIAL.test(match[1] ?? "")) return `asserts the condition is current: "${match[0].trim()}"`;
  }

  if (!deniesUse) {
    const prohibited = PROHIBITION.exec(clause);
    if (prohibited !== null) return `prohibits proceeding until the condition holds: "${prohibited[0]}"`;
  }

  // An obligation to satisfy it: "must stay disabled until ... have run". No
  // distance window: the rule only ever runs on a reference clause, and a window
  // large enough to reach the gate is nearly the whole clause. A negated
  // obligation is not an obligation, whether the negation follows the modal
  // ("must not") or precedes it ("no longer has to", "no need to").
  if (OBLIGATION_SATISFIED.test(clause)) {
    for (const modal of clause.matchAll(OBLIGATION_MODAL)) {
      if (obligationStands(clause, modal)) return `puts an obligation to satisfy the condition on the reader: "${modal[0].trim()}"`;
    }
  }
  // Gate and block vocabulary, unless something immediately nearby denies it.
  // Every occurrence is examined: the earlier version took the first match only,
  // so one negated gate word ("is not blocked") silenced the live gate word
  // later in the same clause.
  for (const gated of clause.matchAll(GATE_FRAMING)) {
    const window = clause.slice(Math.max(0, gated.index - NEGATION_LOOKBACK), gated.index + gated[0].length);
    if (!DENIAL.test(window)) return `treats the condition as a gate: "${gated[0]}"`;
  }
  // Asking for progress toward it is applying it, however it is labelled. Same
  // shape as the gate scan: every occurrence counts, not just the first.
  for (const tracked of clause.matchAll(TRACKING)) {
    const window = clause.slice(Math.max(0, tracked.index - NEGATION_LOOKBACK), tracked.index);
    if (!DENIAL.test(window)) return `asks for progress toward the condition: "${tracked[0]}"`;
  }
  return undefined;
}

interface ConditionReading {
  sentence: string;
  reference: boolean;
  nearMiss: boolean;
  terms: string[];
  gate: string[];
  stance: "live" | "rejected" | "unsettled";
  why: string;
}

/** One clause, read against the derived condition shape. */
function readClause(clause: string): ConditionReading {
  const terms = [
    ...CONDITION.distinctive.filter((entry) => entry.pattern.test(clause)).map((entry) => entry.term),
    ...DECLARED_PARAPHRASES.filter((entry) => entry.pattern.test(clause)).map((entry) => entry.term),
  ];
  const gate = GATE_VOCABULARY.filter((entry) => entry.pattern.test(clause)).map((entry) => entry.term);
  const reference = terms.length > 0;
  const live = reference ? liveFraming(clause) : undefined;
  const rejection = rejectsCondition(clause);
  return {
    sentence: clause,
    reference,
    // Condition wording with no distinctive term is not a reference, but it is
    // the shape of a near miss, and it is recorded rather than dropped.
    nearMiss: !reference && (gate.length >= 2 || (CONDITION_NOUNS.test(clause) && rejection)),
    terms,
    gate,
    stance: live !== undefined ? "live" : rejection ? "rejected" : "unsettled",
    why: live ?? (rejection ? "framed as historical, superseded, or carrying no current weight" : "no stance signal"),
  };
}

interface PreconditionClassification {
  stance: PreconditionStance;
  clausesScanned: number;
  references: ConditionReading[];
  live: ConditionReading[];
  unsettled: ConditionReading[];
  rejected: ConditionReading[];
  nearMisses: ConditionReading[];
}

/**
 * The four outcomes, in the order they are decided:
 *
 *   raised-as-live      a reference clause applies the condition. Fails.
 *   not-raised          no reference clause at all. A pass, recorded as a pass
 *                       by silence with the search space attached to it.
 *   indeterminate       a reference the text does not settle. Never a pass.
 *   raised-and-rejected every reference clause marks it historical. A pass by
 *                       substance, and the only pass a reader should act on.
 *
 * There is no fifth outcome and no default. A clause the routine cannot place
 * is `unsettled`, and one unsettled reference is enough to make the whole
 * answer `indeterminate`. Silence is never resolved into `rejected`, and an
 * unplaced clause is never resolved into `not-raised`.
 */
function classifyPrecondition(answer: string): PreconditionClassification {
  const parts = clauses(answer);
  const readings = parts.map(readClause);
  const references = readings.filter((reading) => reading.reference);
  const live = references.filter((reading) => reading.stance === "live");
  const unsettled = references.filter((reading) => reading.stance === "unsettled");
  const rejected = references.filter((reading) => reading.stance === "rejected");
  const stance: PreconditionStance =
    parts.length === 0
      // No text to read is not an answer that avoided the condition. It is a
      // question the routine cannot settle, and it is recorded as one.
      ? "indeterminate"
      : live.length > 0
        ? "raised-as-live"
        : references.length === 0
          ? "not-raised"
          : unsettled.length > 0
            ? "indeterminate"
            : "raised-and-rejected";
  return {
    stance,
    clausesScanned: parts.length,
    references,
    live,
    unsettled,
    rejected,
    nearMisses: readings.filter((reading) => reading.nearMiss),
  };
}

/** The names of what the classifier looks for, for a one-line detail. */
function searchTerms(): string {
  return `distinctive derived terms [${CONDITION.distinctive.map((entry) => entry.term).join(", ")}] `
    + `+ declared paraphrase patterns [${DECLARED_PARAPHRASES.map((entry) => entry.term).join(", ")}] `
    + `+ gate vocabulary [${GATE_VOCABULARY.map((entry) => entry.term).join(", ")}]`;
}

/** What the classifier actually looked for. Attached to every result. */
function searchRecord(classification: PreconditionClassification): string {
  return `searched ${classification.clausesScanned} clause(s), split on sentence ends, semicolons, commas and dashes; `
    + `condition clause "${CONDITION.introducedBy} ${CONDITION.body}"; `
    + `${searchTerms()}; `
    + `clause words deliberately NOT distinctive because the current rule uses them too [${CONDITION.shared.join(", ")}]`;
}

/**
 * 1. The decisive check. The superseded precondition must not be stated, or
 *    acted on, as a live condition. The classification decides that; the boolean
 *    only reports it. `raised-and-rejected` is a pass by substance. `not-raised`
 *    is a pass by silence and says what it searched. `raised-as-live` fails.
 *    `indeterminate` fails too, and is flagged for human read, because a routine
 *    that cannot settle the question has not answered it.
 */
function checkSupersededPreconditionNotLive(answer: string): CheckResult {
  const classification = classifyPrecondition(answer);
  const { stance } = classification;
  const evidence = (readings: ConditionReading[]): string[] =>
    readings.map((reading) => `${reading.sentence}  [${reading.terms.join("+") || `gate:${reading.gate.join("+")}`}; ${reading.why}]`);
  const searched = searchRecord(classification);
  // Near misses are recorded for every outcome, not only for `not-raised`. A
  // clause the declared vocabulary could not place is the evidence a reader
  // needs whichever way the classification went.
  const nearMissEvidence = classification.nearMisses.map((reading) =>
    `${reading.sentence}  [near miss: no distinctive term; gate:${reading.gate.join("+")}]`);

  const detail = ((): string => {
    switch (stance) {
      case "raised-as-live":
        return `${classification.live.length} of ${classification.references.length} reference clause(s) apply the condition as a live gate; `
          + `${classification.rejected.length} frame it as historical.`;
      case "not-raised":
        return `no clause carried a distinctive term from the superseded clause, so no reference to it was found. `
          + `This is an absence of signal over ${classification.clausesScanned} clause(s), not evidence that the recipient never considered `
          + `the condition; the full search record and any near misses are in evidence. searched ${searchTerms()}`;
      case "indeterminate":
        return `INDETERMINATE — ${classification.clausesScanned === 0 ? "there is no answer text to read, so the condition cannot be placed either way" : `${classification.unsettled.length} of ${classification.references.length} reference clause(s) raise the condition without saying whether it is current`}. `
          + `NOT A PASS: read them before making any claim about this run. searched ${searchTerms()}`;
      case "raised-and-rejected":
        return `all ${classification.references.length} reference clause(s) mark the condition historical or superseded, and none applies it as a gate.`;
    }
  })();

  const citedEvidence = ((): string[] => {
    // The search record rides along with every outcome. A result whose evidence
    // is empty is a result that told the reader nothing about how it was
    // reached, which is the failure mode the `not-raised` detail exists to
    // prevent — so it is not a mode any other stance is allowed to have either.
    switch (stance) {
      case "raised-as-live":
        return [searched, ...evidence(classification.live), ...evidence(classification.rejected), ...evidence(classification.unsettled), ...nearMissEvidence];
      case "not-raised":
        return [searched, ...nearMissEvidence];
      case "indeterminate":
        return [searched, ...evidence(classification.unsettled), ...evidence(classification.rejected), ...evidence(classification.live), ...nearMissEvidence];
      case "raised-and-rejected":
        return [searched, ...evidence(classification.rejected), ...nearMissEvidence];
    }
  })();

  return {
    id: "1-superseded-precondition-not-live",
    question: "Does the answer state the superseded precondition as a live condition?",
    pass: stance !== "raised-as-live" && stance !== "indeterminate",
    detail,
    evidence: citedEvidence,
    classification: stance,
    // Null whenever the check did not pass, so "no pass basis" and "a pass by
    // silence" are never confused for one another.
    passBasis: stance === "not-raised" ? "absence-of-signal" : stance === "raised-and-rejected" ? "substance" : null,
    requiresHumanRead: stance === "indeterminate",
    heuristic: PRECONDITION_HEURISTIC_CAVEAT,
  };
}

/** 2. The accepted replacement is named as the rule that governs. */
function checkReplacementIsOperative(answer: string, facts: SeedFacts): CheckResult {
  const byId = answer.includes(facts.replacementId);
  const byText = /operator request only/i.test(answer);
  const operative = OPERATIVE_WORDING.test(answer);
  return {
    id: "2-replacement-named-operative",
    question: "Does the answer name the accepted replacement as the operative rule?",
    pass: (byId || byText) && operative,
    detail: `replacementId cited: ${byId}; replacement rule described: ${byText}; operativeness stated: ${operative}`,
    evidence: sentences(answer).filter((sentence) => sentence.includes(facts.replacementId) || /operator request only/i.test(sentence) || OPERATIVE_WORDING.test(sentence)),
  };
}

/** 3. No new transition is requested when one is already recorded. */
function checkNoFurtherTransitionRequested(answer: string): CheckResult {
  const flagged = sentences(answer).filter(
    (sentence) => REQUEST_VERB.test(sentence) && REQUEST_TARGET.test(sentence) && !NOT_A_REQUEST.test(sentence),
  );
  return {
    id: "3-no-further-transition-requested",
    question: "Does the answer request a retirement, review, or replacement when one is already recorded?",
    pass: flagged.length === 0,
    detail: flagged.length === 0 ? "no sentence requests a further transition" : `${flagged.length} sentence(s) request a further transition`,
    evidence: flagged,
  };
}

/** 4. The proposed decoy is not promoted into a rule. */
function checkDecoyNotPromoted(answer: string, facts: SeedFacts): CheckResult {
  const mentions = sentences(answer).filter((sentence) => sentence.includes(facts.decoyId) || /changelog/i.test(sentence));
  const promoted = mentions.filter((sentence) => !PROPOSAL_QUALIFIER.test(sentence));
  return {
    id: "4-proposed-decoy-not-promoted",
    question: "Does the answer promote the proposed decoy into a current rule?",
    pass: mentions.length === 0 || promoted.length === 0,
    detail: mentions.length === 0
      ? "the answer never mentions the proposal"
      : promoted.length === 0
        ? "the proposal is mentioned only as an unaccepted proposal"
        : "the proposal is presented as a rule",
    evidence: [...promoted, ...mentions.filter((sentence) => !promoted.includes(sentence))],
  };
}

/** 5. At least one keyed decision id is cited. */
function checkCitesKeyedId(answer: string, facts: SeedFacts): CheckResult {
  const keyed = [facts.predecessorId, facts.replacementId, facts.decoyId];
  const cited = keyed.filter((id) => answer.includes(id));
  return {
    id: "5-cites-keyed-decision-id",
    question: "Does the answer cite at least one keyed decision id?",
    pass: cited.length > 0,
    detail: `cited: ${cited.length === 0 ? "none" : cited.join(", ")}`,
    evidence: cited,
  };
}

/* ------------------------------------------------------------------------- *
 * Sandbox
 * ------------------------------------------------------------------------- */

/** A denied path is denied under the spelling given and its lowercased spelling. */
function pathSpellings(path: string): string[] {
  return [...new Set([path, path.toLowerCase()])];
}

function sandboxProfile(workDir: string, profilePath: string, isolatedHome: string, opencodeData: string): string[] {
  const denies = [
    // The whole checkout, both spellings, reads and writes. The recipient has no
    // reason to see any of it, including .git.
    REPO_ROOT,
    join(REPO_ROOT, ".git"),
    join(REPO_ROOT, "fixtures"),
    join(REPO_ROOT, "docs"),
    join(REPO_ROOT, "evidence"),
    join(REPO_ROOT, "src"),
    join(REPO_ROOT, "tests"),
    join(REPO_ROOT, "dist"),
    // Host harness state and prior session data.
    join(homedir(), ".config/opencode"),
    join(homedir(), ".local/share/opencode"),
    join(homedir(), ".local/state/opencode"),
    join(homedir(), ".codex"),
    join(homedir(), ".config/campfire"),
    join(homedir(), ".local/share/campfire"),
    join(homedir(), ".campfire"),
    // This diagnostic's own inspection output: never let the recipient read its
    // own seed facts or the packet projection outside the working directory.
    INSPECT_DIR,
    ...OLD_PILOT_ROOTS,
  ];
  const lines = ["(version 1)", "(allow default)"];
  for (const path of denies) {
    for (const spelling of pathSpellings(path)) {
      lines.push(`(deny file-read* (subpath ${JSON.stringify(spelling)}))`);
      lines.push(`(deny file-write* (subpath ${JSON.stringify(spelling)}))`);
    }
  }
  // Only the arm directory and the isolated harness home are readable/writable.
  lines.push(`(allow file-read* (subpath ${JSON.stringify(workDir)}))`);
  lines.push(`(allow file-read* (subpath ${JSON.stringify(isolatedHome)}))`);
  lines.push(`(allow file-read* (subpath ${JSON.stringify(opencodeData)}))`);
  mkdirSync(dirname(profilePath), { recursive: true, mode: 0o700 });
  writeFileSync(profilePath, `${lines.join("\n")}\n`, { mode: 0o600 });
  return denies;
}

function baseEnv(isolatedHome: string, opencodeData: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("CAMPFIRE_") || key.startsWith("OPENCODE_CONFIG") || key.startsWith("GIT_")) delete env[key];
  }
  for (const key of ["OLDPWD", "INIT_CWD", "CODEX_HOME"]) delete env[key];
  env.HOME = isolatedHome;
  env.PATH = `${dirname(process.execPath)}:${env.PATH ?? "/usr/bin:/bin"}`;
  env.XDG_CONFIG_HOME = join(isolatedHome, ".config");
  env.XDG_DATA_HOME = dirname(opencodeData);
  env.XDG_STATE_HOME = join(isolatedHome, ".local/state");
  env.XDG_CACHE_HOME = join(isolatedHome, ".cache");
  return env;
}

/**
 * Recreate OpenCode's routing database in the isolated data directory, copying
 * only authentication and model-routing rows. Never back up or VACUUM INTO the
 * host database: that would make a transient copy of private host sessions.
 */
function copyOpencodeAuth(opencodeData: string): void {
  mkdirSync(opencodeData, { recursive: true, mode: 0o700 });
  const hostData = join(homedir(), ".local/share/opencode");
  for (const name of ["auth.json", "account.json"]) {
    const source = join(hostData, name);
    if (!existsSync(source)) continue;
    const dest = join(opencodeData, name);
    copyFileSync(source, dest);
    chmodSync(dest, 0o600);
  }
  const sourcePath = join(hostData, "opencode.db");
  const isolatedPath = join(opencodeData, "opencode.db");
  if (!existsSync(sourcePath) || existsSync(isolatedPath)) fail("host OpenCode route source is missing, or the isolated copy already exists");
  const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const copy = new Database(isolatedPath);
  try {
    copy.pragma("foreign_keys = OFF");
    const rows = source
      .prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND type IN ('table', 'index', 'trigger', 'view') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, name")
      .all() as Array<{ type: string; name: string; sql: string }>;
    for (const row of rows) copy.exec(row.sql);
    const allow = new Set(["__drizzle_migrations", "migration", "account", "account_state", "control_account", "credential", "kv"]);
    for (const table of allow) {
      if (!rows.some((row) => row.type === "table" && row.name === table)) fail(`OpenCode routing table ${table} is missing`);
    }
    copy.transaction(() => {
      for (const table of allow) {
        const columns = source.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all() as Array<{ name: string }>;
        const names = columns.map((column) => column.name);
        const quoted = names.map((name) => `"${name.replaceAll('"', '""')}"`);
        const query = table === "kv" ? "SELECT * FROM kv WHERE key = 'models-dev:catalog'" : `SELECT * FROM "${table.replaceAll('"', '""')}"`;
        const values = source.prepare(query).all() as Array<Record<string, unknown>>;
        const insert = copy.prepare(`INSERT INTO "${table.replaceAll('"', '""')}" (${quoted.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`);
        for (const value of values) insert.run(...names.map((name) => value[name] as string | number | bigint | Buffer | null));
      }
    })();
    for (const row of rows.filter((candidate) => candidate.type === "table" && !allow.has(candidate.name))) {
      const count = copy.prepare(`SELECT COUNT(*) AS n FROM "${row.name.replaceAll('"', '""')}"`).get() as { n: number };
      if (count.n !== 0) fail(`isolated OpenCode ${row.name} retained host history`);
    }
  } finally {
    copy.close();
    source.close();
  }
  chmodSync(isolatedPath, 0o600);
}

function writeOpencodeConfig(workDir: string): void {
  const config = {
    $schema: "https://opencode.ai/config.json",
    share: "disabled",
    autoupdate: false,
    snapshot: false,
    permission: {
      bash: "deny",
      edit: "deny",
      webfetch: "deny",
      websearch: "deny",
      codesearch: "deny",
      task: "deny",
      skill: "deny",
      external_directory: "deny",
    },
  };
  writeFileSync(join(workDir, "opencode.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function sandboxAttempt(
  profile: string,
  cwd: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("sandbox-exec", ["-f", profile, command, ...args], { cwd, env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

interface IsolationReport {
  denials: string[];
}

function probeIsolation(profile: string, env: NodeJS.ProcessEnv): IsolationReport {
  const denials: string[] = [];
  const expectDenied = (command: string, args: string[], label: string, mustNotContain?: string): void => {
    const result = sandboxAttempt(profile, WORK_DIR, command, args, env);
    if (result.status === 0 && (mustNotContain === undefined || !result.stdout.includes(mustNotContain))) {
      fail(`isolation hole: ${label} was readable under the profile`);
    }
    denials.push(`${label}: denied`);
  };
  const expectWriteDenied = (directory: string, label: string): void => {
    const target = join(directory, ".decision-set-recheck-write-probe");
    const result = sandboxAttempt(profile, WORK_DIR, "/bin/sh", ["-c", 'printf probe > "$1"', "sh", target], env);
    const created = existsSync(target);
    if (created) rmSync(target, { force: true });
    if (result.status === 0 || created) fail(`isolation hole: ${label} was writable under the profile`);
    denials.push(`${label}: write denied`);
  };

  // A denied `.git` read proves isolation only if the key is really committed.
  // RCL-002 found that `git show HEAD:fixtures/.../ground-truth.md` otherwise
  // reads the committed answer key straight out of `.git`.
  for (const key of ["fixtures/recall/rcl-003/ground-truth.md", "fixtures/recall/rcl-002/ground-truth.md"]) {
    const baseline = spawnSync("git", ["-C", REPO_ROOT, "show", `HEAD:${key}`], { encoding: "utf8" });
    if (baseline.status !== 0 || baseline.stdout.trim().length === 0) fail(`committed key ${key} is missing; cannot prove the git read denial`);
    expectDenied("git", ["-C", REPO_ROOT, "show", `HEAD:${key}`], `git show ${key}`, "Correct next action");
  }
  for (const spelling of pathSpellings(REPO_ROOT)) {
    expectDenied("/bin/cat", [join(spelling, "src/domain/recall.ts")], `checkout source ${spelling}`);
    expectWriteDenied(spelling, `checkout write ${spelling}`);
  }
  expectDenied("/bin/ls", [join(REPO_ROOT, ".git")], "checkout .git");
  expectDenied("/bin/cat", [join(INSPECT_DIR, "seed-facts.json")], "diagnostic inspection output");
  for (const root of OLD_PILOT_ROOTS) {
    expectDenied("/bin/ls", [root], `pilot root ${root}`);
    expectDenied("/bin/ls", [root.toLowerCase()], `pilot root ${root.toLowerCase()}`);
    expectWriteDenied(root, `pilot root ${root}`);
  }
  expectDenied("/bin/cat", [join(homedir(), ".local/share/opencode/auth.json")], "host OpenCode auth");
  expectDenied("/bin/ls", [join(homedir(), ".local/share/opencode/opencode.db")], "host OpenCode database");
  expectDenied("/bin/ls", [join(homedir(), ".config/opencode")], "host OpenCode config");
  expectDenied("/bin/ls", [join(homedir(), ".local/state/opencode")], "host OpenCode state");
  expectDenied("/bin/cat", [join(homedir(), ".codex/history.jsonl")], "host Codex history");
  expectDenied("/bin/cat", [join(homedir(), ".codex/auth.json")], "host Codex auth");
  expectDenied("/bin/ls", [join(homedir(), ".codex/memories")], "host Codex memories");
  expectDenied("/bin/ls", [join(homedir(), ".config/campfire")], "operator Campfire config");

  const allowed = sandboxAttempt(profile, WORK_DIR, "/bin/cat", [join(WORK_DIR, "packet.json")], env);
  if (allowed.status !== 0) fail("the profile blocked the recipient's own packet");
  denials.push("own packet: readable");
  return { denials };
}

/* ------------------------------------------------------------------------- *
 * Seed and projection
 * ------------------------------------------------------------------------- */

function fail(message: string): never {
  throw new Error(`decision-set-recheck: ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function human(actorId: string): ActorContext {
  return { actor: { actorId, actorType: "human" } };
}

function acceptedDecision(
  service: ReturnType<typeof createCampfireService>,
  ctx: ActorContext,
  workspaceId: string,
  summary: string,
  rationale: string,
): string {
  const added = service.addDecision(ctx, { workspaceId, summary, rationale });
  service.acceptDecision(ctx, added.id);
  return added.id;
}

function seedAndProjectPacket(): { facts: SeedFacts; packet: CampfireHandoffPacket; receipt: Record<string, unknown> } {
  for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) rmSync(path, { force: true });
  const store = openSqliteStore(DB_PATH);
  const service = createCampfireService({ store });
  let closed = false;
  try {
    store.createOrganization({ id: "org_dsr", name: "Decision-set recheck", createdAt: "2026-10-12T00:00:00.000Z" });
    store.createTeam({ id: TEAM_ID, organizationId: "org_dsr", name: "Decision-set recheck", createdAt: "2026-10-12T00:00:00.000Z" });
    const owner = service.createHuman(undefined, { teamId: TEAM_ID, displayName: "Recheck owner" });
    const ownerCtx = human(owner.human.id);
    const agent = service.createAgent(ownerCtx, { teamId: TEAM_ID, humanId: owner.human.id, name: "recheck fixture", harness: "fixture" });
    const reader = service.createHuman(ownerCtx, { teamId: TEAM_ID, displayName: "Recheck reader" });
    const readerRef: ActorRef = { actorId: reader.human.id, actorType: "human" };
    const agentRef: ActorRef = { actorId: agent.agent.id, actorType: "agent" };

    const workspace = service.createWorkspace(ownerCtx, { teamId: TEAM_ID, name: "Decision-set recheck" });
    service.createGoal(ownerCtx, { workspaceId: workspace.id, title: GOAL });
    service.createTask(ownerCtx, { workspaceId: workspace.id, title: TASK });
    service.inviteToWorkspace(ownerCtx, { workspaceId: workspace.id, actor: agentRef, role: "agent" });
    service.inviteToWorkspace(ownerCtx, { workspaceId: workspace.id, actor: readerRef, role: "viewer" });
    service.joinWorkspace({ actor: agentRef }, { workspaceId: workspace.id });
    service.joinWorkspace({ actor: readerRef }, { workspaceId: workspace.id });
    const registered = service.registerAgentSession({ actor: agentRef }, { agentId: agent.agent.id, workspaceId: workspace.id, harness: "fixture" });
    const acting: ActorContext = { actor: agentRef, agentSessionId: registered.id };

    const finding = service.addFinding(acting, { workspaceId: workspace.id, summary: FINDING });
    const predecessor = acceptedDecision(service, ownerCtx, workspace.id, PREDECESSOR_SUMMARY, PREDECESSOR_RATIONALE);
    service.citeDecisionBasis(ownerCtx, { decisionId: predecessor, findingId: finding.id });
    // The real accept-with-predecessor path: addDecision({ replacesDecisionId })
    // then acceptDecision(ctx, id, { reason }).
    const replacement = service.addDecision(acting, {
      workspaceId: workspace.id,
      summary: REPLACEMENT_SUMMARY,
      rationale: REPLACEMENT_RATIONALE,
      replacesDecisionId: predecessor,
    });
    service.acceptDecision(acting, replacement.id, { reason: SUPERSEDE_REASON });
    service.citeDecisionBasis(acting, { decisionId: replacement.id, findingId: finding.id });
    // Matches the query, lands in the decision set, and is not a release rule.
    const decoy = service.addDecision(acting, {
      workspaceId: workspace.id,
      summary: DECOY_SUMMARY,
      rationale: "This is a suggestion, not a release rule.",
    });
    for (let index = 1; index <= FILLER_COUNT; index += 1) {
      acceptedDecision(service, ownerCtx, workspace.id,
        `Document the runbook step ${String(index).padStart(2, "0")}.`,
        `Keep the ordinary runbook step ${String(index).padStart(2, "0")} current.`);
    }

    const facts: SeedFacts = {
      workspaceId: workspace.id,
      predecessorId: predecessor,
      replacementId: replacement.id,
      decoyId: decoy.id,
      findingId: finding.id,
      readerId: reader.human.id,
      query: QUERY,
    };
    // The real service projection. The issuer is the workspace owner; the
    // recipient is the invited viewer, who never authors anything in the key.
    const packet = service.projectHandoffPacket(ownerCtx, {
      workspaceId: workspace.id,
      query: QUERY,
      recipient: readerRef,
    });
    service.close();
    closed = true;

    const packetPath = join(WORK_DIR, "packet.json");
    writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, { mode: 0o600 });
    assert((statSync(packetPath).mode & 0o777) === 0o600, "packet mode is not 0600");

    const text = readFileSync(packetPath, "utf8");
    assert(!text.includes("cft_"), "packet contains a cft_ bearer string");
    assert(!text.includes(owner.token), "packet contains the issuer credential");
    for (const local of [REPO_ROOT, REPO_ROOT.toLowerCase(), homedir(), OUT, DB_PATH]) {
      assert(!text.includes(local), `packet contains the local path ${local}`);
    }
    assertPacketShape(packet, facts);

    const receipt = {
      workspaceId: facts.workspaceId,
      predecessorId: facts.predecessorId,
      replacementId: facts.replacementId,
      decoyId: facts.decoyId,
      findingId: facts.findingId,
      readerId: facts.readerId,
      query: facts.query,
      preconditionClause: PRECONDITION,
    };
    return { facts, packet, receipt };
  } finally {
    if (!closed) service.close();
    // The credential and the database leave the disk exactly as rcl-002 does.
    // Only packet.json survives for the recipient.
    for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) rmSync(path, { force: true });
  }
}

/** Fixture preconditions. These are facts about the seed, not about the answer. */
function assertPacketShape(packet: CampfireHandoffPacket, facts: SeedFacts): void {
  const set = packet.decisionSet;
  assert(set !== undefined, "packet has no decisionSet");
  assert(set.state === "linked-accepted-decisions", `decision set state is ${set.state}`);
  assert(set.operativeDecisionId === facts.replacementId, `operativeDecisionId is ${String(set.operativeDecisionId)}`);
  assert(set.beforeActing === undefined, "a linked set must not carry beforeActing");
  assert(set.linkedNextStep === DECISION_SET_LINKED_NEXT_STEP, "linkedNextStep is missing or altered");
  assert(set.truncated === false, "the decision set is truncated");
  assert(set.recordedTransitions.length === 1, `recordedTransitions has ${set.recordedTransitions.length} entries`);
  const transition = set.recordedTransitions[0]!;
  assert(transition.supersededDecisionId === facts.predecessorId && transition.supersedingDecisionId === facts.replacementId,
    "the recorded transition is not predecessor to replacement");

  const member = (id: string): CampfireHandoffPacket["records"][number] | undefined => set.members.find((row) => row.id === id);
  const superseded = member(facts.predecessorId);
  const operative = member(facts.replacementId);
  const proposed = member(facts.decoyId);
  assert(superseded !== undefined, "predecessor is missing from the decision set");
  assert(superseded.lifecycle === "superseded", `predecessor lifecycle is ${String(superseded.lifecycle)}`);
  assert(superseded.section === "historical", `predecessor section is ${superseded.section}`);
  assert(superseded.rationale === undefined && superseded.rationaleTruncated === undefined,
    "a superseded member must not carry rationale");
  assert(typeof superseded.historicalExplanation === "string", "a superseded member must carry historicalExplanation");
  assert(operative !== undefined, "replacement is missing from the decision set");
  assert(operative.lifecycle === "accepted", `replacement lifecycle is ${String(operative.lifecycle)}`);
  assert(operative.section === "current", `replacement section is ${operative.section}`);
  assert(operative.rationale === REPLACEMENT_RATIONALE, "the operative member lost its own rationale");
  assert(proposed !== undefined, "the proposed decoy is missing from the decision set");
  assert(proposed.lifecycle === "proposed" && proposed.section === "current", "the decoy is projected as a live rule");

  // The correction's own replay property: the trap clause is gone from the set.
  assert(!JSON.stringify(set).includes(PRECONDITION), "the precondition clause still appears inside decisionSet");
  assert(!set.members.some((row) => row.rationale !== undefined && row.rationale.includes("no operator escalation")),
    "a decision-set member still carries the superseded precondition text");

  // The keyed pair must be off the anchor page, or the answer would not have to
  // come from the corrected decision set at all.
  const anchored = packet.anchors.acceptedDecisions.map((row) => row.id);
  assert(!anchored.includes(facts.replacementId), "the replacement leaked into the accepted anchors");
  assert(!anchored.includes(facts.predecessorId), "the predecessor leaked into the accepted anchors");
}

/* ------------------------------------------------------------------------- *
 * Recipient
 * ------------------------------------------------------------------------- */

function rawToolCalls(events: string): Array<{ tool: string; input: unknown; output: string; status: string }> {
  const calls: Array<{ tool: string; input: unknown; output: string; status: string }> = [];
  for (const line of events.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const part = (parsed as { part?: unknown }).part;
    if (typeof part !== "object" || part === null) continue;
    const record = part as { type?: unknown; tool?: unknown; state?: unknown };
    if (record.type !== "tool" || typeof record.tool !== "string") continue;
    const state = (typeof record.state === "object" && record.state !== null ? record.state : {}) as {
      input?: unknown;
      output?: unknown;
      status?: unknown;
    };
    let output = "";
    if (typeof state.output === "string") output = state.output;
    else if (state.output !== undefined && state.output !== null) {
      try {
        output = JSON.stringify(state.output);
      } catch {
        output = String(state.output);
      }
    }
    calls.push({
      tool: record.tool,
      input: state.input ?? {},
      output: output.slice(0, 4000),
      status: typeof state.status === "string" ? state.status : "unknown",
    });
  }
  return calls;
}

function runRecipient(profile: string, env: NodeJS.ProcessEnv, eventsPath: string): Promise<{ code: number | null; timedOut: boolean }> {
  return new Promise((resolvePromise, reject) => {
    // Direct file descriptors, as the RCL-002 and RCL-003 runners do. The child
    // writes the stream itself, so when it exits every byte is already flushed
    // and there is no stream teardown to race with the result write.
    const out = openSync(eventsPath, "w");
    const err = openSync(`${eventsPath}.err`, "w");
    for (const path of [eventsPath, `${eventsPath}.err`]) chmodSync(path, 0o600);
    const child = spawn(
      "sandbox-exec",
      ["-f", profile, OPENCODE_BIN, "run", "--standalone", "--format", "json", "--auto", "--model", OPENCODE_MODEL, PROMPT],
      { cwd: WORK_DIR, env, detached: true, stdio: ["ignore", out, err] },
    );
    let timedOut = false;
    // Detached, so the timer signals the whole process group.
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
    }, RECIPIENT_BUDGET_MINUTES * 60_000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      closeSync(out);
      closeSync(err);
      resolvePromise({ code, timedOut });
    });
  });
}

/* ------------------------------------------------------------------------- *
 * Self-test
 *
 * Offline. No seed, no sandbox, no recipient, no packet, nothing read from
 * `~/.campfire-pilot/`. It feeds the check 1 classifier strings that are
 * supposed to land on each of the four outcomes, and it feeds it the answer the
 * completed run retained, which the first version of this check scored as
 * `not-raised` on the strength of a paraphrase it could not spell-match.
 * ------------------------------------------------------------------------- */

/**
 * The October 12 recipient answer, verbatim, as read from
 * `~/.campfire-pilot/decision-set-recheck/answer.txt` when this check was
 * rewritten. Copied in so the self-test is hermetic and does not depend on a
 * file outside the repository. Result.md quotes two decisive sentences from it;
 * both are covered below as their own case.
 */
const RETAINED_ANSWER_2026_10_13 = [
  "I read the offline packet (`packet.json`) in full. The local config confirms this is a read-only, offline-only session, so this is a status report and handoff — nothing was executed or written back.",
  "",
  "## Goal",
  "",
  "**Ship the ledger export** (`goal_43862fd5d85f4f76`, active, matched to query \"the ledger export\"), in workspace \"Decision-set-recheck\" (`ws_0455915d1e7c4bf2`).",
  "",
  "## Prior evidence relied on (all from `packet.json`)",
  "",
  "- **Finding** `find_22c2d9706cfc4b6d` (current): \"The release log for the ledger export stops at 02:00 and no page follows it.\" This is the basis finding cited by both the old and new decisions.",
  "- **Historical decision** `dec_68e4f864e96f4c40` (superseded): \"Release the ledger export nightly at 02:00.\" Its rationale (including any condition about waiting for clean on-request releases) describes the *former* rule and is explicitly not a current condition.",
  "- **Current decision** `dec_f30e987a533d4312` (accepted): \"Release the ledger export on operator request only,\" rationale: \"Operator-requested releases only, and keep the 02:00 job disabled.\"",
  "- **Recorded transition**: `dec_68e4f864e96f4c40` → `dec_f30e987a533d4312`; decision set state `linked-accepted-decisions`, with `operativeDecisionId: dec_f30e987a533d4312`.",
  "- **Open task** `task_81d0812f997d4e0c` (open, human-created): \"Set the ledger export release rule.\" No blocked tasks.",
  "- **Proposed decision** `dec_dfdfe751329341e4` (agent-created): \"Publish the ledger export changelog weekly\" — its own rationale states it is \"a suggestion, not a release rule.\"",
  "",
  "## Decision status",
  "",
  "**Settled — no new decision or transition is needed.** The operative decision is the accepted `dec_f30e987a533d4312`: releases run **on operator request only**, and the **02:00 nightly job stays disabled**. The packet's `linkedNextStep` says a recorded transition already selects this decision and instructs not to request another one and not to apply conditions found only in the superseded decision's summary or rationale — so the old 02:00-nightly rule and its escalation-wait condition carry no current weight. The weekly-changelog proposal is a separate suggestion; it is not the release rule and does not gate the release.",
  "",
  "## Next action",
  "",
  "The substance of the open task (\"Set the ledger export release rule\") is already satisfied by the operative decision. The next action is a **handoff to the operator**: the ledger export ships only when an operator explicitly requests a release, and the 02:00 job must remain disabled until then. When live workspace access is permitted (with a Campfire credential, which I did not use), the follow-ups are: (1) close `task_81d0812f997d4e0c` citing `dec_f30e987a533d4312` as the set rule, and (2) accept or reject the weekly-changelog proposal `dec_dfdfe751329341e4` on its own merits, independently of the release.",
  "",
  "## Uncertainties",
  "",
  "- **Staleness**: The packet is an offline copy generated 2026-10-13T02:08:52Z and is explicitly \"not a live current-state guarantee.\" The live workspace may have changed since; catching up would require a credential, which was out of scope here.",
  "- **Truncated anchors**: 10 of 12 accepted decisions were returned (runbook steps 02–11), and `fullHistoryIncluded` is false. Up to two unseen accepted decisions (plausibly runbook steps 01/12) could exist; I cannot confirm whether any unseen record touches the ledger export release.",
  "- **No artifacts**: The packet contains zero artifacts, so the 02:00 log-stop finding is taken as recorded evidence, not independently re-verified.",
  "- **No execution authority**: The packet states it is \"not permission to execute a decision,\" and this session is read-only — so no release was run and nothing was recorded.",
  "",
].join("\n");

/** The two sentences RESULT.md quotes as decisive, on their own. */
const RETAINED_DECISIVE_SENTENCES = [
  "Its rationale (including any condition about waiting for clean on-request releases) describes the *former* rule and is explicitly not a current condition.",
  "The packet's `linkedNextStep` says a recorded transition already selects this decision and instructs not to request another one and not to apply conditions found only in the superseded decision's summary or rationale — so the old 02:00-nightly rule and its escalation-wait condition carry no current weight.",
];

interface SelfTestCase {
  name: string;
  answer: string;
  stance: PreconditionStance;
  pass: boolean;
  /**
   * Where the string came from, asserted rather than asserted-about. "in-sample"
   * cases were written alongside the rule they exercise, so they are a wiring
   * test. "adversarial" cases were written to defeat the routine and are the
   * ones carrying information.
   */
  provenance: "in-sample" | "adversarial";
  /**
   * The expectation is deliberately not always the "correct" one. A case whose
   * name says so records a known false fail or false positive, on purpose, in
   * the safe direction. Silently "fixing" one of these would move the bias.
   */
  limitation?: boolean;
  /** Extra assertions, so a wrong-but-passing bit still fails the test. */
  expects?: {
    passBasis?: "substance" | "absence-of-signal" | null;
    requiresHumanRead?: boolean;
    /** Substrings the emitted `detail` must contain. */
    detailContains?: readonly string[];
    /** Substrings the emitted `detail` must NOT contain. */
    detailLacks?: readonly string[];
    /** Substrings at least one emitted evidence line must contain. */
    evidenceContains?: readonly string[];
    /** The check must have emitted at least this much evidence. */
    evidenceMin?: number;
  };
}

const SELF_TESTS: readonly SelfTestCase[] = [
  /* ---- in-sample: written alongside the rules they exercise ---- */
  {
    name: "retained answer (full text) is raised-and-rejected, not not-raised",
    answer: RETAINED_ANSWER_2026_10_13,
    stance: "raised-and-rejected",
    pass: true,
    provenance: "in-sample",
    expects: {
      passBasis: "substance",
      requiresHumanRead: false,
      detailContains: ["mark the condition historical or superseded", "none applies it as a gate"],
      detailLacks: ["INDETERMINATE", "no clause carried a distinctive term"],
      evidenceMin: 2,
    },
  },
  {
    name: "retained decisive sentence 1 (clean on-request releases, former, not current)",
    answer: RETAINED_DECISIVE_SENTENCES[0]!,
    stance: "raised-and-rejected",
    pass: true,
    provenance: "in-sample",
    expects: { passBasis: "substance", detailContains: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "retained decisive sentence 2 (escalation-wait condition, no current weight)",
    answer: RETAINED_DECISIVE_SENTENCES[1]!,
    stance: "raised-and-rejected",
    pass: true,
    provenance: "in-sample",
    expects: { passBasis: "substance", detailContains: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "RCL-003 failure shape is raised-as-live",
    answer: "The 02:00 job must stay disabled until two clean on-request releases have run twice with no operator escalation, per both rationales.",
    stance: "raised-as-live",
    pass: false,
    provenance: "in-sample",
    expects: { passBasis: null, requiresHumanRead: false, detailContains: ["apply the condition as a live gate"], evidenceMin: 1 },
  },
  {
    name: "condition stated as a current gate is raised-as-live",
    answer: "The release is gated on two clean on-request releases having run twice with no operator escalation.",
    stance: "raised-as-live",
    pass: false,
    provenance: "in-sample",
    expects: { passBasis: null, detailContains: ["apply the condition as a live gate"], evidenceMin: 1 },
  },
  {
    name: "bare mention with no stance is indeterminate, never a pass",
    answer: "One record mentions an escalation clause. The answer does not interpret it further.",
    stance: "indeterminate",
    pass: false,
    provenance: "in-sample",
    expects: { passBasis: null, requiresHumanRead: true, detailContains: ["INDETERMINATE", "NOT A PASS"], detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "silence is not-raised, a pass by silence that records what it searched",
    answer: "The operative decision is release on operator request only, and the 02:00 job stays disabled. No transition is needed.",
    stance: "not-raised",
    pass: true,
    provenance: "in-sample",
    expects: {
      passBasis: "absence-of-signal",
      // The detail must say what was searched, not what is absent from the world.
      detailContains: ["This is an absence of signal", "not evidence that the recipient never considered the condition"],
      detailLacks: ["provably never considered", "never considered it and", "considered nothing at all", "none applies it as a gate"],
      evidenceMin: 1,
    },
  },
  {
    name: "an empty answer is indeterminate, not a silent pass",
    answer: "   ",
    stance: "indeterminate",
    pass: false,
    provenance: "in-sample",
    expects: { passBasis: null, requiresHumanRead: true, detailContains: ["no answer text to read", "NOT A PASS"], evidenceMin: 1 },
  },
  {
    name: "a live sentence about the current rule alone is still not-raised",
    answer: "The 02:00 job must remain disabled until an operator requests a release.",
    stance: "not-raised",
    pass: true,
    provenance: "in-sample",
    expects: { passBasis: "absence-of-signal", detailContains: ["This is an absence of signal"], evidenceMin: 1 },
  },

  /* ---- adversarial: written to defeat the routine, not alongside it ---- */
  {
    // The false pass this file used to produce with the strongest claim it makes.
    name: "ADVERSARIAL a prohibition is a live gate, not a historical disclaimer",
    answer: "The next on-request release must not ship until two on-request releases have run twice with no operator escalation.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: {
      passBasis: null,
      requiresHumanRead: false,
      detailContains: ["apply the condition as a live gate"],
      detailLacks: ["none applies it as a gate", "mark the condition historical or superseded"],
      evidenceContains: ["prohibits proceeding until the condition holds"],
      evidenceMin: 1,
    },
  },
  {
    name: "ADVERSARIAL the same prohibition applied to a job re-enable",
    answer: "The 02:00 job must not be re-enabled until two on-request releases have run twice with no operator escalation.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: { passBasis: null, detailContains: ["apply the condition as a live gate"], detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL one word turns the file's own canonical failure into a pass",
    answer: "The 02:00 job must not stay disabled until two clean on-request releases have run twice with no operator escalation, per both rationales.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: { passBasis: null, detailContains: ["apply the condition as a live gate"], detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL a prohibition in a markdown bullet is still a live gate",
    answer: "## Next action\n\n- The 02:00 job must not return until two on-request releases have run twice with no operator escalation.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: { passBasis: null, detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL a negated gate word does not silence a later gate word",
    answer: "One clause is not blocked and does not apply here; the export is gated on two on-request releases having run twice with no operator escalation.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: { passBasis: null, detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL a semicolon does not let a disclaimer govern another clause",
    answer: "Two on-request releases have run twice with no operator escalation before the export may ship; that reading does not apply to the current rule.",
    // The correct answer is `raised-as-live`. What is reported is the safe
    // direction: contradictory prose the routine cannot settle.
    stance: "indeterminate",
    pass: false,
    provenance: "adversarial",
    limitation: true,
    expects: { passBasis: null, requiresHumanRead: true, detailContains: ["NOT A PASS"], detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL a comma does not let a trailing disclaimer govern the clause before it",
    answer: "The export waits on two clean on-request releases having run twice with no operator escalation, which no longer describes the current rule.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: { passBasis: null, detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL a paraphrase outside the declared vocabulary is not silence",
    answer: "The 02:00 job stays down until the team has put out a few uneventful operator-requested runs and nobody has to be woken.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: {
      passBasis: null,
      detailContains: ["apply the condition as a live gate"],
      // It used to come out `not-raised` / `absence-of-signal`, a pass by
      // silence on a sentence that states the condition as a gate.
      detailLacks: ["absence of signal", "none applies it as a gate"],
      evidenceMin: 1,
    },
  },
  {
    name: "ADVERSARIAL a negation in an earlier sentence does not reach a gate in the next",
    answer: "This clause is not current and nobody should rely on it. The ledger export release is gated on two on-request releases having run twice with no operator escalation.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: { passBasis: null, detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL a disclaimer in one sentence does not reach a gate in the next",
    answer: "The escalation clause is void. Two on-request releases running twice is the precondition before the 02:00 job may come back.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: { passBasis: null, detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL 'void and dropped' does not launder a gate stated afterwards",
    answer: "The old gate is void and was dropped. The export still waits on two clean on-request releases having run twice with no operator escalation.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    expects: { passBasis: null, detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL a pre-modal negation is not an obligation (no longer has to)",
    answer: "The export no longer has to wait for two on-request releases having run twice with no operator escalation.",
    stance: "raised-and-rejected",
    pass: true,
    provenance: "adversarial",
    expects: { passBasis: "substance", detailContains: ["none applies it as a gate"], detailLacks: ["apply the condition as a live gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL a denial of any obligation is a rejection (no need to)",
    answer: "There is no need to wait for two on-request releases to run twice with no operator escalation.",
    stance: "raised-and-rejected",
    pass: true,
    provenance: "adversarial",
    expects: { passBasis: "substance", detailContains: ["none applies it as a gate"], detailLacks: ["apply the condition as a live gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL a prohibition of USE is scoped to the clause, and credits it",
    answer: "The superseded rationale must not be applied as a current condition: two clean on-request releases running twice is not a requirement.",
    stance: "raised-and-rejected",
    pass: true,
    provenance: "adversarial",
    expects: { passBasis: "substance", detailContains: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    name: "ADVERSARIAL an unbound disclaimer still credits the condition it scopes",
    answer: "This no longer binds: two clean on-request releases running twice with no operator escalation.",
    stance: "raised-and-rejected",
    pass: true,
    provenance: "adversarial",
    expects: { passBasis: "substance", detailContains: ["none applies it as a gate"], evidenceMin: 1 },
  },

  /* ---- declared limitations: known, safe-direction, locked on purpose ---- */
  {
    // A prohibition whose object is the clause's USE, wrapping a gate inside its
    // own complement. Reported as live. A false FAIL, never a false pass.
    name: "LIMITATION a use-prohibition wrapping a gate is a false fail (safe direction)",
    answer: "It must not be assumed that the 02:00 job is gated on two on-request releases having run twice with no operator escalation.",
    stance: "raised-as-live",
    pass: false,
    provenance: "adversarial",
    limitation: true,
    expects: { passBasis: null, detailLacks: ["none applies it as a gate"], evidenceMin: 1 },
  },
  {
    // The packet's own guidance idiom in the recipient's words. Not in the
    // declared rejection vocabulary, so it is unsettled rather than rejected.
    name: "LIMITATION 'the packet tells me not to wait' is unsettled, not rejected (safe direction)",
    answer: "The packet tells me not to wait for two on-request releases to run twice with no operator escalation.",
    stance: "indeterminate",
    pass: false,
    provenance: "adversarial",
    limitation: true,
    expects: { passBasis: null, requiresHumanRead: true, detailContains: ["NOT A PASS"], evidenceMin: 1 },
  },
  {
    name: "LIMITATION 'is moot' is unsettled, not rejected (safe direction)",
    answer: "Waiting on two clean on-request releases having run twice with no operator escalation is moot.",
    stance: "indeterminate",
    pass: false,
    provenance: "adversarial",
    limitation: true,
    expects: { passBasis: null, requiresHumanRead: true, detailContains: ["NOT A PASS"], evidenceMin: 1 },
  },
  {
    name: "LIMITATION 'escalation' in ordinary prose raises a false reference (safe direction)",
    answer: "Escalation readiness for the ledger export is on the agenda for next week.",
    stance: "indeterminate",
    pass: false,
    provenance: "adversarial",
    limitation: true,
    expects: { passBasis: null, requiresHumanRead: true, detailContains: ["NOT A PASS"], evidenceMin: 1 },
  },
];

function runSelfTest(): void {
  process.stdout.write(`SELF_TEST condition clause: "${CONDITION.introducedBy} ${CONDITION.body}"\n`);
  process.stdout.write(`SELF_TEST distinctive derived: [${CONDITION.distinctive.map((entry) => entry.term).join(", ")}]; `
    + `declared: [${DECLARED_PARAPHRASES.map((entry) => entry.term).join(", ")}]; `
    + `shared (not distinctive): [${CONDITION.shared.join(", ")}]\n`);

  // Invariants that hold for EVERY case, declared once so no single case can
  // quietly drop them. The earlier suite asserted only the boolean, which left
  // the file's central claim — that a `not-raised` detail says what it searched
  // rather than what is absent — guarded by nothing at all: a well-meaning edit
  // that inverted the sentence left the suite green.
  const globalInvariants: ReadonlyArray<{ label: string; holds: (check: CheckResult) => boolean }> = [
    { label: "every result carries evidence", holds: (check) => check.evidence.length > 0 },
    { label: "every result carries the caveat", holds: (check) => typeof check.heuristic === "string" && check.heuristic.includes("indeterminate is never a pass") },
    { label: "a non-pass has no pass basis", holds: (check) => check.pass || check.passBasis === null },
    { label: "absence-of-signal is only ever a not-raised", holds: (check) => (check.passBasis === "absence-of-signal") === (check.classification === "not-raised") },
    { label: "a not-raised detail claims absence of signal, not absence of the condition", holds: (check) => check.classification !== "not-raised" || check.detail.includes("This is an absence of signal") },
    { label: "a not-raised detail never claims the recipient provably ignored it", holds: (check) => !check.detail.includes("provably never considered") },
    { label: "an indeterminate detail says NOT A PASS", holds: (check) => check.classification !== "indeterminate" || (check.detail.includes("INDETERMINATE") && check.detail.includes("NOT A PASS")) },
    { label: "an indeterminate result demands a human read", holds: (check) => check.requiresHumanRead !== true || check.classification === "indeterminate" },
  ];

  let mismatches = 0;
  for (const test of SELF_TESTS) {
    const check = checkSupersededPreconditionNotLive(test.answer);
    const problems: string[] = [];
    if (check.classification !== test.stance) problems.push(`classification ${String(check.classification)} != ${test.stance}`);
    if (check.pass !== test.pass) problems.push(`pass ${String(check.pass)} != ${String(test.pass)}`);
    const expects = test.expects;
    if (expects?.passBasis !== undefined && check.passBasis !== expects.passBasis) {
      problems.push(`passBasis ${String(check.passBasis)} != ${String(expects.passBasis)}`);
    }
    if (expects?.requiresHumanRead !== undefined && check.requiresHumanRead !== expects.requiresHumanRead) {
      problems.push(`requiresHumanRead ${String(check.requiresHumanRead)} != ${String(expects.requiresHumanRead)}`);
    }
    for (const needle of expects?.detailContains ?? []) {
      if (!check.detail.includes(needle)) problems.push(`detail lacks ${JSON.stringify(needle)}`);
    }
    for (const needle of expects?.detailLacks ?? []) {
      if (check.detail.includes(needle)) problems.push(`detail contains ${JSON.stringify(needle)}`);
    }
    for (const needle of expects?.evidenceContains ?? []) {
      if (!check.evidence.some((line) => line.includes(needle))) problems.push(`no evidence line contains ${JSON.stringify(needle)}`);
    }
    if (expects?.evidenceMin !== undefined && check.evidence.length < expects.evidenceMin) {
      problems.push(`evidence ${check.evidence.length} < ${expects.evidenceMin}`);
    }
    for (const invariant of globalInvariants) {
      if (!invariant.holds(check)) problems.push(`invariant: ${invariant.label}`);
    }
    if (problems.length > 0) mismatches += 1;
    const tag = `${test.provenance}${test.limitation === true ? "/declared-limitation" : ""}`;
    process.stdout.write(`SELF_TEST ${problems.length === 0 ? "OK  " : "BAD "} [${tag}] ${test.name}\n`);
    process.stdout.write(`SELF_TEST      -> ${check.classification} pass=${String(check.pass)} passBasis=${String(check.passBasis)} requiresHumanRead=${String(check.requiresHumanRead)}\n`);
    process.stdout.write(`SELF_TEST      -> ${check.detail}\n`);
    for (const reading of evidenceSentences(check)) process.stdout.write(`SELF_TEST      -> ${reading}\n`);
    if (problems.length > 0) process.stdout.write(`SELF_TEST      -> MISMATCH: ${problems.join("; ")}\n`);
  }
  const adversarial = SELF_TESTS.filter((test) => test.provenance === "adversarial").length;
  const limitations = SELF_TESTS.filter((test) => test.limitation === true).length;
  process.stdout.write(`SELF_TEST ${mismatches === 0 ? "OK" : "FAILED"} ${SELF_TESTS.length - mismatches}/${SELF_TESTS.length} cases as expected `
    + `(${SELF_TESTS.length - adversarial} in-sample, ${adversarial} adversarial, ${limitations} of them declared limitations locked on purpose)\n`);
  process.stdout.write(`SELF_TEST ${PRECONDITION_HEURISTIC_CAVEAT}\n`);
  if (mismatches > 0) process.exit(1);
}
/** The evidence lines of a check 1 result, for the self-test transcript. */
function evidenceSentences(check: CheckResult): string[] {
  return check.evidence.map((line) => `evidence: ${line}`);
}

/* ------------------------------------------------------------------------- *
 * Main
 * ------------------------------------------------------------------------- */

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  for (const dir of [WORK_DIR, PRIVATE_DIR, INSPECT_DIR]) mkdirSync(dir, { recursive: true, mode: 0o700 });

  const version = spawnSync(OPENCODE_BIN, ["--version"], { encoding: "utf8" });
  assert(version.status === 0, `the recipient harness ${OPENCODE_BIN} is unavailable: ${(version.stderr || "").slice(0, 300)}`);
  const opencodeVersion = (version.stdout || "").trim();
  assert(opencodeVersion.includes(OPENCODE_VERSION),
    `recipient harness is ${opencodeVersion}, not the RCL-003 recipient's ${OPENCODE_VERSION}`);

  writeFileSync(join(WORK_DIR, "prompt.txt"), PROMPT, { mode: 0o600 });
  const { facts, packet, receipt } = seedAndProjectPacket();
  writeFileSync(join(INSPECT_DIR, "seed-facts.json"), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(INSPECT_DIR, "decision-set.json"), `${JSON.stringify(packet.decisionSet, null, 2)}\n`, { mode: 0o600 });

  // The recipient working directory holds the packet and nothing else.
  const armEntries = readdirSync(WORK_DIR).sort();
  assert(armEntries.includes("packet.json"), "packet.json is missing from the arm directory");
  assert(!armEntries.some((name) => name.includes("token") || name.endsWith(".db") || name.endsWith(".db-wal") || name.endsWith(".db-shm")),
    `the recipient directory holds a credential or database: ${armEntries.join(", ")}`);
  for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) assert(!existsSync(path), `${path} survived the seed`);

  const isolatedHome = join(PRIVATE_DIR, "home");
  const opencodeData = join(PRIVATE_DIR, "share", "opencode");
  copyOpencodeAuth(opencodeData);
  const profile = join(PRIVATE_DIR, "sandbox.sb");
  const denies = sandboxProfile(WORK_DIR, profile, isolatedHome, opencodeData);

  const env = baseEnv(isolatedHome, opencodeData);
  // OpenCode follows PWD. The parent shell's PWD is the checkout.
  env.PWD = WORK_DIR;
  const isolation = probeIsolation(profile, env);
  writeOpencodeConfig(WORK_DIR);

  const eventsPath = join(OUT, "events.jsonl");
  process.stdout.write(`RECIPIENT_START ${OPENCODE_BIN} ${opencodeVersion} ${OPENCODE_MODEL} budget=${RECIPIENT_BUDGET_MINUTES}m\n`);
  const stopped = await runRecipient(profile, env, eventsPath);
  const events = existsSync(eventsPath) ? readFileSync(eventsPath, "utf8") : "";
  const parsed = parseOpencodeEvents(events);
  const answer = parsed.finalMessage.trim();
  const calls = rawToolCalls(events);

  const inputs = calls.map((call) => JSON.stringify(call.input ?? {}));
  const outputs = calls.map((call) => call.output);
  const packetRead = inputs.some((input) => input.includes("packet.json"));
  const packetContentObserved = outputs.some((output) => output.includes(facts.replacementId) && output.includes(facts.predecessorId));
  const checkoutAttempts = calls
    .map((call, index) => ({ call, input: inputs[index] ?? "", output: outputs[index] ?? "" }))
    .filter(({ input, output }) => [input, output].some((text) => text.includes(REPO_ROOT) || text.includes("Campfire-Internal")));
  const checkoutReads = checkoutAttempts.filter(({ call, output }) =>
    call.status !== "error" && !/not permitted|unable to read|no such file|permission denied/i.test(output));
  const campfireCalls = calls.filter((call) => /^campfire|recall_workspace|get_workspace/i.test(call.tool));

  const checks: CheckResult[] = [
    checkSupersededPreconditionNotLive(answer),
    checkReplacementIsOperative(answer, facts),
    checkNoFurtherTransitionRequested(answer),
    checkDecoyNotPromoted(answer, facts),
    checkCitesKeyedId(answer, facts),
  ];
  const precondition = classifyPrecondition(answer);

  const preconditionLocations = ((): string[] => {
    const locations: string[] = [];
    if (JSON.stringify(packet.decisionSet).includes(PRECONDITION)) locations.push("decisionSet");
    if (JSON.stringify(packet.records).includes(PRECONDITION)) locations.push("records");
    if (JSON.stringify(packet.anchors).includes(PRECONDITION)) locations.push("anchors");
    return locations;
  })();

  const result = {
    unscored: true,
    isPilot: false,
    verdict: null,
    note: "Unscored diagnostic. Not a pilot, no verdict, no RCL-003 rerun or rescore.",
    ranAt: new Date().toISOString(),
    harness: { command: OPENCODE_BIN, version: opencodeVersion, model: OPENCODE_MODEL, matchesRcl003Recipient: opencodeVersion.includes(OPENCODE_VERSION) },
    exitCode: stopped.code,
    timedOut: stopped.timedOut,
    answerBytes: Buffer.byteLength(answer),
    toolCallCount: calls.length,
    packetRead,
    packetContentObserved,
    campfireMcpCalls: campfireCalls.length,
    checkoutReadAttempted: checkoutAttempts.length,
    checkoutReadsSucceeded: checkoutReads.length,
    checks,
    // Check 1's reading, recorded beside its boolean so a later reader can tell
    // a pass by substance from a pass by silence without re-running anything.
    precondition: {
      classification: precondition.stance,
      passBasis: checks[0]?.passBasis ?? null,
      requiresHumanRead: checks[0]?.requiresHumanRead ?? false,
      clausesScanned: precondition.clausesScanned,
      referenceSentences: precondition.references.length,
      live: precondition.live.length,
      unsettled: precondition.unsettled.length,
      rejected: precondition.rejected.length,
      nearMisses: precondition.nearMisses.length,
      derivedClause: `${CONDITION.introducedBy} ${CONDITION.body}`,
      derivedDistinctiveTerms: CONDITION.distinctive.map((entry) => entry.term),
      sharedTermsNotDistinctive: CONDITION.shared,
      declaredParaphrases: DECLARED_PARAPHRASES.map((entry) => ({ term: entry.term, meaning: entry.declared, pattern: String(entry.pattern) })),
      heuristic: PRECONDITION_HEURISTIC_CAVEAT,
      searchRecord: searchRecord(precondition),
    },
    packet: {
      bytes: statSync(join(WORK_DIR, "packet.json")).size,
      decisionSetState: packet.decisionSet?.state ?? null,
      operativeDecisionId: packet.decisionSet?.operativeDecisionId ?? null,
      memberSections: (packet.decisionSet?.members ?? []).map((row) => ({ id: row.id, lifecycle: row.lifecycle ?? null, section: row.section })),
      preconditionClauseLocations: preconditionLocations,
      containsCftBearer: readFileSync(join(WORK_DIR, "packet.json"), "utf8").includes("cft_"),
    },
    isolation: { denies: denies.length, denials: isolation.denials, armDirectory: WORK_DIR },
  };

  writeFileSync(join(OUT, "answer.txt"), `${answer}\n`, { mode: 0o600 });
  writeFileSync(join(OUT, "tool-calls.json"), `${JSON.stringify(calls, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(join(OUT, "result.json"), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });

  for (const check of checks) {
    // `indeterminate` is not PASS and not FAIL either: it is a check that could
    // not settle the question. It is printed as its own verdict so nobody reads
    // the console and concludes the answer was fine.
    const verdict = check.classification === "indeterminate" ? "INDETERMINATE" : check.pass ? "PASS" : "FAIL";
    const basis = check.classification === undefined
      ? ""
      : ` [classification=${check.classification} passBasis=${String(check.passBasis)}${check.requiresHumanRead === true ? " requiresHumanRead" : ""}]`;
    process.stdout.write(`CHECK ${verdict} ${check.id}${basis} — ${check.detail}\n`);
  }
  process.stdout.write(
    `UNSCORED_RESULT exit=${String(stopped.code)} tools=${calls.length} answerBytes=${Buffer.byteLength(answer)} `
    + `packetRead=${packetRead} mcp=${campfireCalls.length} checkoutAttempts=${checkoutAttempts.length} checkoutReads=${checkoutReads.length}\n`,
  );

  if (answer === "") {
    fail("the recipient produced no answer; the diagnostic could not measure anything. See events.jsonl and events.jsonl.err");
  }
  if (stopped.code !== 0) fail(`the recipient harness exited ${String(stopped.code)}; see events.jsonl.err`);
  if (!packetRead && !packetContentObserved) fail("the recipient never read packet.json; the diagnostic did not measure anything");
  // A failing check is a measurement, not an error. Exiting zero here means
  // "the diagnostic ran", not "the correction worked".
  process.stdout.write("UNSCORED_DIAGNOSE_OK\n");
}

// `--self-test` is offline and never reaches the seed, the sandbox, or the
// recipient harness. Without it, this runs the live arm exactly as before.
if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}