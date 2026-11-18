import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import { HEADLINE } from "../pages/headlines";
import { useStore } from "../state/store";
import { canQuit } from "../state/appState";
import { quitSaved, saveEverything } from "../state/quit";
import { EVENTS, native, onNative } from "../lib/native";

// A render error in one place shouldn't blank a window (least of all mid-seal). The window
// boundary wraps each window's root and offers a reload; the page boundary wraps the page in
// AppShell, so the sidebar, the seal's timer and End early stay up while one page is down.

/** "silent" drops a side tool (the dev toggle) without a fallback of its own. */
export type BoundaryKind = "window" | "compact" | "page" | "silent";

interface Props {
  kind: BoundaryKind;
  /** The main window: its fallback still answers the close button (the close dialog is gone with the shell). */
  main?: boolean;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

const reload = () => window.location.reload();

/** How long a reload waits on the saves before it goes anyway (a hung save can't block it). */
export const RELOAD_SAVE_MS = 1500;

/** Saves the typing and deletes still waiting, then reloads. */
export function saveThenReload(): Promise<void> {
  const wait = new Promise<void>((resolve) => setTimeout(resolve, RELOAD_SAVE_MS));
  return Promise.race([saveEverything().catch(() => undefined), wait]).finally(reload);
}

/** The close button, with no close dialog to ask: quit if that's the setting and allowed, else the tray. */
export function closeWithoutDialog(): void {
  const s = useStore.getState();
  s.closeCloseDialog();
  if (s.settings.closeAction === "quit" && canQuit(s.appState)) void quitSaved();
  else void native.hideToTray().catch(() => undefined);
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[${this.props.kind}] render error`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.kind === "silent") return null;
    if (this.props.kind === "page") return <PageFallback />;
    if (this.props.kind === "compact") return <CompactFallback />;
    return <WindowFallback main={!!this.props.main} />;
  }
}

function WindowFallback({ main }: { main: boolean }) {
  useEffect(() => {
    if (!main) return;
    const off = onNative(EVENTS.closeRequested, closeWithoutDialog);
    return () => void off.then((f) => f());
  }, [main]);
  return (
    <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-4 bg-app p-6 text-center text-text">
      <h1 className="headline m-0 text-moment-dialog">{HEADLINE.screenBroke}</h1>
      <p className="m-0 text-body text-text-2">A reload brings it back. A running seal keeps running.</p>
      <Button variant="primary" onClick={() => void saveThenReload()}>
        Reload
      </Button>
    </div>
  );
}

/** The compact timer is 58px tall: one line and the button. */
function CompactFallback() {
  return (
    <div role="alert" className="flex h-full w-full items-center gap-3 rounded-dialog border border-line bg-panel px-3 text-text">
      <span className="grow truncate text-body">{HEADLINE.screenBroke}</span>
      <Button variant="ghost" size="sm" onClick={reload}>
        Reload
      </Button>
    </div>
  );
}

/** One page is down: say so, keep the way out. While sealed, End early stays one click away. */
function PageFallback() {
  const sealed = useStore((s) => s.appState === "sealed" && !!s.session);
  const openEndEarly = useStore((s) => s.openEndEarly);
  const navigate = useStore((s) => s.navigate);
  const onToday = useStore((s) => s.activeTab === "today");
  return (
    <div role="alert" className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="headline m-0 text-moment-dialog">{HEADLINE.screenBroke}</h1>
      <p className="m-0 text-body text-text-2">The other pages still work.{sealed ? " The seal keeps running." : ""}</p>
      <div className="flex items-center gap-2">
        {sealed ? (
          <Button variant="ghost" onClick={openEndEarly}>
            End early
          </Button>
        ) : null}
        {!onToday ? (
          <Button variant="ghost" onClick={() => navigate("today")}>
            Go to Today
          </Button>
        ) : null}
        <Button variant="primary" onClick={() => void saveThenReload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
