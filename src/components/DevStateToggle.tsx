import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { APP_STATES } from "../state/appState";
import { useUpdate } from "../state/update";
import { useJournal } from "../state/journal";
import { TrayPanel } from "../windows/TrayPanel";
import { PauseCard, ParkCard, QuietCard, SealedAppCard, TitleNudge, WelcomeCard } from "../windows/Intercept";
import { ErrorBoundary, type BoundaryKind } from "./ErrorBoundary";
import { useStore } from "../state/store";
import { useRecap } from "../state/recap";
import { useTrackers } from "../state/trackers";
import { useTheme } from "../state/theme";
import { inTauri, native } from "../lib/native";
import { mockControls } from "../lib/mockBackend";
import { CompactTimer } from "../windows/CompactTimer";
import { HIT } from "./controls";
import { useDayTab } from "../pages/Tomorrow";
import { usePlanner } from "../state/planner";
import { addDays, todayKey } from "../lib/planner";
import type { HeldStats, Intercept } from "../lib/types";
import { ThemeCreator, closeThemeCreator } from "./ThemeCreator";

// Dev builds only. The state toggle, plus a panel that plays the moments and shows the small
// surfaces that are hard to reach by hand (2026-11-16): the seal going on, held, broken, the mini
// timer, onboarding, the extension pages, a check-in and the weekly recap.
// 2026-11-20: the tray panel, the notices (toasts, the update, a block starting, the journal's
// lock), the error fallbacks (each in its own boundary, so the app stays up) and the intercept cards.

const SAMPLE: HeldStats = {
  sessionId: 0,
  profileId: null,
  profileName: "Deep Work",
  plannedMinutes: 60,
  focusMinutes: 60,
  attempts: 3,
  broken: false,
  task: null,
  goal: null,
  broke: null,
};

const EXT = "http://localhost:5175";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="label">{title}</span>
      <div className="flex flex-wrap gap-[6px]">{children}</div>
    </div>
  );
}

