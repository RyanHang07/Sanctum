import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../../components/Button";
import { Row, Section } from "./parts";
import { Switch } from "../../components/controls";
import { errorText, native } from "../../lib/native";
import { clock } from "../../lib/time";
import { shortDate } from "../../lib/trackers";
import type { GuardStatus } from "../../lib/types";
import { useStore } from "../../state/store";
import { StatusLine, useCascade, type ConnectionTone } from "./status";

// The guard service (M8, SPEC 4.4 and 6): blocks flagged sites in every browser through the
// hosts file, and reopens Sanctum if it's closed mid-seal. One admin prompt to install.

/**
 * The guard's status, polled every 10 seconds by one shared poller however many hooks read it
 * (the side list's dot and the section). null while the first check runs. A failed check keeps
 * the last good value, so a transient error doesn't flip the dot to off.
 */
const GUARD_POLL_MS = 10_000;
const guard = {
  status: null as GuardStatus | null,
  /** The last read's failure, said on the page (cleared by the next good read). */
  error: null as string | null,
  subs: new Set<() => void>(),
  timer: undefined as ReturnType<typeof setInterval> | undefined,
  inFlight: false,
  /** Bumped on a direct set and when the last reader leaves, so a slow reply can't land late. */
  gen: 0,
};

function setGuard(next: GuardStatus | null) {
  guard.status = next;
  if (next) guard.error = null;
  guard.subs.forEach((f) => f());
}

function loadGuard() {
  if (guard.inFlight) return;
  guard.inFlight = true;
  const gen = guard.gen;
  native
    .guardStatus()
    .then((s) => gen === guard.gen && setGuard(s))
    .catch((e: unknown) => {
      if (gen !== guard.gen) return;
      guard.error = errorText(e);
      guard.subs.forEach((f) => f());
    })
    .finally(() => {
      if (gen === guard.gen) guard.inFlight = false;
    });
}

function subscribeGuard(fn: () => void): () => void {
  guard.subs.add(fn);
  if (guard.subs.size === 1) {
    loadGuard();
    guard.timer = setInterval(loadGuard, GUARD_POLL_MS);
  }
  return () => {
    guard.subs.delete(fn);
    if (guard.subs.size) return;
    clearInterval(guard.timer);
    guard.timer = undefined;
    guard.gen++;
    guard.inFlight = false;
    guard.status = null;
    guard.error = null;
  };
}

const setGuardNow = (s: GuardStatus) => {
  guard.gen++;
  guard.inFlight = false;
  setGuard(s);
};

function useGuard() {
  const status = useSyncExternalStore(subscribeGuard, () => guard.status);
  const error = useSyncExternalStore(subscribeGuard, () => guard.error);
  return [status, setGuardNow, error] as const;
}

export function protectionTone(s: GuardStatus | null): ConnectionTone {
  if (!s?.installed) return "off";
  return s.running && !s.outdated && !s.lastError ? "ok" : "attention";
}

/** For the side list's dot: on and running, installed but stopped, or off. */
export function useProtectionStatus(): ConnectionTone {
  return protectionTone(useGuard()[0]);
}

/**
 * The guard closing apps run as administrator (v0.1). Off by default: those apps end at once,
 * without a chance to save, so turning it on asks first.
 */
