import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Toast } from "./Toast";
import { CloseDialog } from "./CloseDialog";
import { DevStateToggle } from "./DevStateToggle";
import { BreakSealDialog } from "./BreakSealDialog";
import { BlockPrompt } from "./BlockPrompt";
import { useScheduleFocus } from "../state/schedule";
import { Home, enterFocus } from "../pages/Home";
import { HeldPage } from "../pages/HeldPage";
import { Onboarding } from "../pages/onboarding/Onboarding";
import { TrackersPage } from "../pages/trackers/TrackersPage";
import { NotesPage } from "../pages/notes/NotesPage";
import { useNotes } from "../state/notes";
import { CheckinDialog } from "./CheckinDialog";
import { BootSplash } from "./BootSplash";
import { CommandBar } from "./CommandBar";
import { useTrackers } from "../state/trackers";
import { Setup } from "../pages/Setup";
import { StatsPage } from "../pages/stats/StatsPage";
import { WeekPage } from "../pages/week/WeekPage";
import { TABS, type AppState, type TabId } from "../state/appState";
import { useStore } from "../state/store";
import { native } from "../lib/native";
import { countdown } from "../lib/time";
import { connectNativeEvents } from "../state/events";
import { SAMPLE_EVENT } from "../pages/placeholders";
import { meetingLabels } from "../lib/calendar";
import { useNow } from "../lib/useNow";
import { seedDevPlanner, seedDevProfiles, seedDevStats, seedDevTrackers } from "../lib/devSeed";
import { usePlanner } from "../state/planner";

const TOP_RULE: Record<AppState, string> = {
  open: "border-t-transparent",
  sealed: "border-t-sealed",
  event: "border-t-event",
};

function Page({ tab }: { tab: TabId }) {
  switch (tab) {
    case "today":
      return <Home />;
    case "week":
      return <WeekPage />;
    case "stats":
      return <StatsPage />;
    case "trackers":
      return <TrackersPage />;
    case "notes":
      return <NotesPage />;
    case "setup":
      return <Setup />;
  }
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const s = useStore.getState();
      if (s.closeDialogOpen || s.held || document.querySelector("[role=dialog]")) return;
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.openCommand();
        return;
      }
      const tab = TABS.find((t) => t.hotkey === e.key);
      if (tab) {
        e.preventDefault();
        s.navigate(tab.id);
      } else if (e.key === "Enter" && s.appState === "open") {
        e.preventDefault();
        void enterFocus();
      } else if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        s.toggleSidebar();
      } else if (e.key.toLowerCase() === "m" && s.appState === "sealed") {
        e.preventDefault();
        void native.showCompact();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function useNativeEvents() {
  useEffect(() => {
    const disconnect = connectNativeEvents();
    void useStore.getState().loadSettings();
    seedDevStats();
    // A session may have resumed after a restart; Rust decides.
    void useStore.getState().loadSession();
    void seedDevProfiles()
      .finally(() => useStore.getState().loadProfiles())
      .then(() => useStore.getState().checkOnboarding())
      .then(() => useStore.getState().loadDistractions())
      .then(() => seedDevPlanner())
      .finally(() => usePlanner.getState().reload())
      // A check-in missed before startup, when "Check in on startup" is on.
      .then(() => seedDevTrackers())
      .then(() => useTrackers.getState().load())
      .then(() => useTrackers.getState().checkPending())
      .then(() => useNotes.getState().load());
    // Keep the Rust side (tray menu, close handling) in sync with the store on startup.
    void native.setAppState(useStore.getState().appState);
    return disconnect;
  }, []);
}

export function AppShell() {
  const appState = useStore((s) => s.appState);
  const activeTab = useStore((s) => s.activeTab);
  const durationMin = useStore((s) => s.durationMin);
  const session = useStore((s) => s.session);
  const held = useStore((s) => s.held);
  const onboarding = useStore((s) => s.onboarding);
  const meeting = useStore((s) => s.meeting);
  const now = useNow(15_000);
  useShortcuts();
  useNativeEvents();
  useScheduleFocus();

  if (held) return <HeldPage held={held} />;
  if (onboarding) return <Onboarding />;

  const pillMeta =
    appState === "sealed"
      ? countdown(session?.remainingMs ?? durationMin * 60_000)
      : appState === "event"
        ? (meeting ? meetingLabels(meeting, now) : SAMPLE_EVENT).left
        : undefined;

  return (
    <div data-state={appState} className={`relative box-border flex h-full w-full overflow-hidden border-t-2 bg-app ${TOP_RULE[appState]}`}>
      <Sidebar pillMeta={pillMeta} />
      <main className="relative min-w-0 grow">
        <div key={activeTab} className="page-in h-full">
          <Page tab={activeTab} />
        </div>
        <Toast />
        <BlockPrompt />
      </main>
      <CloseDialog />
      <BreakSealDialog />
      <CheckinDialog />
      <CommandBar />
      {import.meta.env.DEV ? <DevStateToggle /> : null}
      <BootSplash />
    </div>
  );
}
