import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { Row, Section } from "./parts";
import { errorText, native } from "../../lib/native";
import { useStore } from "../../state/store";
import type { CloudStatus, FileInfo } from "../../lib/types";
import { DeleteAccount } from "./Account";
import { StartOverRows } from "./About";

// Setup › Your Data (v0.1): export what you've logged to read elsewhere, back up the whole
// database, and restore a backup. Everything lands in Documents\Sanctum. The danger zone
// (start over, delete the account) closes the section, together and last.

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function when(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function DataSection({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const sealed = useStore((s) => s.appState === "sealed");
  const notice = useStore((s) => s.showNotice);
  const [last, setLast] = useState<FileInfo | null>(null);
  const [lastJournal, setLastJournal] = useState<FileInfo | null>(null);
  const [backups, setBackups] = useState<FileInfo[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const refresh = () =>
    void native
      .backupList()
      .then(setBackups)
      .catch(() => setBackups([]));
  useEffect(refresh, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      notice({ lead: errorText(e) });
    } finally {
      setBusy(null);
    }
  };
  const exportAs = (format: "json" | "csv") =>
    run(format, async () => {
      const f = await native.exportData(format);
      setLast(f);
      notice({ lead: "Exported.", rest: f.name });
    });
  // The journal stays out of the general export: it's its own file, and only while unlocked.
  const exportJournal = async (format: "md" | "json") => {
    setBusy(`journal-${format}`);
    try {
      const f = await native.journalExport(format);
      setLastJournal(f);
      notice({ lead: "Exported.", rest: f.name });
    } catch (e) {
      const text = errorText(e);
      notice({ lead: /locked/i.test(text) ? "Unlock the journal to export it." : text });
    } finally {
      setBusy(null);
    }
  };
  const backUp = () =>
    run("backup", async () => {
      const f = await native.backupCreate();
      notice({ lead: "Backed up.", rest: f.name });
      refresh();
    });
  const restore = (path: string) =>
    run(path, async () => {
      await native.backupRestore(path);
      reload();
    });

  return (
    <Section
      title="Your Data"
      titled={false}
      action={
        <Button variant="quiet" size="sm" onClick={() => void native.dataReveal("").catch(() => undefined)}>
          Open folder
        </Button>
      }
    >
      <Row label="Export" hint={last ? `Saved ${last.name}` : "Everything you've logged"}>
        {last ? (
          <Button variant="quiet" size="sm" onClick={() => void native.dataReveal(last.path).catch(() => undefined)}>
            Show
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void exportAs("json")}>
          JSON
        </Button>
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void exportAs("csv")}>
          CSV
        </Button>
      </Row>
      <Row label="Export the journal" hint="Unlock it first">
        {lastJournal ? (
          <Button variant="quiet" size="sm" aria-label={`Show ${lastJournal.name}`} onClick={() => void native.dataReveal(lastJournal.path).catch(() => undefined)}>
            Show
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" aria-label="Journal as Markdown" disabled={busy !== null} onClick={() => void exportJournal("md")}>
          Markdown
        </Button>
        <Button variant="ghost" size="sm" aria-label="Journal as JSON" disabled={busy !== null} onClick={() => void exportJournal("json")}>
          JSON
        </Button>
      </Row>
      <Row label="Back up" hint="Everything but sign-ins">
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void backUp()}>
          {busy === "backup" ? "Backing up…" : "Back up now"}
        </Button>
      </Row>
      {backups.length ? (
        <div role="list" aria-label="Backups" className="flex flex-col border-t border-line-soft py-1">
          {backups.slice(0, 6).map((b) => (
            <div key={b.path} role="listitem" className="flex flex-col gap-2 px-[14px] py-[6px]">
              <div className="flex items-center gap-[10px]">
                <span className="min-w-0 grow truncate text-meta text-text-2" title={b.name}>
                  {when(b.modifiedAt)}
                  {b.name.includes("before restore") ? " · before a restore" : ""}
                </span>
                <span className="shrink-0 font-mono text-meta text-muted">{size(b.bytes)}</span>
                {confirm === b.path ? null : (
                  <Button variant="quiet" size="sm" aria-label={`Restore ${b.name}`} disabled={sealed || busy !== null} onClick={() => setConfirm(b.path)}>
                    {sealed ? "Waits for the seal" : "Restore"}
                  </Button>
                )}
              </div>
              {confirm === b.path ? (
                <div className="flex items-center gap-2 rounded-control border border-line-input bg-raised px-3 py-2">
                  <span className="grow text-meta text-text-2">Everything on this PC becomes this backup. What's here now is backed up first.</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" disabled={busy !== null} onClick={() => void restore(b.path)}>
                    {busy === b.path ? "Restoring…" : "Restore it"}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

/**
 * The danger zone: Start over and Delete account, side by side at the very end of Your Data.
 * Delete account shows only while this PC is signed in.
 */
export function DangerZone({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const load = () => void native.cloudStatus().then(setCloud, () => setCloud(null));
  useEffect(load, []);
  const signedIn = !!cloud?.configured && !!cloud.signedIn && !cloud.connecting;
  return (
    <Section title="Danger Zone" className="border-broken-line">
      <StartOverRows reload={reload} />
      {signedIn ? <DeleteAccount onDone={load} /> : null}
    </Section>
  );
}
