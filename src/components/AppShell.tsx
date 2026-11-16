import { useEffect, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { Toast } from "./Toast";
import { UpdateNotice } from "./UpdateNotice";
import { RecapNotice } from "./RecapNotice";
import { useRecap } from "../state/recap";
import { useUpdate } from "../state/update";
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
import { JournalPage } from "../pages/journal/JournalPage";
import { useNotes } from "../state/notes";
import { CheckinDialog } from "./CheckinDialog";
import { BootSplash } from "./BootSplash";
import { QuietPauseDialog } from "./QuietPauseDialog";
import { CommandBar } from "./CommandBar";
import { useTrackers } from "../state/trackers";
import { Setup } from "../pages/Setup";
import { StatsPage } from "../pages/stats/StatsPage";
import { WeekPage } from "../pages/week/WeekPage";
import { TABS, type TabId } from "../state/appState";
import { gsap, RISE_FROM, RISE_TO, useGSAP } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";
import { useStore } from "../state/store";
import { native } from "../lib/native";
import { clock, countdown } from "../lib/time";
import { connectNativeEvents } from "../state/events";
import { SAMPLE_EVENT } from "../pages/placeholders";
import { meetingLabels } from "../lib/calendar";
import { useNow } from "../lib/useNow";
import { seedDevPlanner, seedDevProfiles, seedDevStats, seedDevTrackers } from "../lib/devSeed";
import { usePlanner } from "../state/planner";

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
    case "journal":
      return <JournalPage />;
    case "setup":
      return <Setup />;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type?.toLowerCase();
    return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file"].includes(type ?? "");
  }
  return Boolean(el.closest('[contenteditable="true"], [contenteditable="plaintext-only"], .ProseMirror, .note-doc'));
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
        if (isEditableTarget(e.target)) return;
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

/**
 * Moving between screens (restored 2026-11-16): the new screen rises in, a short fade up from
 * 6px (RISE_FROM / RISE_TO), the same motion Pending's rows cascade with. A state change (open,
 * sealed, event) does not touch the page.
 * Under reduced motion the swap is instant (useMotion jumps the timeline to its end).
 */
function usePageSwap(tab: TabId) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const { run } = useMotion(ref);
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (!ref.current) return;
      run(() => gsap.timeline({ id: "page-swap" }).fromTo(ref.current, RISE_FROM, RISE_TO));
    },
    { scope: ref, dependencies: [tab] },
  );
  return ref;
}

function useNativeEvents() {
  useEffect(() => {
    const disconnect = connectNativeEvents();
    // An update downloaded in the background, one click away (v0.3).
    const stopUpdates = useUpdate.getState().start();
    void useStore.getState().loadSettings();
    // Quiet hours follow the clock; Rust pushes changes, and this catches the rest.
    void useStore.getState().loadQuiet();
    void useStore.getState().loadBreak();
    const quietTimer = setInterval(() => void useStore.getState().loadQuiet(), 30_000);
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
      .then(() => useNotes.getState().load())
      // Last week in short, once a week (v0.3); after setup, so a new install isn't greeted with it.
      .then(() => (useStore.getState().onboarding ? undefined : useRecap.getState().check()));
    // Keep the Rust side (tray menu, close handling) in sync with the store on startup.
    void native.setAppState(useStore.getState().appState);
    return () => {
      clearInterval(quietTimer);
      disconnect();
      stopUpdates();
    };
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
  const quiet = useStore((s) => s.quiet);
  const now = useNow(15_000);
  const contentRef = usePageSwap(activeTab);
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
        : quiet?.on && quiet.endsAt
          ? `Quiet to ${clock(quiet.endsAt)}`
          : undefined;

  return (
    // Every animation follows Windows' "reduce motion" setting (v0.2; GSAP moments through useMotion).
    <div data-state={appState} className="relative box-border flex h-full w-full overflow-hidden bg-app">
      <Sidebar pillMeta={pillMeta} />
      <main className="relative min-w-0 grow">
        <div ref={contentRef} data-page={activeTab} className="relative h-full">
          <div key={activeTab} className="h-full">
            <Page tab={activeTab} />
          </div>
        </div>
        <Toast />
        {/* Notices that wait for you, bottom right, one above the other. */}
        <div className="pointer-events-none absolute bottom-7 right-7 z-20 flex flex-col items-end gap-3 [&>*]:pointer-events-auto">
          <RecapNotice />
          <UpdateNotice />
        </div>
        <BlockPrompt />
      </main>
      <CloseDialog />
      <BreakSealDialog />
      <CheckinDialog />
      <QuietPauseDialog />
      <CommandBar />
      {import.meta.env.DEV ? <DevStateToggle /> : null}
      <BootSplash />
    </div>
  );
}