function Act({ children, onClick, on = false, title }: { children: ReactNode; onClick: () => void; on?: boolean; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on || undefined}
      title={title}
      onClick={onClick}
      className={`h-control-sm rounded-control border px-[10px] text-meta transition-colors duration-ui ease-ui ${
        on ? "border-check-line bg-raised text-text" : "border-line-input text-text-2 hover:border-check-line hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

/** A render error, on purpose: what the error boundaries catch. */
function Throw(): never {
  throw new Error("Dev tools: a sample render error");
}

/** The error fallbacks, each in its own boundary around a child that throws: the app stays up. */
const ERRORS: { id: Surface; kind: BoundaryKind; label: string; w: number; h: number }[] = [
  { id: "err-window", kind: "window", label: "Window error", w: 520, h: 360 },
  { id: "err-page", kind: "page", label: "Page error", w: 560, h: 360 },
  { id: "err-compact", kind: "compact", label: "Mini timer error", w: 300, h: 58 },
];

type IcKind = "app" | "title" | "welcome" | "quiet" | "pause" | "park";
/** The intercept window's size per kind (engine.rs, intercept_size), with a plan where it has one. */
const INTERCEPTS: { id: IcKind; label: string; w: number; h: number }[] = [
  { id: "app", label: "Sealed app", w: 520, h: 360 },
  { id: "quiet", label: "Quiet hours", w: 520, h: 330 },
  { id: "pause", label: "Pause mode", w: 520, h: 330 },
  { id: "title", label: "Title nudge", w: 380, h: 108 },
  { id: "welcome", label: "Welcome back", w: 400, h: 118 },
  { id: "park", label: "Park a thought", w: 400, h: 132 },
];

/** A realistic intercept payload, timed from when it was opened. */
function samplePayload(kind: IcKind, at: number): Intercept {
  const base: Intercept = {
    kind,
    label: "Discord",
    attempts: 2,
    profileName: "Deep Work",
    elapsedMs: 22 * 60_000,
    remainingMs: 38 * 60_000,
    backTo: "Visual Studio Code",
    keyword: null,
    plan: null,
  };
  switch (kind) {
    case "app":
      return { ...base, plan: "I'll write the thought down and keep going." };
    case "quiet":
      return { ...base, label: "Steam", profileName: "Quiet hours", remainingMs: 9 * 3_600_000, endsAt: at + 9 * 3_600_000 };
    case "pause":
      return { ...base, label: "YouTube", endsAt: at + 5_000 };
    case "title":
      return { ...base, label: "Firefox", keyword: "reddit", plan: "I'll write the thought down and keep going." };
    case "welcome":
      return { ...base, label: "Visual Studio Code", title: "SPEC.md - Sanctum", idleMs: 12 * 60_000, endsAt: at + 50 * 60_000 };
    case "park":
      return base;
  }
}

const LONG_ERROR =
  "Couldn't write C:\\Users\\you\\AppData\\Roaming\\com.sanctum.app\\sanctum.db: the database file is locked by another process (os error 33). Close other copies of Sanctum and try again.";

/** A small surface shown at its real size (or a scaled-down tab, `size` saying so), floating over the app. */
function Float({ label, w, h, size, onClose, children }: { label: string; w: number; h: number; size?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between font-mono text-micro text-muted">
        <span>
          {label} · {size ?? `${w}×${h}`}
        </span>
        <button type="button" aria-label={`Close ${label}`} onClick={onClose} className={`${HIT} px-1 hover:text-text`}>
          ×
        </button>
      </div>
      <div className="relative overflow-hidden rounded-[10px] border border-line-input bg-app" style={{ width: w, height: h }}>
        {children}
      </div>
    </div>
  );
}

type Surface = "mini" | "popup" | "blocked" | "tray" | "err-window" | "err-page" | "err-compact" | `ic-${IcKind}`;
type ExtState = "sealed" | "open" | "offline" | "pause";
const EXT_STATES: { id: ExtState; label: string; title: string }[] = [
  { id: "sealed", label: "Sealed", title: "A session is on and Sanctum is connected" },
  { id: "open", label: "Open", title: "Nothing is sealed" },
  { id: "offline", label: "Offline", title: "Sealed, but Sanctum isn't answering" },
  { id: "pause", label: "Pause", title: "Pause mode on the blocked page; the popup shows open" },
];

/** Chrome sizes the popup to its content; popup.css fixes the width. */
const POPUP_W = 300;
/** The blocked page is a whole tab, shown scaled down. */
const TAB = { w: 1280, h: 800, scale: 0.45 };

/** Whether the extension preview server answers. Checked when a page is shown, and on Retry. */
function useExtServer(): { status: "checking" | "up" | "down"; retry: () => void } {
  const [status, setStatus] = useState<"checking" | "up" | "down">("checking");
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setStatus("checking");
    // no-cors: any answer at all means the server is up.
    fetch(`${EXT}/popup.html`, { mode: "no-cors", cache: "no-store" }).then(
      () => live && setStatus("up"),
      () => live && setStatus("down"),
    );
    return () => {
      live = false;
    };
  }, [tries]);
  return { status, retry: () => setTries((n) => n + 1) };
}

/** An extension page from the preview server, painted in the app's theme, or why it can't show. */
function ExtFrame({ title, src, w, h, onHeight }: { title: string; src: string; w: number; h: number; onHeight?: (h: number) => void }) {
  const { status, retry } = useExtServer();
  const frame = useRef<HTMLIFrameElement>(null);
  const theme = useTheme((s) => s.theme);
  // The app sends its theme to the real extension over native messaging; here it goes by postMessage.
  const post = () => frame.current?.contentWindow?.postMessage({ sanctumTheme: { scheme: theme.scheme, palette: theme.palette } }, EXT);
  useEffect(post, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!onHeight) return;
    const heard = (e: MessageEvent) => {
      if (e.origin === EXT && e.source === frame.current?.contentWindow && typeof e.data?.sanctumPreviewHeight === "number") onHeight(e.data.sanctumPreviewHeight);
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [onHeight]);

  if (status !== "up") {
    return (
      <div role="status" className="flex h-full min-h-[160px] flex-col items-center justify-center gap-2 p-4 text-center text-meta text-text-2">
        {status === "checking" ? (
          <span>Looking for the preview server…</span>
        ) : (
          <>
            <span>The extension preview server isn't running.</span>
            <span className="font-mono text-micro text-muted">npm run ext:preview</span>
            <Act onClick={retry}>Retry</Act>
          </>
        )}
      </div>
    );
  }
  // Keyed on the URL: a new state is a fresh page, as the extension would open it.
  return <iframe ref={frame} key={src} title={title} src={src} onLoad={post} className="block border-0" style={{ width: w, height: h }} />;
}

/** Kept outside the component: the panel remounts as the held page or onboarding takes over. */
const useDev = create<{ open: boolean; shown: Surface[]; extState: ExtState; popupH: number; creator: boolean; icAt: number }>()(() => ({
  open: false,
  shown: [],
  extState: "sealed",
  popupH: 230,
  creator: false,
  icAt: 0,
}));
const closeCreator = () => {
  closeThemeCreator();
  useDev.setState({ creator: false });
};
const setPopupH = (popupH: number) => useDev.setState({ popupH });

export function DevStateToggle() {
  const appState = useStore((s) => s.appState);
  const setAppState = useStore((s) => s.setAppState);
  // A real session owns the seal; the toggle only fakes states when none is running.
  const live = useStore((s) => s.session !== null);
  const { open, shown, extState, popupH, creator, icAt } = useDev();
  // Built once per opening, so the cards' countdowns don't restart as the app re-renders.
  const payloads = useMemo(() => Object.fromEntries(INTERCEPTS.map((k) => [k.id, samplePayload(k.id, icAt || Date.now())])) as Record<IcKind, Intercept>, [icAt]);
  const hide = (s: Surface) => useDev.setState((d) => ({ shown: d.shown.filter((x) => x !== s) }));
  const showIntercept = (k: IcKind) => {
    const id = `ic-${k}` as const;
    if (shown.includes(id)) return hide(id);
    // One intercept at a time, as the real window shows them.
    useDev.setState((d) => ({ icAt: Date.now(), shown: [...d.shown.filter((x) => !x.startsWith("ic-")), id] }));
  };
  const notice = useStore((s) => s.notice);
  const lockedTab = useStore((s) => s.lockedToast);
  const blockPrompt = useStore((s) => s.blockPrompt);
  const update = useUpdate((s) => (s.ready && s.later !== s.ready.version ? s.ready : null));
  const setOpen = (open: boolean) => useDev.setState({ open });
  const setExtState = (extState: ExtState) => useDev.setState({ extState });
  // The popup has no Pause mode of its own: during one, nothing is sealed.
  const popupState = extState === "pause" ? "open" : extState;
  const blockedQuery = extState === "pause" ? "pause=1&state=open" : `state=${extState}`;
  // In the browser the mock backend runs everything; inside Tauri only the store-side moments work.
  const mock = !inTauri();
  const toggle = (s: Surface) => useDev.setState((d) => ({ shown: d.shown.includes(s) ? d.shown.filter((x) => x !== s) : [...d.shown, s] }));

  const enterFocus = () => void useStore.getState().enterFocus();
  const tomorrowOn = useStore((s) => s.settings.tomorrowTab);
  const held = (broken: boolean) => {
    // A real mock session finishes for real (the held event, the mini timer, the streak); otherwise a sample.
    if (mock && useStore.getState().session) {
      // Broken: the clock is turned back mid-seal, as the real guard would catch it.
      if (broken) mockControls.tamper("clock", "The clock changed");
      return mockControls.fastForward(24 * 60 * 60_000);
    }
    useStore.getState().showHeld(broken ? { ...SAMPLE, broken: true, focusMinutes: 23, broke: { kind: "killed", afterMin: 23 } } : SAMPLE);
  };

  return (
    <>
      {shown.length ? (
        <div data-dev-surfaces className="fixed bottom-24 right-4 z-50 flex max-h-[calc(100vh-120px)] flex-col items-end gap-3 overflow-y-auto">
          {shown.includes("tray") ? (
            <Float label="Tray panel" w={340} h={440} onClose={() => hide("tray")}>
              <TrayPanel />
            </Float>
          ) : null}
          {ERRORS.filter((e) => shown.includes(e.id)).map((e) => (
            <Float key={e.id} label={e.label} w={e.w} h={e.h} onClose={() => hide(e.id)}>
              <ErrorBoundary kind={e.kind}>
                <Throw />
              </ErrorBoundary>
            </Float>
          ))}
          {INTERCEPTS.filter((k) => shown.includes(`ic-${k.id}`)).map((k) => {
            const p = payloads[k.id];
            const close = () => hide(`ic-${k.id}`);
            return (
              <Float key={k.id} label={k.label} w={k.w} h={k.h} onClose={close}>
                <div className="flex h-full w-full items-center justify-center">
                  {k.id === "app" ? (
                    <SealedAppCard p={p} onBack={close} onBreak={close} />
                  ) : k.id === "quiet" ? (
                    <QuietCard p={p} onBack={close} onPause={close} />
                  ) : k.id === "pause" ? (
                    <PauseCard p={p} onAnswer={close} />
                  ) : k.id === "title" ? (
                    <TitleNudge p={p} />
                  ) : k.id === "welcome" ? (
                    <WelcomeCard p={p} />
                  ) : (
                    <ParkCard onDone={close} />
                  )}
                </div>
              </Float>
            );
          })}
          {shown.includes("mini") ? (
            <Float label="Mini timer" w={300} h={58} onClose={() => toggle("mini")}>
              <CompactTimer />
            </Float>
          ) : null}
          {shown.includes("popup") ? (
            <Float label="Extension popup" w={POPUP_W} h={popupH} onClose={() => toggle("popup")}>
              <ExtFrame title="Extension popup" src={`${EXT}/popup.html?state=${popupState}`} w={POPUP_W} h={popupH} onHeight={setPopupH} />
            </Float>
          ) : null}
          {shown.includes("blocked") ? (
            <Float
              label="Blocked page"
              w={TAB.w * TAB.scale}
              h={TAB.h * TAB.scale}
              size={`${TAB.w}×${TAB.h} tab at ${TAB.scale * 100}%`}
              onClose={() => toggle("blocked")}
            >
              <div className="origin-top-left" style={{ width: TAB.w, height: TAB.h, transform: `scale(${TAB.scale})` }}>
                <ExtFrame title="Blocked page" src={`${EXT}/blocked.html?site=youtube.com&${blockedQuery}`} w={TAB.w} h={TAB.h} />
              </div>
            </Float>
          ) : null}
        </div>
      ) : null}

      {creator ? <ThemeCreator onClose={closeCreator} /> : null}

      {open ? (
        <div
          aria-label="Dev tools"
          data-dev-tools
          className="fixed bottom-[88px] left-3 z-50 flex max-h-[calc(100vh-100px)] w-[300px] flex-col gap-3 overflow-y-auto rounded-panel border border-line-input bg-panel p-3 text-meta shadow-toast"
        >
          <Group title="Moments">
            <Act onClick={enterFocus} title={live ? "A session is already running" : "Starts a real session: the seal line, the sealed card"}>
              Enter focus
            </Act>
            <Act onClick={() => held(false)} title={live && mock ? "Finishes the running session" : "Shows the held page with sample numbers"}>
              Held
            </Act>
            <Act onClick={() => held(true)}>Seal broken</Act>
            {mock ? <Act onClick={() => mockControls.meetingNow(30)}>Event now</Act> : null}
          </Group>
          <Group title="Screens">
            <Act onClick={() => useStore.getState().openOnboarding()}>Onboarding</Act>
            <Act onClick={() => useTrackers.getState().openLog()}>Check-in</Act>
            <Act
              onClick={() =>
                useRecap.setState({
                  recap: { week: "2026-11-09", focusMin: 1140, previousFocusMin: 960, kept: 5, broken: 1, days: 6, bestDay: "2026-11-10", bestDayMin: 240, mostTempting: "discord.exe", sessions: 16,
                    daily: [
                      { date: "2026-11-09", status: "kept", focusMin: 170 },
                      { date: "2026-11-10", status: "kept", focusMin: 240 },
                      { date: "2026-11-11", status: "kept", focusMin: 200 },
                      { date: "2026-11-12", status: "broken", focusMin: 60 },
                      { date: "2026-11-13", status: "kept", focusMin: 230 },
                      { date: "2026-11-14", status: "kept", focusMin: 240 },
                      { date: "2026-11-15", status: "rest", focusMin: 0 },
                    ],
                  },
                })
              }
            >
              Weekly recap
            </Act>
          </Group>
          <Group title="Tomorrow">
            <Act on={tomorrowOn} onClick={() => useStore.getState().setTomorrowTab(!tomorrowOn)} title="Setup › Behavior › Tomorrow on Today">
              Tomorrow {tomorrowOn ? "on" : "off"}
            </Act>
            {mock ? (
              <Act onClick={() => void sampleTomorrow()} title="A 9:00a, a 3:00p and an untimed item tomorrow">
                Sample tomorrow
              </Act>
            ) : null}
            <Act
              onClick={() => {
                if (!tomorrowOn) useStore.getState().setTomorrowTab(true);
                useDayTab.setState((d) => ({ tab: d.tab === "today" ? "tomorrow" : "today" }));
              }}
            >
              Switch tab
            </Act>
            <Act onClick={() => useDayTab.setState((d) => ({ resets: d.resets + 1 }))} title="Plays the refresh the lists get at the reset time">
              Day reset
            </Act>
            {mock ? (
              <Act onClick={() => void resetIntoTomorrow()} title="Clears tomorrow, then after a beat plays the reset and gives tomorrow items: the dot bumps in">
                Reset into tomorrow
              </Act>
            ) : null}
          </Group>
          <Group title="Theme">
            <Act on={creator} onClick={() => (creator ? closeCreator() : useDev.setState({ creator: true }))} title="Edit colors live and copy them out as JSON">
              Theme creator
            </Act>
          </Group>
          <Group title="Small surfaces">
            <Act on={shown.includes("mini")} onClick={() => toggle("mini")}>
              Mini timer
            </Act>
            <Act on={shown.includes("popup")} onClick={() => toggle("popup")}>
              Ext popup
            </Act>
            <Act on={shown.includes("blocked")} onClick={() => toggle("blocked")}>
              Ext blocked
            </Act>
            <Act on={shown.includes("tray")} onClick={() => toggle("tray")} title="The tray icon's popout, 340×440">
              Tray panel
            </Act>
          </Group>
          <Group title="Notices">
            <Act on={notice?.lead === "Saved."} onClick={() => useStore.getState().showNotice({ lead: "Saved.", rest: "Deep Work now blocks 14 sites." })}>
              Notice
            </Act>
            <Act
              on={!!notice?.action}
              onClick={() =>
                useStore.getState().showNotice({ lead: "Task deleted.", rest: "Call the bank", action: { label: "Undo", run: () => useStore.getState().showNotice({ lead: "Restored." }) } })
              }
            >
              Notice with action
            </Act>
            <Act
              on={!!lockedTab}
              onClick={() => useStore.setState({ lockedToast: "week", notice: null })}
              title="The toast a locked tab shows while sealed; click it to dismiss"
            >
              Locked tab
            </Act>
            <Act on={!!notice && notice.rest === LONG_ERROR} onClick={() => useStore.getState().showNotice({ lead: "Not saved.", rest: LONG_ERROR, ms: 10_000 })} title="Checks the truncation">
              Long error
            </Act>
            <Act
              on={!!update}
              onClick={() => (update ? useUpdate.getState().dismiss() : useUpdate.setState({ ready: { version: "0.4.1", notes: null }, later: null, applying: false }))}
            >
              Update ready
            </Act>
            <Act
              on={!!blockPrompt}
              onClick={() => {
                if (blockPrompt) return useStore.getState().showBlockPrompt(null);
                const profile = useStore.getState().profiles[0];
                if (!profile) return useStore.getState().showNotice({ lead: "No profiles yet.", rest: "Add one in Setup to see the block prompt." });
                const now = Date.now();
                useStore.getState().showBlockPrompt({
                  item: {
                    key: "todo:dev",
                    kind: "todo",
                    id: 0,
                    title: "Interview prep",
                    date: todayKey(new Date(), useStore.getState().settings.dailyResetTime),
                    time: null,
                    durationMin: 50,
                    profileId: profile.id,
                    done: false,
                    order: 0,
                  },
                  state: "now",
                  startsAt: now,
                  endsAt: now + 50 * 60_000,
                  profileId: profile.id,
                  minutes: 50,
                });
              }}
              title="A profile-linked block starts now"
            >
              Block starts
            </Act>
            {mock ? (
              <Act onClick={() => void journalLocked()} title="Locks the journal with the PIN 1234 and opens it">
                Journal locked
              </Act>
            ) : null}
          </Group>
          <Group title="Errors">
            {ERRORS.map((e) => (
              <Act key={e.id} on={shown.includes(e.id)} onClick={() => toggle(e.id)}>
                {e.label}
              </Act>
            ))}
          </Group>
          <Group title="Intercepts">
            {INTERCEPTS.map((k) => (
              <Act key={k.id} on={shown.includes(`ic-${k.id}`)} onClick={() => showIntercept(k.id)}>
                {k.label}
              </Act>
            ))}
          </Group>
          <div className="flex flex-col gap-[6px]">
            <span className="label" id="ext-state-label">
              Extension state
            </span>
            <div role="radiogroup" aria-labelledby="ext-state-label" className="flex w-fit rounded-control border border-line-input p-[2px]">
              {EXT_STATES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === extState}
                  title={s.title}
                  onClick={() => setExtState(s.id)}
                  className={`h-[22px] rounded-control px-[10px] text-meta transition-colors duration-ui ease-ui ${
                    s.id === extState ? "bg-raised text-text" : "text-muted hover:text-text-2"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <p className="m-0 text-micro text-muted">The extension pages need their preview server: npm run ext:preview.</p>
        </div>
      ) : null}

      <div
        aria-label="Dev state toggle"
        data-dev-toggle
        className="fixed bottom-11 left-3 z-50 flex items-center gap-1 rounded-panel border border-line-input bg-panel p-1 text-meta shadow-toast"
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Hide dev tools" : "Show dev tools"}
          onClick={() => setOpen(!open)}
          className={`h-6 rounded-control px-2 font-mono text-micro transition-colors duration-ui ease-ui ${open ? "bg-raised text-text" : "text-muted hover:text-text-2"}`}
        >
          DEV
        </button>
        {APP_STATES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === appState}
            disabled={live}
            title={live ? "A session is running" : undefined}
            onClick={() => setAppState(s)}
            className={`h-6 rounded-control px-2 capitalize transition-colors duration-ui ease-ui disabled:cursor-not-allowed disabled:opacity-50 ${s === appState ? "bg-raised text-text" : "text-muted hover:text-text-2"}`}
          >
            {s}
          </button>
        ))}
      </div>
    </>
  );
}

