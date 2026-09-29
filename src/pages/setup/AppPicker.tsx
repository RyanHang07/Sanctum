import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { AppIcon, Dialog } from "../../components/controls";
import { CheckIcon, SearchIcon } from "../../components/icons";
import { loadInstalledApps, useInstalledApps } from "../../lib/installedApps";
import type { InstalledApp } from "../../lib/types";

function AppRow({ app, added, onPick }: { app: InstalledApp; added: boolean; onPick: (a: InstalledApp) => void }) {
  return (
    <button
      role="option"
      aria-selected={added}
      disabled={added}
      onClick={() => onPick(app)}
      className="flex h-9 shrink-0 items-center gap-[10px] rounded-control px-[10px] text-left transition-colors duration-ui ease-ui enabled:hover:bg-raised disabled:cursor-default"
    >
      <AppIcon path={app.launch} label={app.name} size={20} />
      <span className={`min-w-0 grow truncate text-body ${added ? "text-muted" : "text-text"}`}>{app.name}</span>
      {added ? (
        <span className="flex items-center gap-1 text-meta text-sealed-text">
          <CheckIcon size={10} /> Added
        </span>
      ) : (
        <span className="font-mono text-[11px] text-faint">{app.exe}</span>
      )}
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col">
      <span className="px-[10px] pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{label}</span>
      {children}
    </div>
  );
}

/**
 * Apps from the Start menu plus whatever has a window open right now (its real exe, which is
 * what sealing matches). Rescans on open so "Running now" is current. Stays open for multiple picks.
 */
export function AppPicker({
  title,
  added,
  onPick,
  onClose,
}: {
  title: string;
  /** Exe names already in the list. */
  added: ReadonlySet<string>;
  onPick: (app: InstalledApp) => void;
  onClose: () => void;
}) {
  const apps = useInstalledApps();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const rescan = async () => {
    setRefreshing(true);
    await loadInstalledApps(true);
    setRefreshing(false);
  };

  // Show the cached list right away and refresh behind it.
  useEffect(() => void rescan(), []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (apps ?? []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.exe.includes(q)),
    [apps, q],
  );
  const running = shown.filter((a) => a.running);
  const rest = shown.filter((a) => !a.running);
  const row = (a: InstalledApp) => <AppRow key={a.exe} app={a} added={added.has(a.exe)} onPick={onPick} />;

  return (
    <Dialog label={title} onClose={onClose} width={460} top={96}>
      <div className="flex flex-col gap-3 px-[18px] pb-3 pt-[18px]">
        <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{title}</h1>
        <label className="relative flex items-center">
          <SearchIcon className="pointer-events-none absolute left-[10px] text-muted" />
          <input
            autoFocus
            aria-label="Search apps"
            placeholder="Search apps"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              const first = [...running, ...rest][0];
              if (e.key === "Enter" && first && !added.has(first.exe)) onPick(first);
            }}
            className="h-control w-full rounded-control border border-line-input bg-raised pl-8 pr-3 text-body text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
          />
        </label>
      </div>
      <div className="flex h-[320px] flex-col overflow-y-auto px-2 pb-2" role="listbox" aria-label="Apps">
        {apps === null ? (
          <p className="m-0 px-[10px] py-3 text-meta text-muted">Scanning apps.</p>
        ) : shown.length === 0 ? (
          <p className="m-0 px-[10px] py-3 text-meta text-muted">
            {q ? `No app matches “${query.trim()}”.` : "No apps found."}
          </p>
        ) : (
          <>
            {running.length ? <Group label="Running now">{running.map(row)}</Group> : null}
            {rest.length ? <Group label={running.length ? "All apps" : "Apps"}>{rest.map(row)}</Group> : null}
          </>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
        <Button variant="ghost" size="sm" onClick={() => void rescan()} disabled={refreshing}>
          {refreshing ? "Scanning" : "Rescan"}
        </Button>
        <span className="text-meta text-faint">{apps ? `${apps.length} apps` : ""}</span>
        <Button variant="primary" className="ml-auto" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}