function CloseElevated({ installed, sealed }: { installed: boolean; sealed: boolean }) {
  const showNotice = useStore((s) => s.showNotice);
  const [on, setOn] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    native
      .getSetting("guard_close_elevated")
      .then((v) => setOn(v === "1"))
      .catch((e: unknown) => console.warn("guard_close_elevated", e));
  }, []);
  const set = async (v: boolean) => {
    try {
      setOn(await native.guardCloseElevated(v));
      setAsking(false);
    } catch (e) {
      showNotice({ lead: errorText(e) });
    }
  };
  return (
    <>
      <Row label="Close apps run as administrator" hint={!installed ? "Needs protection on." : sealed && on ? "On until the seal ends." : "Only the guard can close these."}>
        <Switch
          label="Close apps run as administrator"
          checked={on || asking}
          onChange={(v) => (v ? setAsking(true) : on ? void set(false) : setAsking(false))}
        />
      </Row>
      {asking && !on ? (
        <div role="alert" className="flex items-center gap-2 border-b border-line-soft bg-broken-tint px-[14px] py-2 last:border-b-0">
          <span className="grow text-body text-text-2">They end at once. Unsaved work in them is lost.</span>
          <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button variant="raised" size="sm" disabled={!installed} onClick={() => void set(true)}>
            Close them anyway
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function ProtectionSection() {
  const sealed = useStore((s) => s.appState === "sealed");
  const showNotice = useStore((s) => s.showNotice);
  const [status, setStatus, readError] = useGuard();
  const [busy, setBusy] = useState(false);
  const rows = useCascade<HTMLDivElement>(!!status);

  const run = async (fn: () => Promise<GuardStatus>) => {
    setBusy(true);
    try {
      setStatus(await fn());
    } catch (e) {
      showNotice({ lead: errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const tone = protectionTone(status);
  const on = !!status?.installed;
  const install = (label: string) => (
    <Button variant="primary" size="sm" disabled={busy || (!status && !readError)} onClick={() => void run(native.guardInstall)}>
      {busy ? "Waiting for Windows…" : label}
    </Button>
  );
  let line;
  if (!status && readError)
    // The status didn't load: say why, and keep Turn on usable (it installs or repairs).
    line = (
      <StatusLine tone="off" testId="protection-status" action={install("Turn on")}>
        Couldn’t check protection. {readError}
      </StatusLine>
    );
  else if (!status) line = <StatusLine tone="off" testId="protection-status">Checking…</StatusLine>;
  else if (!on)
    line = (
      <StatusLine tone={tone} testId="protection-status" action={install("Turn on")}>
        Off. Sanctum can be closed while you’re sealed.
      </StatusLine>
    );
  else if (!status.running)
    line = (
      <StatusLine tone={tone} testId="protection-status" action={install("Repair")}>
        Installed, but not running.
      </StatusLine>
    );
  else if (status.outdated)
    // A guard from another version may not read this version's data, so it asks to be updated.
    line = (
      <StatusLine tone={tone} testId="protection-status" action={install("Update")}>
        From an older Sanctum. Update it.
      </StatusLine>
    );
  else
    line = (
      <StatusLine
        tone={tone}
        testId="protection-status"
        action={
          <Button variant="quiet" size="sm" disabled={busy || sealed} onClick={() => void run(native.guardUninstall)}>
            {sealed ? "Stays on while sealed" : "Turn off"}
          </Button>
        }
      >
        Sanctum reopens if it’s closed while you’re sealed.
      </StatusLine>
    );

  return (
    <Section title="Protection">
      {line}
      {on && status?.lastError ? (
        <p role="alert" className="m-0 border-b border-line-soft bg-broken-tint px-[14px] py-2 text-body text-broken-text">
          {status.lastError}
        </p>
      ) : null}
      <div ref={rows}>
        {on ? (
          <>
            <Row label="Sites blocked in every browser">
              <span className="shrink-0 text-body text-text-2">{status!.hostsBlocked ? `${status!.hostsBlocked} now` : "While sealed"}</span>
            </Row>
            <Row label="Times it reopened Sanctum">
              <span className="shrink-0 text-body text-text-2">
                {status!.restarts ? `${status!.restarts}, last ${shortDate(status!.lastRestartAt!)} at ${clock(status!.lastRestartAt!)}` : "None"}
              </span>
            </Row>
          </>
        ) : status ? (
          <Row label="Blocks sites in every browser" hint="Asks Windows for approval once.">
            <span />
          </Row>
        ) : null}
        <CloseElevated installed={on} sealed={sealed} />
        {(on && status!.running) || (!status && readError) ? (
          <Row label="Reinstall the guard">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(native.guardInstall)}>
              Repair
            </Button>
          </Row>
        ) : null}
      </div>
    </Section>
  );
}
