import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Toast } from "./Toast";
import { UpdateNotice } from "./UpdateNotice";
import { RecapNotice } from "./RecapNotice";
import { useRecap } from "../state/recap";
import { useUpdate } from "../state/update";
import { CloseDialog } from "./CloseDialog";
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
import { DUR, EASE, gsap, RISE_FROM, RISE_TO, useGSAP } from "../lib/gsap";
import { Arches } from "./Arches";
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
import { ErrorBoundary } from "./ErrorBoundary";

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
      // F11 fills the screen and gives it back, as in any Windows app (2026-11-24).
      if (e.key === "F11" && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        void native.toggleFullscreen();
        return;
      }
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

/** The old screen's fade out, and the beat after it where only the arches show (seconds). */
const SWAP_OUT = DUR.ui;
const SWAP_BEAT = DUR.ui;
/** On the content area while a swap runs (see usePageSwap). */
const SWAPPING = "data-swapping";

/**
 * Moving between screens (2026-11-16, with the arches): the old screen fades out quickly
 * (SWAP_OUT), a short beat passes with only the still arches showing (SWAP_BEAT), then the new
 * screen rises in, a short fade up from 6px (RISE_FROM / RISE_TO), the same motion Pending's rows
 * cascade with. 120 + 120 + 240 = 480ms. The arches never move; only the content does.
 *
 * The old screen stays mounted through its fade: `shown` lags `tab` and catches up in the beat.
 * Switching again mid-swap kills the running swap (so its catch-up never lands) and fades out
 * whatever is showing from its current opacity. A state change (open, sealed, event) does not
 * touch the page. The first screen just appears. Under reduced motion or a hidden window the
 * swap is instant (useMotion jumps the timeline to its end, catch-up included).
 *
 * No scrollbars while it runs: the content area is marked `data-swapping` for the swap's length,
 * which clips the moving layer and hides the scrollbar of every scroller inside it (a page's own
 * list or panel, nudged by the rise or by its own entrance, would otherwise flash one). Hiding is
 * paint only (transparent thumb and track), so nothing reflows when the mark comes off; a page
 * that really scrolls shows its scrollbar again as soon as the swap completes, is interrupted, or
 * (under reduced motion) jumps to its end.
 */
function usePageSwap(tab: TabId) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const swap = useRef<gsap.core.Timeline | null>(null);
  const swaps = useRef(0);
  const [shown, setShown] = useState(tab);
  const { run } = useMotion(ref);
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      const el = ref.current;
      // No content area (the held page or setup is up): nothing to animate, just catch up.
      if (!el) {
        setShown(tab);
        return;
      }
      // Killing a running swap fires its onInterrupt, which lets go of the scrollbars; this swap takes them again.
      swap.current?.kill();
      const from = Number(gsap.getProperty(el, "opacity"));
      // Only the latest swap lets go: a superseded one finishing late must not unhide the new one's.
      const own = ++swaps.current;
      el.setAttribute(SWAPPING, "");
      const settle = () => {
        if (swaps.current === own) el.removeAttribute(SWAPPING);
      };
      swap.current = run(() =>
        gsap
          .timeline({ id: "page-swap", onComplete: settle, onInterrupt: settle })
          .to(el, { opacity: 0, duration: SWAP_OUT * from, ease: EASE.exit })
          .call(() => setShown(tab))
          .fromTo(el, RISE_FROM, { ...RISE_TO, immediateRender: false }, `+=${SWAP_BEAT}`),
      );
    },
    { dependencies: [tab] },
  );
  return { ref, shown };
}

/** One startup step: a failure is logged and the next step still runs. */
async function step(name: string, fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.error(`startup: ${name}`, e);
  }
}

/** Startup loads, in order. Each step stands alone, so one rejection doesn't skip the rest. */
async function startup(): Promise<void> {
  await step("seedDevProfiles", seedDevProfiles);
  await step("loadProfiles", () => useStore.getState().loadProfiles());
  await step("checkOnboarding", () => useStore.getState().checkOnboarding());
  await step("loadDistractions", () => useStore.getState().loadDistractions());
  await step("seedDevPlanner", seedDevPlanner);
  await step("planner", () => usePlanner.getState().reload());
  await step("seedDevTrackers", seedDevTrackers);
  await step("trackers", () => useTrackers.getState().load());
  // A check-in missed before startup, when "Check in on startup" is on.
  await step("checkPending", () => useTrackers.getState().checkPending());
  await step("notes", () => useNotes.getState().load());
  // Last week in short, once a week (v0.3); after setup, so a new install isn't greeted with it.
  await step("recap", () => (useStore.getState().onboarding ? undefined : useRecap.getState().check()));
}

function useNativeEvents() {
  useEffect(() => {
    const disconnect = connectNativeEvents();
    // An update downloaded in the background, one click away (v0.3).
    const stopUpdates = useUpdate.getState().start();
    void useStore.getState().loadSettings().catch((e: unknown) => console.error("loadSettings", e));
    // Quiet hours follow the clock; Rust pushes changes, and this catches the rest.
    void useStore.getState().loadQuiet();
    void useStore.getState().loadBreak();
    const quietTimer = setInterval(() => void useStore.getState().loadQuiet(), 30_000);
    try {
      seedDevStats();
    } catch (e) {
      console.error("seedDevStats", e);
    }
    // A session may have resumed after a restart; Rust decides.
    void useStore.getState().loadSession();
    void startup();
    // Keep the Rust side (tray menu, close handling) in sync with the store on startup.
    void native.setAppState(useStore.getState().appState).catch((e: unknown) => console.error("setAppState", e));
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
  const { ref: contentRef, shown } = usePageSwap(activeTab);
  useShortcuts();
  useNativeEvents();
  useScheduleFocus();

  // The close dialog shows over every branch: the close button asks it (setting "ask").
  if (held)
    return (
      <>
        <HeldPage held={held} />
        <CloseDialog />
      </>
    );
  if (onboarding)
    return (
      <>
        <Onboarding />
        <CloseDialog />
      </>
    );

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
        {/* The constant the screens move over: never animated, behind everything in main. */}
        <Arches />
        <div
          ref={contentRef}
          data-page={shown}
          className="relative h-full data-swapping:overflow-hidden data-swapping:[&_*]:[scrollbar-color:transparent_transparent]"
        >
          <div key={shown} className="h-full">
            {/* One page failing keeps the sidebar, the seal's timer and End early; a new tab starts clean. */}
            <ErrorBoundary kind="page">
              <Page tab={shown} />
            </ErrorBoundary>
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
      <BootSplash />
    </div>
  );
}
