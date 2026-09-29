import { useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./controls";
import { useStore } from "../state/store";
import { countdown } from "../lib/time";

export const MIN_REASON = 50;

/**
 * End early, until the break-the-seal ladder (M7) replaces it: a written reason of at least
 * 50 characters (the ladder's level 1 minimum). Copy follows Unlock.dc.html.
 */
export function EndEarlyDialog() {
  const open = useStore((s) => s.endEarlyOpen);
  const session = useStore((s) => s.session);
  const close = useStore((s) => s.closeEndEarly);
  const endEarly = useStore((s) => s.endEarly);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open || !session) return null;
  const count = reason.trim().length;
  const ready = count >= MIN_REASON;

  const stay = () => {
    setReason("");
    close();
  };
  const breakSeal = async () => {
    setBusy(true);
    if (await endEarly(reason)) setReason("");
    setBusy(false);
  };

  return (
    <Dialog label="Break the seal" onClose={stay} width={460} top={150}>
      <div className="flex flex-col gap-3 px-[18px] pb-4 pt-[18px]">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">Break the seal</h1>
          <span className="text-meta text-muted">
            {session.profileName} · <span className="font-mono text-text-2">{countdown(session.remainingMs)}</span> left
          </span>
        </div>
        <p className="m-0 text-body text-text-2">Write down why you're stopping. The reason is saved with this session.</p>
        <textarea
          autoFocus
          aria-label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="resize-none rounded-control border border-line-input bg-raised p-3 text-body text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
          placeholder="What changed, and why it can't wait."
        />
        <span className={`self-end font-mono text-[11px] ${ready ? "text-sealed-text" : "text-faint"}`}>
          {Math.min(count, MIN_REASON)} / {MIN_REASON}
        </span>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
        <Button variant="ghost" disabled={!ready || busy} onClick={() => void breakSeal()}>
          Break the seal
        </Button>
        <Button variant="primary" className="ml-auto" onClick={stay}>
          Never mind, stay sealed
        </Button>
      </div>
    </Dialog>
  );
}
