import { APP_STATES } from "../state/appState";
import { useStore } from "../state/store";

/** Dev builds only: switch between Open, Sealed, and In event without a session engine. */
export function DevStateToggle() {
  const appState = useStore((s) => s.appState);
  const setAppState = useStore((s) => s.setAppState);
  // A real session owns the seal; the toggle only fakes states when none is running.
  const live = useStore((s) => s.session !== null);
  return (
    <div
      aria-label="Dev state toggle"
      className="fixed bottom-11 left-3 z-50 flex items-center gap-1 rounded-panel border border-line-input bg-panel p-1 text-meta shadow-toast"
    >
      <span className="px-2 font-mono text-[11px] text-faint">DEV</span>
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
  );
}
