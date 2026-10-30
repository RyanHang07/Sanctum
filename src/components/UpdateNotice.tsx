import { Button } from "./Button";
import { useStore } from "../state/store";
import { useUpdate } from "../state/update";

// The update notice (v0.3): a downloaded update, one click from installing. Bottom right, out
// of the way; while sealed it says it waits for the seal to end.

export function UpdateNotice() {
  const { ready, later, applying, apply, dismiss } = useUpdate();
  const sealed = useStore((s) => s.appState === "sealed");
  if (!ready || later === ready.version) return null;
  return (
    <div
      role="region"
      aria-label="Update ready"
      className="absolute bottom-7 right-7 z-20 flex w-[300px] animate-rise-in flex-col gap-3 rounded-panel border border-line-input bg-toast p-[14px] shadow-toast"
    >
      <div className="flex flex-col gap-[2px]">
        <span className="text-body font-medium text-text">Sanctum {ready.version} is ready.</span>
        <span className="text-meta text-muted">{sealed ? "It installs after the seal ends." : "One click: it installs and restarts in a few seconds."}</span>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Later
        </Button>
        <Button variant="primary" size="sm" disabled={sealed || applying} onClick={() => void apply()}>
          {applying ? "Updating…" : "Restart to update"}
        </Button>
      </div>
    </div>
  );
}
