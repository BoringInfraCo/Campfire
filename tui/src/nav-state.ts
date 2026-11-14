/**
 * Sidebar navigation for the OpenTUI slice.
 * No renderer imports: this module is only state transitions.
 */

export const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "attention", label: "Needs you" },
  { id: "work", label: "Work" },
  { id: "decisions", label: "Decisions" },
  { id: "references", label: "Sources" },
  { id: "people", label: "People & agents" },
  { id: "changes", label: "Activity" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

export type NavFocus = "sidebar" | "content";

export interface NavState {
  index: number;
  focus: NavFocus;
  /** Shown while content is focused and the user tries to move through a list. */
  status: string;
}

export const CONTENT_LIST_STATUS = "Section lists are not in this slice.";

export const SIDEBAR_HINT = "j/k section  enter open  q quit";
export const CONTENT_HINT = "h back  q quit";

export type NavAction = "up" | "down" | "tab" | "open" | "back" | "nudge";

export function initialNav(): NavState {
  return { index: 0, focus: "sidebar", status: "" };
}

export function sectionAt(index: number): (typeof SECTIONS)[number] {
  const section = SECTIONS[index];
  if (section === undefined) return SECTIONS[0];
  return section;
}

/** One key meaning. Unknown actions leave the state unchanged. Does not wrap j/k. */
export function reduceNav(state: NavState, action: NavAction): NavState {
  const last = SECTIONS.length - 1;
  if (state.focus === "sidebar") {
    if (action === "down") {
      return { ...state, index: Math.min(last, state.index + 1), status: "" };
    }
    if (action === "up") {
      return { ...state, index: Math.max(0, state.index - 1), status: "" };
    }
    if (action === "tab") {
      return { ...state, index: state.index >= last ? 0 : state.index + 1, status: "" };
    }
    if (action === "open") {
      return { ...state, focus: "content" };
    }
    return state;
  }
  if (action === "back") {
    return { ...state, focus: "sidebar", status: "" };
  }
  if (action === "up" || action === "down" || action === "nudge") {
    return { ...state, status: CONTENT_LIST_STATUS };
  }
  return state;
}
