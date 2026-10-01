import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { Row, Section } from "./parts";
import { errorText, native } from "../../lib/native";
import { useStore } from "../../state/store";
import type { FileInfo } from "../../lib/types";

// Setup › General › Your data (v0.1): export what you've logged to read elsewhere, back up the
// whole database, and restore a backup. Everything lands in Documents\Sanctum.

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
      title="Your data"
      action={
        <Button variant="quiet" size="sm" onClick={() => void native.dataReveal("").catch(() => undefined)}>
          Open folder
        </Button>
      }
    >
      <Row label="Export" hint={last ? `Saved ${last.name}` : "Sessions, tasks, trackers, notes, and activity, to Documents\\Sanctum\\Exports"}>
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
      <Row label="Back up" hint="The whole database, restorable here. Sign-ins aren't included.">
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
                <span className="shrink-0 font-mono text-[11px] text-faint">{size(b.bytes)}</span>
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
