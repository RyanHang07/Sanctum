import type { AppState } from "../state/appState";

/** Home headline per state (SPEC 4.0): bold statement + serif payoff. */
export function homeHeadline(state: AppState, event?: { title: string; until: string }): [string, string] {
  switch (state) {
    case "sealed":
      return ["You’re sealed in.", "Finish what you started."];
    case "event":
      return [`${event?.title ?? "Event"} until ${event?.until ?? "it ends"}.`, "Be all the way there."];
    default:
      return ["Keep your promises.", "Or stay mid."];
  }
}
