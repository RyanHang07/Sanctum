import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AppShell } from "./components/AppShell";
import { DevStateToggle } from "./components/DevStateToggle";
import { TrayPanel } from "./windows/TrayPanel";
import { CompactTimer } from "./windows/CompactTimer";
import { InterceptWindow } from "./windows/Intercept";
import { NoteWindow } from "./windows/NoteWindow";
import { noteIdFromView } from "./lib/noteWindows";
import { startTheme } from "./state/theme";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Every color is a theme variable (src/theme/palette.ts): the chosen theme is set before the
// first paint, in every window, and follows Windows and other windows from then on.
startTheme();

// One bundle serves every window; the Tauri window config picks the view by hash. A note in its
// own window (2026-11-20) is #/note/<id>.
const view = window.location.hash.replace(/^#\/?/, "");
const noteId = noteIdFromView(view);

// Every window's root sits in a boundary: a render error shows a way to reload, never a blank window.
function Root() {
  if (view === "tray")
    return (
      <ErrorBoundary kind="window">
        <TrayPanel />
      </ErrorBoundary>
    );
  if (view === "compact")
    return (
      <ErrorBoundary kind="compact">
        <CompactTimer />
      </ErrorBoundary>
    );
  if (view === "intercept")
    return (
      <ErrorBoundary kind="window">
        <InterceptWindow />
      </ErrorBoundary>
    );
  if (noteId)
    return (
      <ErrorBoundary kind="window">
        <NoteWindow id={noteId} />
      </ErrorBoundary>
    );
  // The dev tools sit beside the app, not in it, so they stay mounted (and the mini timer keeps
  // listening) while the held page or onboarding takes over the shell.
  return (
    <>
      <ErrorBoundary kind="window" main>
        <AppShell />
      </ErrorBoundary>
      {import.meta.env.DEV ? (
        <ErrorBoundary kind="silent">
          <DevStateToggle />
        </ErrorBoundary>
      ) : null}
    </>
  );
}

// Stub windows are transparent so their rounded corners show.
if (view === "tray" || view === "compact" || view === "intercept") document.body.style.background = "transparent";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
