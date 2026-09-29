import { useEffect } from "react";
import { Button, Kbd } from "./Button";
import { useStore } from "../state/store";

const SHOW_MS = 2 * 60_000;

/** "Interview Prep starts now." when a profile-linked block begins (SPEC 4.12). Enter or Skip. */
export function BlockPrompt() {
  const s = useStore((st) => st.blockPrompt);
  const profile = useStore((st) => st.profiles.find((p) => p.id === s?.profileId));
  const dismiss = () => useStore.getState().showBlockPrompt(null);

  useEffect(() => {
    if (!s) return;
    const t = setTimeout(dismiss, SHOW_MS);
    return () => clearTimeout(t);
  }, [s]);

  if (!s || !profile) return null;
  return (
    <div
      role="alertdialog"
      aria-label={`${profile.name} starts now`}
      className="absolute bottom-7 left-1/2 z-30 flex w-[440px] -translate-x-1/2 animate-rise-in items-center gap-3 rounded-panel border border-sealed-line bg-panel py-3 pl-4 pr-3 shadow-dialog"
    >
      <div className="flex min-w-0 grow flex-col gap-[2px]">
        <span className="text-body font-semibold text-text">{profile.name} starts now.</span>
        <span className="truncate text-meta text-muted">
          {s.item.title} · {s.minutes} min
        </span>
      </div>
      <Button variant="quiet" size="sm" onClick={dismiss}>
        Skip
      </Button>
      <Button variant="primary" className="gap-2" onClick={() => void useStore.getState().enterSuggested(s)}>
        Enter focus <Kbd onFill>↵</Kbd>
      </Button>
    </div>
  );
}
