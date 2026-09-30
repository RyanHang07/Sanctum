import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { Row, Section } from "./parts";
import { errorText, native } from "../../lib/native";
import { useStore } from "../../state/store";
import type { UpdateInfo } from "../../lib/types";

// Setup > General > About (M13): the version, updates from GitHub Releases, and a diagnostics
// summary to paste into a bug report. Nothing is sent anywhere automatically.

type Check = { state: "idle" | "checking" | "installing" } | { state: "current" } | { state: "available"; update: UpdateInfo } | { state: "error"; message: string };

export function AboutSection() {
  const sealed = useStore((s) => s.appState === "sealed");
  const showNotice = useStore((s) => s.showNotice);
  const [version, setVersion] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  useEffect(() => void native.appVersion().then(setVersion).catch(() => undefined), []);

  const run = async () => {
    setCheck({ state: "checking" });
    try {
      const update = await native.updateCheck();
      setCheck(update ? { state: "available", update } : { state: "current" });
    } catch (e) {
      setCheck({ state: "error", message: errorText(e) });
    }
  };
  const install = async () => {
    setCheck({ state: "installing" });
    try {
      await native.updateInstall();
    } catch (e) {
      setCheck({ state: "error", message: errorText(e) });
    }
  };
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
        ? `Version ${check.update.version} is available.`
        : check.state === "error"
          ? check.message
          : check.state === "installing"
            ? "Downloading. Sanctum restarts when it's done."
            : "Updates come from GitHub Releases.";
  return (
    <Section title="About">
      <Row label={version ? `Sanctum ${version}` : "Sanctum"} hint={hint}>
        {check.state === "available" ? (
          <Button variant="primary" size="sm" disabled={sealed} onClick={() => void install()}>
            {sealed ? "Waits until the seal ends" : "Install and restart"}
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
    </Section>
  );
}
