import { useEffect, useState, type ReactNode } from "react";
import { QuietHoursSection } from "./QuietHours";
import { Button } from "../../components/Button";
import { AppIcon } from "../../components/controls";
import { GlobeIcon, LockIcon, PlusIcon, TextIcon, XIcon } from "../../components/icons";
import { AppPicker } from "./AppPicker";
import { native } from "../../lib/native";
import { useInstalledApps } from "../../lib/installedApps";
import { distractionLabel, guessDistraction } from "../../lib/rules";
import { minutes } from "../../lib/time";
import type { Distraction, DistractionKind, DistractionSuggestion } from "../../lib/types";
import { useStore } from "../../state/store";

// Setup > Distractions (decided 2026-09-29): one list every seal blocks. Apps close, sites and
// links are blocked in the browser, keywords block matching windows and tabs. Flagged time
// counts as distracting. Suggestions come from your week and from common distractions.

const GROUPS: { kind: DistractionKind; title: string; empty: string }[] = [
  { kind: "app", title: "Apps", empty: "No apps flagged. Add one, or flag a suggestion." },
  { kind: "site", title: "Sites and links", empty: "No sites flagged. Paste a site or a link above." },
  { kind: "keyword", title: "Keywords", empty: "Keywords block any window or tab whose title contains them, like “shorts”." },
];

const KIND_HINT: Record<DistractionKind, string> = { app: "App", site: "Site or link", keyword: "Keyword" };

function Icon({ d, apps }: { d: Pick<Distraction, "kind" | "value" | "path" | "label">; apps: ReturnType<typeof useInstalledApps> }) {
  if (d.kind === "app") {
    const path = d.path ?? apps?.find((a) => a.exe === d.value)?.launch ?? null;
    return <AppIcon path={path} label={distractionLabel(d)} size={16} />;
  }
  const I = d.kind === "site" ? GlobeIcon : TextIcon;
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">
      <I size={14} />
    </span>
  );
}

