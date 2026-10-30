import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { Row, Section } from "./parts";
import { errorText, native } from "../../lib/native";
import { useStore } from "../../state/store";
import type { UpdateInfo } from "../../lib/types";
import { saveEverything } from "../../state/quit";
import { useUpdate } from "../../state/update";
import { useTheme } from "../../state/theme";

// Setup > General > About (M13): the version, updates from GitHub Releases, and a diagnostics
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
        ? `Version ${check.update.version} is downloaded and ready.`
        : check.state === "error"
          ? check.message
          : check.state === "installing"
            ? "Installing. Sanctum restarts in a few seconds."
            : "Sanctum checks for updates on its own and downloads them in the background.";
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
      <Row label="Report a problem" hint="Copies your version, setup, and any crash log. No titles, sites, or emails.">
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          Copy diagnostics
        </Button>
      </Row>
      <Row label="Free and open source" hint="MIT license. Your data stays on this PC; the account holds only what sharing and the partner need.">
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
export function StartOverSection({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const sealed = useStore((s) => s.appState === "sealed");
  const showNotice = useStore((s) => s.showNotice);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await native.resetAll();
      reload();
    } catch (e) {
      showNotice({ lead: errorText(e) });
      setBusy(false);
    }
  };
  return (
    <Section title="Start over">
      <Row
        label="Erase everything on this PC"
        hint="Profiles, distractions, tasks, history, trackers, notes, and settings. This PC signs out of Google and your account; the account, your partner, and Protection stay."
      >
        {asking ? null : (
          <Button variant="ghost" size="sm" disabled={sealed} onClick={() => setAsking(true)}>
            {sealed ? "Waits until the seal ends" : "Start over"}
          </Button>
        )}
      </Row>
      {asking ? (
        <div className="flex flex-col gap-2 border-t border-line-soft px-[14px] py-3">
          <span className="text-meta text-text-2">
            This can’t be undone. Type <span className="font-mono text-text">{CONFIRM}</span> to erase it all and run setup again.
          </span>
          <div className="flex items-center gap-2">
            <input
              aria-label="Type start over to confirm"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-[30px] min-w-0 grow rounded-control border border-line-input bg-raised px-[10px] font-mono text-body text-text outline-none transition-colors duration-ui ease-ui focus:border-broken"
            />
            <Button variant="ghost" size="sm" onClick={() => (setAsking(false), setTyped(""))}>
              Cancel
            </Button>
            <button
              type="button"
              disabled={typed.trim().toLowerCase() !== CONFIRM || busy || sealed}
              onClick={() => void run()}
              className="h-[26px] rounded-control border border-broken-line bg-broken-tint px-2 text-meta font-medium text-broken-text transition-colors duration-ui ease-ui enabled:hover:border-broken disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Erasing…" : "Erase and start over"}
            </button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
