import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { Section } from "./parts";
import { Switch } from "../../components/controls";
import { errorText, native } from "../../lib/native";
import { clock } from "../../lib/time";
import { shortDate } from "../../lib/trackers";
import type { GuardStatus } from "../../lib/types";
import { useStore } from "../../state/store";

// The guard service (M8, SPEC 4.4 and 6): blocks flagged sites in every browser through the
// hosts file, and reopens Sanctum if it's closed mid-seal. One admin prompt to install.

/**
 * The guard closing apps run as administrator (v0.1). Off by default: those apps end at once,
 * without a chance to save, so turning it on asks first.
 */
function CloseElevated({ installed, sealed }: { installed: boolean; sealed: boolean }) {
  const showNotice = useStore((s) => s.showNotice);
  const [on, setOn] = useState(false);
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    void native.getSetting("guard_close_elevated").then((v) => setOn(v === "1"));
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
    <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
      <div className="flex items-center gap-[10px]">
        <span className="flex min-w-0 grow flex-col gap-[2px]">
          <span className="text-body">Close apps run as administrator</span>
          <span className="text-[11px] text-muted">
            {!installed ? "Needs protection on." : sealed && on ? "Stays on until the seal ends." : "Sanctum can’t close these itself; the guard can."}
          </span>
        </span>
        <Switch
          label="Close apps run as administrator"
          checked={on || asking}
          onChange={(v) => (v ? setAsking(true) : on ? void set(false) : setAsking(false))}
        />
      </div>
      {asking && !on ? (
        <div role="alert" className="flex flex-col gap-2 rounded-control border border-broken-line bg-broken-tint px-3 py-2">
          <span className="text-meta leading-normal text-text-2">
            The guard ends sealed apps you started as administrator at once, with no chance to save. Unsaved work in them is lost.
          </span>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
              Cancel
            </Button>
            <Button variant="raised" size="sm" disabled={!installed} onClick={() => void set(true)}>
              Close them anyway
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProtectionSection() {
  const sealed = useStore((s) => s.appState === "sealed");
  const showNotice = useStore((s) => s.showNotice);
  const [status, setStatus] = useState<GuardStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => void native.guardStatus().then(setStatus).catch(() => setStatus(null)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

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

  const on = !!status?.installed;
  const state = !status ? "Checking…" : !on ? "Off" : status.running ? "On" : "Installed, not running";
  return (
    <Section
      title="Protection"
      action={
        <span className="flex items-center gap-[6px] text-meta text-muted">
          <span className={`h-[6px] w-[6px] rounded-full ${on && status?.running ? "bg-sealed" : "bg-faint"}`} />
          {state}
        </span>
      }
    >
      <div className="flex flex-col gap-3 px-[14px] py-3">
        <p className="m-0 text-body leading-normal text-text-2">
          Blocks your flagged sites in every browser, even without the extension, and reopens Sanctum within seconds if it’s closed mid-seal.
        </p>
        {on ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-meta text-muted">
            <li>{status!.hostsBlocked ? `${status!.hostsBlocked} ${status!.hostsBlocked === 1 ? "site is" : "sites are"} blocked in every browser right now.` : "Sites are blocked in every browser while you’re sealed."}</li>
            <li>
              {status!.restarts
                ? `Brought Sanctum back ${status!.restarts} ${status!.restarts === 1 ? "time" : "times"}, last on ${shortDate(status!.lastRestartAt!)} at ${clock(status!.lastRestartAt!)}.`
                : "Hasn’t needed to bring Sanctum back."}
            </li>
          </ul>
        ) : (
          <p className="m-0 text-meta text-muted">Links, keywords, and sites with allowed pages stay with the browser extension.</p>
        )}
        <div className="flex items-center gap-2">
          {on ? (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(native.guardInstall)}>
                Repair
              </Button>
              <Button variant="quiet" size="sm" disabled={busy || sealed} onClick={() => void run(native.guardUninstall)}>
                {sealed ? "Stays on while sealed" : "Turn off"}
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" disabled={busy || !status} onClick={() => void run(native.guardInstall)}>
              {busy ? "Waiting for Windows…" : "Turn on protection"}
            </Button>
          )}
          <span className="ml-auto text-[11px] text-faint">Asks Windows for admin approval once</span>
        </div>
        <CloseElevated installed={on} sealed={sealed} />
      </div>
    </Section>
  );
}
