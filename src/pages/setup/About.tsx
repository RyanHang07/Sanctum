import { useEffect, useRef, useState } from "react";
import { Fold } from "../week/marks";
import { Button } from "../../components/Button";
import { Row, Section } from "./parts";
import { errorText, native } from "../../lib/native";
import { useStore } from "../../state/store";
import type { UpdateInfo } from "../../lib/types";
import { saveEverything } from "../../state/quit";
import { useUpdate } from "../../state/update";
import { useTheme } from "../../state/theme";

// Setup > Behavior > About (M13): the version, updates from GitHub Releases, and a diagnostics
// summary to paste into a bug report. Nothing is sent anywhere automatically.
// v0.3: Check now downloads what it finds, so "Restart to update" is one click (the same path
// as the update notice); and the license, privacy policy, terms, and notices are a click away.

type Check = { state: "idle" | "checking" | "installing" } | { state: "current" } | { state: "available"; update: UpdateInfo } | { state: "error"; message: string };

export function AboutSection() {
  const sealed = useStore((s) => s.appState === "sealed");
  const showNotice = useStore((s) => s.showNotice);
  const [version, setVersion] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  useEffect(() => void native.appVersion().then(setVersion).catch(() => undefined), []);

  const ready = useUpdate((s) => s.ready);
  const scheme = useTheme((s) => s.theme.scheme);
  // A background download already waiting shows here too.
  useEffect(() => {
    if (ready) setCheck((c) => (c.state === "installing" ? c : { state: "available", update: ready }));
  }, [ready]);

  const run = async () => {
    setCheck({ state: "checking" });
    try {
      const update = await native.updateCheck();
      if (update) useUpdate.setState({ ready: update });
      setCheck(update ? { state: "available", update } : { state: "current" });
    } catch (e) {
      setCheck({ state: "error", message: errorText(e) });
    }
  };
  const install = async () => {
    setCheck({ state: "installing" });
    try {
      await saveEverything();
      await native.updateApply();
    } catch (e) {
      setCheck({ state: "error", message: errorText(e) });
    }
  };
  const open = (page: string) => void native.openSite(page, scheme).catch((e) => showNotice({ lead: errorText(e) }));
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(await native.diagnostics());
      showNotice({ lead: "Diagnostics copied.", rest: "Paste them into a GitHub issue." });
    } catch (e) {
      showNotice({ lead: errorText(e) });
    }
  };

  const hint =
    check.state === "current"
      ? "You have the latest version."
      : check.state === "available"
        ? `Version ${check.update.version} is ready`
        : check.state === "error"
          ? check.message
          : check.state === "installing"
            ? "Installing. Restarting shortly."
            : "Updates download on their own";
  return (
    <Section title="About">
      <Row label={version ? `Sanctum ${version}` : "Sanctum"} hint={hint}>
        {check.state === "available" ? (
          <Button variant="primary" size="sm" disabled={sealed} onClick={() => void install()}>
            {sealed ? "Waits until the seal ends" : "Restart to update"}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" disabled={check.state === "checking" || check.state === "installing"} onClick={() => void run()}>
            {check.state === "checking" ? "Checking…" : "Check for updates"}
          </Button>
        )}
      </Row>
      <Row label="Report a problem" hint="No titles, sites, or emails">
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          Copy diagnostics
        </Button>
      </Row>
      <Row label="Free and open source" hint="MIT license. Data stays here.">
        <span className="flex items-center gap-1">
          {(
            [
              ["privacy", "Privacy"],
              ["terms", "Terms"],
              ["legal", "Legal"],
            ] as const
          ).map(([page, label]) => (
            <Button key={page} variant="quiet" size="sm" onClick={() => open(page)}>
              {label}
            </Button>
          ))}
        </span>
      </Row>
    </Section>
  );
}

const CONFIRM = "start over";

/**
 * Start over: erases what Sanctum keeps on this PC and signs it out of Google Calendar and the
 * account, then opens first-run setup. Typed confirmation; never while sealed.
 */
/** What reset_all answers when Google can't be reached; nothing is erased yet. */
const CALENDAR_STUCK = "calendar-stuck:";

export function StartOverSection({ reload = () => window.location.reload() }: { reload?: () => void }) {
  return (
    <Section title="Start over">
      <StartOverRows reload={reload} />
    </Section>
  );
}

/** Start over's row and its confirmation, for a section to hold (Your Data's danger zone). */
export function StartOverRows({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const sealed = useStore((s) => s.appState === "sealed");
  const showNotice = useStore((s) => s.showNotice);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [stuck, setStuck] = useState(false);
  // The field stays mounted inside the fold, so it's focused when the fold opens.
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (asking && !stuck) field.current?.focus();
  }, [asking, stuck]);
  const run = async (force = false) => {
    setBusy(true);
    try {
      await native.resetAll(force);
      reload();
    } catch (e) {
      const text = errorText(e);
      if (text.startsWith(CALENDAR_STUCK)) setStuck(true);
      else showNotice({ lead: text });
      setBusy(false);
    }
  };
  return (
    <>
      <Row label="Erase everything on this PC" hint="Then setup runs again">
        {asking ? null : (
          <Button variant="danger-quiet" size="sm" disabled={sealed} onClick={() => setAsking(true)}>
            {sealed ? "Waits until the seal ends" : "Start over"}
          </Button>
        )}
      </Row>
      {/* Each step folds open and shut (2026-11-20), and says what it does in a few short lines. */}
      <Fold open={stuck}>
        <div className="flex flex-col gap-2 border-t border-line-soft px-[14px] py-3">
          <div className="flex flex-col gap-1 text-meta">
            <span className="text-text">Couldn’t reach Google. Nothing is erased yet.</span>
            <span className="text-muted">Erase anyway leaves Sanctum’s calendar in Google for you to delete.</span>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => (setStuck(false), setAsking(false), setTyped(""))}>
              Cancel
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => (setStuck(false), void run())}>
              Try again
            </Button>
            <Button variant="danger" size="sm" disabled={busy || sealed} onClick={() => void run(true)}>
              {busy ? "Erasing…" : "Erase anyway"}
            </Button>
          </div>
        </div>
      </Fold>
      <Fold open={asking && !stuck}>
        <div className="flex flex-col gap-3 border-t border-line-soft px-[14px] py-3">
          <dl className="m-0 grid grid-cols-[56px_1fr] gap-x-3 gap-y-1 text-meta">
            <dt className="text-danger-text">Erases</dt>
            <dd className="m-0 text-text-2">Profiles, history, notes, settings, Sanctum’s Google calendar</dd>
            <dt className="text-muted">Keeps</dt>
            <dd className="m-0 text-text-2">Your account, partner, Protection</dd>
          </dl>
          <span className="text-meta text-muted">
            Can’t be undone. Type <span className="font-mono text-text">{CONFIRM}</span> to confirm.
          </span>
          <div className="flex items-center gap-2">
            <input
              ref={field}
              aria-label="Type start over to confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-control-sm min-w-0 grow rounded-control border border-line-input bg-raised px-[10px] font-mono text-body text-text transition-colors duration-ui ease-ui focus:border-danger"
            />
            <Button variant="ghost" size="sm" onClick={() => (setAsking(false), setTyped(""))}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" disabled={typed.trim().toLowerCase() !== CONFIRM || busy || sealed} onClick={() => void run()}>
              {busy ? "Erasing…" : "Erase and start over"}
            </Button>
          </div>
        </div>
      </Fold>
    </>
  );
}
