import { useEffect, useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { APP_STATES } from "../state/appState";
import { useStore } from "../state/store";
import { useRecap } from "../state/recap";
import { useTrackers } from "../state/trackers";
import { useTheme } from "../state/theme";
import { inTauri } from "../lib/native";
import { mockControls } from "../lib/mockBackend";
import { CompactTimer } from "../windows/CompactTimer";
import { HIT } from "./controls";
import type { HeldStats } from "../lib/types";

// Dev builds only. The state toggle, plus a panel that plays the moments and shows the small
// surfaces that are hard to reach by hand (2026-11-16): the seal going on, held, broken, the mini
// timer, onboarding, the extension pages, a check-in and the weekly recap.

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

type Surface = "mini" | "popup" | "blocked";
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
const useDev = create<{ open: boolean; shown: Surface[]; extState: ExtState; popupH: number }>()(() => ({ open: false, shown: [], extState: "sealed", popupH: 230 }));
const setPopupH = (popupH: number) => useDev.setState({ popupH });

export function DevStateToggle() {
  const appState = useStore((s) => s.appState);
  const setAppState = useStore((s) => s.setAppState);
  // A real session owns the seal; the toggle only fakes states when none is running.
  const live = useStore((s) => s.session !== null);
  const { open, shown, extState, popupH } = useDev();
  const setOpen = (open: boolean) => useDev.setState({ open });
  const setExtState = (extState: ExtState) => useDev.setState({ extState });
  // The popup has no Pause mode of its own: during one, nothing is sealed.
  const popupState = extState === "pause" ? "open" : extState;
  const blockedQuery = extState === "pause" ? "pause=1&state=open" : `state=${extState}`;
  // In the browser the mock backend runs everything; inside Tauri only the store-side moments work.
  const mock = !inTauri();
  const toggle = (s: Surface) => useDev.setState((d) => ({ shown: d.shown.includes(s) ? d.shown.filter((x) => x !== s) : [...d.shown, s] }));

  const enterFocus = () => void useStore.getState().enterFocus();
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
        <div data-dev-surfaces className="fixed bottom-24 right-4 z-50 flex flex-col items-end gap-3">
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

      {open ? (
        <div
          aria-label="Dev tools"
          data-dev-tools
          className="fixed bottom-[88px] left-3 z-50 flex w-[300px] flex-col gap-3 rounded-panel border border-line-input bg-panel p-3 text-meta shadow-toast"
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
export const resetDevTools = () => useDev.setState({ open: false, shown: [], extState: "sealed", popupH: 230 });
