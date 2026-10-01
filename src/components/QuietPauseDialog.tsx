import { useEffect, useState } from "react";
import { Button, Kbd } from "./Button";
import { Dialog } from "./controls";
import { errorText, native } from "../lib/native";
import { QUIET_MIN_REASON } from "../lib/quiet";
import { clock } from "../lib/time";
import { useStore } from "../state/store";

/**
 * Pausing quiet hours (v0.1): fifteen minutes, with a reason. No ladder and no partner; the
 * reason is kept for your own review. Opened from the tray or the quiet overlay.
 */
export function QuietPauseDialog() {
  const open = useStore((s) => s.quietPauseOpen);
  const quiet = useStore((s) => s.quiet);
  const close = useStore((s) => s.closeQuietPause);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);
  if (!open) return null;

  const ready = reason.trim().length >= QUIET_MIN_REASON;
  const pause = async () => {
    if (!ready) return setError("Say why in a sentence.");
    try {
      const q = await native.quietPause(reason);
      useStore.getState().applyQuiet(q);
      close();
      if (q.pausedUntil) useStore.getState().showNotice({ lead: "Quiet hours paused.", rest: `They pick up again at ${clock(q.pausedUntil)}.` });
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Dialog label="Pause quiet hours" onClose={close} width={440} top={150}>
      <div className="flex flex-col gap-3 px-[18px] pb-4 pt-[18px]">
        <h1 className="headline m-0 text-[22px]">
          Fifteen minutes. <em>Say why.</em>
        </h1>
        <p className="m-0 text-body leading-normal text-text-2">
          {quiet?.endsAt ? `Quiet hours run until ${clock(quiet.endsAt)}. ` : ""}Your Distractions list opens for 15 minutes, then closes again. Your streak doesn't change.
        </p>
        <textarea
          aria-label="Why pause"
          autoFocus
          rows={3}
          value={reason}
          placeholder="Calling my sister back about the weekend"
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void pause();
            }
          }}
          className="resize-none rounded-control border border-line-input bg-raised px-3 py-2 text-body text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
        />
        {error ? <p className="m-0 text-meta text-broken">{error}</p> : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
        <span className="text-meta text-faint">Kept for your own review</span>
        <Button variant="ghost" className="ml-auto" onClick={close}>
          Keep quiet
        </Button>
        <Button variant="primary" className="gap-[10px]" disabled={!ready} onClick={() => void pause()}>
          Pause 15 min
          <Kbd onFill>↵</Kbd>
        </Button>
      </div>
    </Dialog>
  );
}
