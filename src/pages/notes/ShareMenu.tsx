import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { useNotes } from "../../state/notes";
import { useStore } from "../../state/store";
import { native } from "../../lib/native";
import type { CloudStatus, Note } from "../../lib/types";

// Share a note (v0.2): a live, read-only link, encrypted end to end. Pick how long; copy the
// link; stop any time. Needs the Sanctum account (Setup › Partner).

const DURATIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 24, label: "1 day" },
  { hours: 168, label: "7 days" },
];

const until = (ms: number) => new Date(ms).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

function ShareGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

export function ShareMenu({ n }: { n: Note }) {
  const { share, stopShare } = useNotes();
  const [open, setOpen] = useState(false);
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const live = n.share && n.share.expiresAt > Date.now() ? n.share : null;

  useEffect(() => {
    if (!open) return;
    void native.cloudStatus().then(setCloud).catch(() => setCloud(null));
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={live ? "Shared: manage the link" : "Share"}
        title={live ? `Shared until ${until(live.expiresAt)}` : "Share a read-only link"}
        onClick={() => setOpen(!open)}
        className={`flex h-7 items-center gap-[6px] rounded-control px-2 text-meta transition-colors duration-ui ease-ui ${
          live ? "bg-sealed-tint text-sealed-text hover:text-sealed-text-hover" : "text-muted hover:bg-raised hover:text-text"
        }`}
      >
        <ShareGlyph />
        {live ? "Shared" : "Share"}
      </button>
      {open ? (
        <div role="dialog" aria-label="Share this note" className="absolute right-0 top-9 z-30 flex w-[320px] animate-rise-in flex-col gap-3 rounded-panel border border-line-input bg-panel p-4 shadow-toast">
          {cloud && !cloud.configured ? (
            <p className="m-0 text-body text-muted">Sharing needs Sanctum's account service, which this build doesn't have.</p>
          ) : cloud && !cloud.signedIn ? (
            <>
              <p className="m-0 text-body text-text-2">Sign in to your Sanctum account to share notes.</p>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  useStore.getState().openSetup("partner");
                }}
              >
                Open Setup › Partner
              </Button>
            </>
          ) : live ? (
            <>
              <span className="text-meta text-muted">Anyone with this link can read the note until {until(live.expiresAt)}. Edits show up there as you type.</span>
              <div className="flex gap-2">
                <input aria-label="Share link" readOnly value={live.url} onFocus={(e) => e.currentTarget.select()} className="h-control min-w-0 grow rounded-control border border-line-input bg-raised px-2 font-mono text-[11px] text-text-2 outline-none" />
                <Button
                  variant="primary"
                  onClick={() =>
                    void navigator.clipboard?.writeText(live.url).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => stopShare(n.id))}>
                Stop sharing
              </Button>
            </>
          ) : (
            <>
              <span className="text-body font-semibold text-text">Share a read-only link</span>
              <span className="text-meta text-muted">
                Encrypted end to end: the key is only in the link, so not even Sanctum's server can read it. Images go without their hidden data (like location).
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Link works for</span>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Link works for">
                {DURATIONS.map((d) => (
                  <Button key={d.hours} variant="ghost" disabled={busy || !cloud} onClick={() => void run(() => share(n.id, d.hours))}>
                    {d.label}
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