function Row({ d, sealed, apps }: { d: Distraction; sealed: boolean; apps: ReturnType<typeof useInstalledApps> }) {
  const { unflag, allowPage, unallowPage } = useStore();
  const [allowing, setAllowing] = useState(false);
  const [draft, setDraft] = useState("");
  const iconButton =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted opacity-0 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100 disabled:hidden";
  const label = distractionLabel(d);
  const submit = async () => {
    if (!draft.trim()) return setAllowing(false);
    if (await allowPage(d.id, draft)) {
      setDraft("");
      setAllowing(false);
    }
  };
  return (
    <div className="flex flex-col">
      <div className="group flex h-row items-center gap-[10px] px-[14px] transition-colors duration-ui ease-ui hover:bg-line-soft">
        <Icon d={d} apps={apps} />
        <span className="min-w-0 truncate text-body text-text">{label}</span>
        <span className="min-w-0 grow truncate font-mono text-[11px] text-faint">{label === d.value ? "" : d.value}</span>
        {d.kind === "site" && !sealed ? (
          <button
            type="button"
            aria-label={`Allow a page on ${d.value}`}
            onClick={() => setAllowing(!allowing)}
            className={`h-6 shrink-0 rounded-control px-2 text-meta text-muted opacity-0 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100 ${allowing ? "opacity-100" : ""}`}
          >
            Allow a page
          </button>
        ) : null}
        <button type="button" aria-label={`Unflag ${label}`} disabled={sealed} onClick={() => void unflag(d.id)} className={iconButton}>
          <XIcon />
        </button>
      </div>
      {d.allow.map((a) => (
        <div key={a.id} className="group flex h-7 items-center gap-2 pl-[40px] pr-[14px] transition-colors duration-ui ease-ui hover:bg-line-soft">
          <span className="text-meta text-faint">allows</span>
          <span className="min-w-0 grow truncate font-mono text-[11px] text-text-2">{a.prefix}</span>
          <button type="button" aria-label={`Stop allowing ${a.prefix}`} onClick={() => void unallowPage(a.id)} className={iconButton}>
            <XIcon />
          </button>
        </div>
      ))}
      {allowing ? (
        <div className="flex h-8 items-center gap-2 pl-[40px] pr-[14px]">
          <input
            autoFocus
            aria-label={`Page on ${d.value} to allow`}
            placeholder={`${d.value.split("/")[0]}/@channel stays open`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") setAllowing(false);
            }}
            className="h-[26px] min-w-0 grow rounded-control border border-line-input bg-transparent px-2 font-mono text-[11px] text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
          />
          <span className="font-mono text-[11px] text-faint">↵</span>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-panel border border-line bg-panel">
      <div className="flex h-10 items-center justify-between border-b border-line px-[14px]">
        <h2 className="m-0 text-body font-semibold">{title}</h2>
        {meta}
      </div>
      {children}
    </section>
  );
}

function Suggestions({ refreshKey }: { refreshKey: number }) {
  const flag = useStore((s) => s.flag);
  const [list, setList] = useState<DistractionSuggestion[] | null>(null);
  useEffect(() => {
    let live = true;
    void native.distractionSuggestions().then((s) => live && setList(s), () => live && setList([]));
    return () => {
      live = false;
    };
  }, [refreshKey]);
  if (!list) return null;
  const used = list.filter((s) => s.minutes !== null);
  // Common distractions, one chip per name (YouTube covers its site and app).
  const common = [...new Map(list.filter((s) => s.minutes === null).map((s) => [s.label, s])).values()];
  const flagAll = (label: string) => {
    for (const s of list.filter((x) => x.minutes === null && x.label === label)) void flag({ kind: s.kind, value: s.value, label: s.label });
  };
  return (
    <>
      <Panel title="From your week">
        {used.length === 0 ? (
          <p className="m-0 px-[14px] py-3 text-meta text-muted">Apps and sites you spend time on show up here after a few days of tracking.</p>
        ) : (
          <div className="flex flex-col py-1">
            {used.map((s) => (
              <div key={`${s.kind}:${s.value}`} className="flex h-row items-center gap-[10px] px-[14px]">
                <Icon d={{ ...s, path: null }} apps={null} />
                <span className="min-w-0 grow truncate text-body text-text">{s.label}</span>
                <span className="font-mono text-[11px] text-faint">{minutes(s.minutes ?? 0)}</span>
                <Button variant="ghost" size="sm" aria-label={`Flag ${s.label}`} onClick={() => void flag({ kind: s.kind, value: s.value, label: s.label })}>
                  Flag
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>
      {common.length ? (
        <Panel title="Common distractions">
          <div className="flex flex-wrap gap-[6px] p-[14px]">
            {common.map((s) => (
              <button
                key={s.label}
                type="button"
                aria-label={`Flag ${s.label}`}
                onClick={() => flagAll(s.label)}
                className="flex h-7 items-center gap-[6px] rounded-control border border-line-input px-[10px] text-meta text-text-2 transition-colors duration-ui ease-ui hover:border-check-line hover:bg-raised hover:text-text"
              >
                <PlusIcon size={10} />
                {s.label}
              </button>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

export function DistractionsTab() {
  const distractions = useStore((s) => s.distractions);
  const sealed = useStore((s) => s.appState === "sealed");
  const flag = useStore((s) => s.flag);
  const apps = useInstalledApps();
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const kind = guessDistraction(draft);

  const submit = async () => {
    if (draft.trim() && (await flag({ kind: "auto", value: draft }))) setDraft("");
  };

  return (
    <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_300px] items-start gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        {sealed ? (
          <p className="m-0 flex items-center gap-2 text-meta text-muted">
            <LockIcon size={11} className="text-sealed" /> You can add while sealed. Removing waits until the seal ends.
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <label className="flex h-9 min-w-0 grow items-center gap-[10px] rounded-control border border-line-input bg-raised px-3 transition-colors duration-ui ease-ui focus-within:border-sealed hover:border-check-line">
            <PlusIcon className="shrink-0 text-faint" />
            <input
              aria-label="Flag a site, link, or keyword"
              placeholder="Paste a site or link, or type a keyword"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              className="h-full min-w-0 grow border-none bg-transparent text-body text-text outline-none placeholder:text-faint"
            />
            {kind ? <span className="shrink-0 text-meta text-muted">{KIND_HINT[kind]} ↵</span> : null}
          </label>
          <Button variant="ghost" onClick={() => setPicking(true)}>
            Add an app
          </Button>
        </div>
        {GROUPS.map((g) => {
          const items = distractions.filter((d) => d.kind === g.kind);
          return (
            <Panel key={g.kind} title={g.title} meta={<span className="font-mono text-meta text-muted">{items.length}</span>}>
              {items.length === 0 ? (
                <p className="m-0 px-[14px] py-3 text-meta text-faint">{g.empty}</p>
              ) : (
                <div className="flex flex-col py-1">
                  {items.map((d) => (
                    <Row key={d.id} d={d} sealed={sealed} apps={apps} />
                  ))}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
      <div className="flex flex-col gap-4">
        <QuietHoursSection />
        <Suggestions refreshKey={distractions.length} />
      </div>
      {picking ? (
        <AppPicker
          title="Flag an app"
          added={new Set(distractions.filter((d) => d.kind === "app").map((d) => d.value))}
          onClose={() => setPicking(false)}
          onPick={(a) => void flag({ kind: "app", value: a.exe, label: a.name, path: a.launch })}
        />
      ) : null}
    </div>
  );
}