/** Tests reset the panel between cases. */
export const resetDevTools = () => useDev.setState({ open: false, shown: [], extState: "sealed", popupH: 230, creator: false, icAt: 0 });

/** Preview only: the journal's lock screen. Sets the journal up and locks it with the PIN 1234
 *  (unless it already has a lock), then opens the Journal. */
async function journalLocked() {
  const j = useJournal.getState();
  await j.load();
  const { setup, lock } = useJournal.getState();
  if (!setup.done) await j.saveSetup({ ...setup, done: true });
  if (!lock || lock.lock === "none") {
    if (!(await j.setLock("pin", "1234"))) return;
  }
  useJournal.getState().relock();
  useStore.getState().navigate("journal");
}

/** Preview only: three items tomorrow (one before noon, one after, one untimed), then the list
 *  reloads and the Tomorrow tab opens on them. */
/** Preview only: tomorrow shows empty (no dot, routines hidden too) on the Today tab; 2.5 s later
 *  the day resets and tomorrow has the sample items, so the reset plays and the dot bumps in. */
async function resetIntoTomorrow() {
  const tomorrow = addDays(todayKey(new Date(), useStore.getState().settings.dailyResetTime), 1);
  if (!useStore.getState().settings.tomorrowTab) useStore.getState().setTomorrowTab(true);
  useDayTab.setState({ tab: "today", blank: true });
  for (const t of usePlanner.getState().todos.filter((x) => x.dueDate === tomorrow)) await native.deleteTodo(t.id);
  await sampleTomorrow(false);
  await new Promise((r) => setTimeout(r, 2500));
  useDayTab.setState((d) => ({ resets: d.resets + 1, blank: false }));
}

async function sampleTomorrow(open = true) {
  const tomorrow = addDays(todayKey(new Date(), useStore.getState().settings.dailyResetTime), 1);
  const items: [string, string | null][] = [
    ["Dentist", "09:00"],
    ["Call the bank", "15:00"],
    ["Pack the gym bag", null],
  ];
  for (const [title, dueTime] of items) await native.saveTodo({ title, dueDate: tomorrow, dueTime, durationMin: null, profileId: null });
  await usePlanner.getState().reload();
  if (!useStore.getState().settings.tomorrowTab) useStore.getState().setTomorrowTab(true);
  if (open) useDayTab.setState({ tab: "tomorrow" });
}
