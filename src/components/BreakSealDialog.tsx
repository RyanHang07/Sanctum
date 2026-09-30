import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Kbd } from "./Button";
import { Dialog } from "./controls";
import { CheckIcon, XIcon } from "./icons";
import { errorText, native } from "../lib/native";
import { countdown } from "../lib/time";
import type { LadderView } from "../lib/types";
import { useStore } from "../state/store";

// Break the seal (SPEC 4.5, design/screens/Unlock.dc.html): the ladder, one level at a time.
// Rust holds the state; this dialog shows it and polls while something is running.

export const MIN_REASON = 50;
const POLL_MS = 1000;

type StepState = "todo" | "now" | "done" | "ok" | "no";

function Badge({ n, state }: { n: number; state: StepState }) {
  const cls = {
    todo: "border border-line-input text-faint",
    now: "border border-sealed-line bg-sealed-tint text-text",
    done: "bg-line text-text-2",
    ok: "border border-event-line bg-event-tint text-event",
    no: "border border-broken-line bg-broken-tint text-broken-text",
  }[state];
  return (
    <span className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-mono text-[11px] ${cls}`}>
      {state === "done" || state === "ok" ? <CheckIcon size={9} /> : state === "no" ? <XIcon size={9} /> : n}
    </span>
  );
}

function Steps({ v }: { v: LadderView }) {
  const third: StepState = v.outcome === "denied" || v.outcome === "expired" ? "no" : v.level === 3 ? "now" : "todo";
  const rows: [string, StepState, string][] = [
    [v.level > 1 ? "Reason given, waited 5 minutes" : "Give a reason, then wait 5 minutes", v.level > 1 ? "done" : "now", v.level > 1 ? "Done" : ""],
    ["Retype a paragraph", v.level > 2 ? "done" : v.level === 2 ? "now" : "todo", v.level > 2 ? "Done" : ""],
    [
      v.partner ? `${v.partner} approves` : "30-minute cooldown",
      third,
      v.stage === "partner" ? "Pending" : v.stage === "solo" ? "Running" : v.outcome === "denied" ? "Denied" : v.outcome === "expired" ? "Expired" : "",
    ],
  ];
  return (
    <ol className="m-0 flex list-none flex-col gap-[10px] px-[18px] py-[14px]">
      {rows.map(([label, state, meta], i) => (
        <li key={label} className="flex items-center gap-[10px]">
          <Badge n={i + 1} state={state} />
          <span className={`grow text-body ${state === "done" ? "text-muted" : state === "todo" ? "text-faint" : "text-text"}`}>{label}</span>
          <span className="text-meta text-muted">{meta}</span>
        </li>
      ))}
    </ol>
  );
}

function Quote({ children }: { children: ReactNode }) {
  return <div className="rounded-panel border border-line bg-panel-footer px-3 py-[10px] text-body leading-normal text-text-2">“{children}”</div>;
}

function Spinner() {
  return (
    <svg className="shrink-0 animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" className="stroke-line-input" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" className="stroke-sealed" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

const minutesAgo = (t: number) => {
  const m = Math.max(0, Math.floor((Date.now() - t) / 60_000));
  return m === 0 ? "just now" : `${m} min ago`;
};
const minutesLeft = (t: number) => Math.max(0, Math.ceil((t - Date.now()) / 60_000));

/** The session is over: how it ended. */
function Result() {
  const result = useStore((s) => s.unlockResult);
  const clear = useStore((s) => s.setUnlockResult);
  if (!result) return null;
  const done = () => clear(null);
  const lead = result.kind === "approved" ? `${result.partner ?? "Your partner"} approved.` : result.kind === "solo" ? "Cooldown done." : "Emergency unlock used.";
  return (
    <Dialog label="Seal lifted" onClose={done} width={460} top={150}>
      <div className="flex flex-col gap-3 px-[18px] pb-4 pt-[18px]">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-panel border border-event-line bg-event-tint text-event">
            <CheckIcon size={12} />
          </span>
          <span className="text-[15px] font-semibold">{lead} Seal lifted.</span>
        </div>
        <p className="m-0 text-meta text-muted">
          {result.kind === "emergency"
            ? `This week's emergency unlock is used.${result.partner ? ` ${result.partner} was told.` : ""} It isn't a broken seal; the day still needs your goal.`
            : "This counts as an approved exit, not a broken seal. Your streak is safe; the day still needs your goal."}
        </p>
      </div>
      <div className="flex items-center border-t border-line bg-panel-footer px-[18px] py-3">
        <Button variant="primary" className="ml-auto gap-[10px]" onClick={done}>
          Back to work <Kbd onFill>↵</Kbd>
        </Button>
      </div>
    </Dialog>
  );
}

function Emergency({ v, onError }: { v: LadderView; onError: (e: string) => void }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const setResult = useStore((s) => s.setUnlockResult);
  const close = useStore((s) => s.closeEndEarly);
  if (v.emergencyNextAt) {
    const d = new Date(v.emergencyNextAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    return <span className="text-meta text-faint">Emergency unlock back {d}</span>;
  }
  if (!open) {
    return (
      <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
        Emergency unlock
      </Button>
    );
  }
  const go = async () => {
    try {
      await native.emergencyUnlock(why);
      close();
      setResult({ kind: "emergency", partner: v.partner });
    } catch (e) {
      onError(errorText(e));
    }
  };
  return (
    <span className="flex min-w-0 grow items-center gap-2">
      <input
        autoFocus
        aria-label="What's the emergency"
        placeholder="What's the emergency"
        value={why}
        onChange={(e) => setWhy(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void go()}
        className="h-[28px] min-w-0 grow rounded-control border border-line-input bg-raised px-2 text-meta text-text outline-none placeholder:text-faint focus:border-broken"
      />
      <Button variant="ghost" size="sm" disabled={!why.trim()} onClick={() => void go()}>
        Use it
      </Button>
    </span>
  );
}

export function BreakSealDialog() {
  const open = useStore((s) => s.endEarlyOpen);
  const session = useStore((s) => s.session);
  const close = useStore((s) => s.closeEndEarly);
  const setResult = useStore((s) => s.setUnlockResult);
  const [v, setV] = useState<LadderView | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  const apply = useCallback(
    (next: LadderView) => {
      if (next.outcome === "approved") {
        close();
        setResult({ kind: next.stage === "solo" ? "solo" : "approved", partner: next.partner });
        return;
      }
      setV(next);
    },
    [close, setResult],
  );
  const run = (f: () => Promise<LadderView>) =>
    void f()
      .then((next) => {
        setError(null);
        setDraft("");
        apply(next);
      })
      .catch((e) => setError(errorText(e)));

  useEffect(() => {
    if (!open || !session) return;
    let live = true;
    void native.ladderOpen().then((x) => live && apply(x), (e) => live && setError(errorText(e)));
    const t = setInterval(() => {
      tick((n) => n + 1);
      // An approval ends the session, which tears this effect down; show it anyway.
      void native.ladderView().then((x) => (live || x.outcome === "approved") && apply(x), () => undefined);
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [open, session?.id, apply]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !session || !v) return <Result />;

  const stay = () => {
    if (v.stage !== "none") void native.ladderCancel();
    setDraft("");
    setError(null);
    close();
  };

  let body: ReactNode;
  let action: ReactNode = null;
  if (v.level === 1 && v.waitLeftMs === null) {
    const n = draft.trim().length;
    body = (
      <>
        <p className="m-0 text-body text-text-2">Write down why you're stopping. Then a 5-minute wait; leaving this window restarts it.</p>
        <textarea
          autoFocus
          aria-label="Reason"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder="What changed, and why it can't wait."
          className="resize-none rounded-control border border-line-input bg-raised p-3 text-body text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
        />
        <span className={`self-end font-mono text-[11px] ${n >= MIN_REASON ? "text-sealed-text" : "text-faint"}`}>
          {Math.min(n, MIN_REASON)} / {MIN_REASON}
        </span>
      </>
    );
    action = (
      <Button variant="ghost" disabled={n < MIN_REASON} onClick={() => run(() => native.ladderReason(draft))}>
        Start the wait
      </Button>
    );
  } else if (v.level === 1) {
    const left = v.waitLeftMs ?? 0;
    body = (
      <>
        <div className="flex items-baseline gap-3">
          <span data-testid="ladder-wait" className="font-mono text-[28px] font-medium tracking-[-0.02em]">
            {countdown(left)}
          </span>
          <span className="text-meta text-muted">Stay on this window. Leaving it restarts the wait.</span>
        </div>
        {v.reason ? <Quote>{v.reason}</Quote> : null}
      </>
    );
    action = (
      <Button variant="ghost" disabled={left > 0} onClick={() => run(native.ladderContinue)}>
        Continue
      </Button>
    );
  } else if (v.level === 2) {
    const exact = draft.trim() === v.paragraph;
    body = (
      <>
        {v.outcome ? (
          <p className="m-0 text-meta text-muted">
            {v.outcome === "denied" ? `${v.partner ?? "Your partner"} said no.` : "The request expired."} Asking again starts here.
          </p>
        ) : null}
        <p className="m-0 text-body text-text-2">Type this exactly. No pasting.</p>
        <p
          data-testid="ladder-paragraph"
          onCopy={(e) => e.preventDefault()}
          className="m-0 select-none rounded-panel border border-line bg-panel-footer px-3 py-[10px] text-body leading-normal text-text"
        >
          {v.paragraph}
        </p>
        <textarea
          autoFocus
          aria-label="Retype the paragraph"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          rows={5}
          spellCheck={false}
          className="resize-none rounded-control border border-line-input bg-raised p-3 text-body text-text outline-none transition-colors duration-ui ease-ui hover:border-check-line focus:border-sealed"
        />
      </>
    );
    action = (
      <Button variant="ghost" disabled={!exact} onClick={() => run(() => native.ladderRetype(draft))}>
        Done
      </Button>
    );
  } else if (v.stage === "partner") {
    body = (
      <>
        <div className="flex items-center gap-3">
          <Spinner />
          <span className="flex flex-col gap-[2px]">
            <span className="text-[15px] font-semibold">Waiting on {v.partner}</span>
            <span className="text-meta text-muted">
              Approval email sent {v.requestedAt ? minutesAgo(v.requestedAt) : ""} · expires in {v.expiresAt ? minutesLeft(v.expiresAt) : 30} min
            </span>
          </span>
        </div>
        {v.reason ? <Quote>{v.reason}</Quote> : null}
        <span className="text-meta text-muted">You stay sealed until {v.partner} approves. If they deny it or it expires, the seal stands.</span>
      </>
    );
  } else if (v.stage === "solo") {
    const left = v.soloLeftMs ?? 0;
    body = (
      <>
        {v.notice ? <p className="m-0 text-meta text-muted">{v.notice}</p> : null}
        <div className="flex items-baseline gap-3">
          <span data-testid="ladder-cooldown" className="font-mono text-[28px] font-medium tracking-[-0.02em]">
            {countdown(left)}
          </span>
          <span className="text-meta text-muted">Stay on this window. Leaving it restarts the cooldown.</span>
        </div>
      </>
    );
    action = (
      <Button variant="ghost" disabled={left > 0} onClick={() => run(native.ladderFinishSolo)}>
        End the session
      </Button>
    );
  } else {
    const refused = v.outcome === "denied" || v.outcome === "expired";
    body = (
      <>
        {refused ? (
          <>
            <h2 className="headline m-0 text-[22px]">
              {v.outcome === "denied" ? `${v.partner ?? "Your partner"} said no.` : "The request expired."} <em>The seal stands.</em>
            </h2>
            {v.note ? <Quote>{v.note}</Quote> : null}
          </>
        ) : (
          <p className="m-0 text-body text-text-2">
            {v.partner
              ? `${v.partner} gets an email with your reason and approves or denies it with their PIN. The request expires in 30 minutes.`
              : "No partner is linked, so the last step is a 30-minute cooldown. Leaving this window restarts it."}
          </p>
        )}
        {v.retryAt ? <span className="text-meta text-muted">Next request unlocks in {minutesLeft(v.retryAt)} min.</span> : null}
      </>
    );
    action = (
      <Button variant="ghost" disabled={!!v.retryAt} onClick={() => run(native.ladderRequest)}>
        {v.partner ? `Ask ${v.partner}` : "Start the cooldown"}
      </Button>
    );
  }

  return (
    <Dialog label="Break the seal" onClose={stay} width={460} top={110}>
      <div className="flex items-center justify-between border-b border-line px-[18px] py-[14px]">
        <span className="text-body font-semibold">Break the seal</span>
        <span className="font-mono text-meta text-muted">
          {session.profileName} · {countdown(session.remainingMs)} left
        </span>
      </div>
      <Steps v={v} />
      <div className="flex flex-col gap-3 border-t border-line px-[18px] pb-[18px] pt-4">
        {body}
        {error ? <p className="m-0 text-meta text-broken-text">{error}</p> : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
        <Emergency v={v} onError={setError} />
        {action}
        <Button variant="primary" className="ml-auto shrink-0" onClick={stay}>
          Never mind, stay sealed
        </Button>
      </div>
    </Dialog>
  );
}
