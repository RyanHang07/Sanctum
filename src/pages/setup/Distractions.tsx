import { useEffect, useRef, useState } from "react";
import { QuietHoursSection } from "./QuietHours";
import { PauseModeSection } from "./PauseMode";
import { BlockRow } from "./BlockRow";
import { Section } from "./parts";
import { DISMISSED_KEY, dismiss, parseDismissals, suggestionChips, type Dismissals, type SuggestionChip } from "./suggestions";
import { Button } from "../../components/Button";
import { Segmented } from "../../components/controls";
import { LockIcon, PlusIcon, XIcon } from "../../components/icons";
import { AppPicker } from "./AppPicker";
import { native } from "../../lib/native";
import { gsap, RISE_FROM, RISE_STAGGER, RISE_TO, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import { distractionLabel, guessDistraction } from "../../lib/rules";
import { minutes } from "../../lib/time";
import type { Distraction, DistractionKind, DistractionSuggestion } from "../../lib/types";
import { useStore } from "../../state/store";

// Setup › Distractions (decided 2026-11-16): two parts in one column. What Sanctum blocks is one
// list, filtered by kind, with one field that works out what you typed and suggestions under it.
// When it blocks is focus sessions (always), quiet hours and pause before opening.

type Filter = "all" | DistractionKind;

const TAG: Record<DistractionKind, string> = { app: "App", site: "Site", keyword: "Keyword" };
const KIND_HINT: Record<DistractionKind, string> = { app: "App", site: "Site or link", keyword: "Keyword" };
const EMPTY: Record<Filter, string> = {
  all: "Nothing on the list yet. Add an app, a site or a keyword above.",
  app: "No apps on the list.",
  site: "No sites or links on the list.",
  keyword: "Keywords block any window or tab whose title contains them, like “shorts”.",
};

const fadeButton =
  "opacity-0 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100";

/** The second line of a row: the exe, the domain, or where a keyword matches. */
function detail(d: Distraction, label: string): string {
  if (d.kind === "keyword") return "in any title";
  return label === d.value ? "" : d.value;
}

function Row({ d, sealed }: { d: Distraction; sealed: boolean }) {
  const { unflag, allowPage, unallowPage } = useStore();
  const [allowing, setAllowing] = useState(false);
  const [draft, setDraft] = useState("");
  const iconButton = `flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted disabled:hidden ${fadeButton}`;
  const label = distractionLabel(d);
  const submit = async () => {
    if (!draft.trim()) return setAllowing(false);
    if (await allowPage(d.id, draft)) {
      setDraft("");
      setAllowing(false);
    }
  };
  return (
    <div data-testid="distraction-row" className="flex flex-col">
      <div className="group flex h-row items-center gap-[10px] px-[14px] transition-colors duration-ui ease-ui hover:bg-raised">
        <span className="w-[64px] shrink-0">
          <span className="rounded-control border border-line px-[6px] py-[1px] text-meta text-muted">{TAG[d.kind]}</span>
        </span>
        <span className="min-w-0 shrink truncate text-body text-text">{label}</span>
        <span className="min-w-0 grow truncate font-mono text-micro text-muted">{detail(d, label)}</span>
        {d.kind === "site" && !sealed ? (
          <button
            type="button"
            aria-label={`Allow a page on ${d.value}`}
            onClick={() => setAllowing(!allowing)}
            className={`h-6 shrink-0 rounded-control px-2 text-meta text-muted ${fadeButton} ${allowing ? "opacity-100" : ""}`}
          >
            Allow a page
          </button>
        ) : null}
        <button type="button" aria-label={`Remove ${label}`} disabled={sealed} onClick={() => void unflag(d.id)} className={iconButton}>
          <XIcon />
        </button>
      </div>
      {d.allow.map((a) => (
        <div key={a.id} className="group flex h-7 items-center gap-2 pl-[88px] pr-[14px] transition-colors duration-ui ease-ui hover:bg-raised">
          <span className="text-meta text-muted">allows</span>
          <span className="min-w-0 grow truncate font-mono text-micro text-text-2">{a.prefix}</span>
          <button type="button" aria-label={`Stop allowing ${a.prefix}`} onClick={() => void unallowPage(a.id)} className={iconButton}>
            <XIcon />
          </button>
        </div>
      ))}
      {allowing ? (
        <div className="flex h-8 items-center gap-2 pl-[88px] pr-[14px]">
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
            className="h-control-sm min-w-0 grow rounded-control border border-line-input bg-transparent px-2 font-mono text-micro text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line focus:border-sealed"
          />
          <span className="font-mono text-micro text-muted">↵</span>
        </div>
      ) : null}
    </div>
  );
}

/** Suggested: one chip per suggestion, time-based first. Each adds in one click or goes away for a while. */
function Suggested({ refreshKey }: { refreshKey: number }) {
  const flag = useStore((s) => s.flag);
  const [list, setList] = useState<DistractionSuggestion[] | null>(null);
  const [dismissed, setDismissed] = useState<Dismissals | null>(null);
  useEffect(() => {
    let live = true;
    void native.distractionSuggestions().then((s) => live && setList(s), () => live && setList([]));
    return () => {
      live = false;
    };
  }, [refreshKey]);
  useEffect(() => {
    let live = true;
    void native.getSetting(DISMISSED_KEY).then(
      (raw) => live && setDismissed(parseDismissals(raw)),
      () => live && setDismissed({}),
    );
    return () => {
      live = false;
    };
  }, []);
  if (!list || !dismissed) return null;
  const chips = suggestionChips(list, dismissed, Date.now());
  if (chips.length === 0) return null;
  const add = (c: SuggestionChip) => {
    for (const i of c.items) void flag(i);
  };
  const drop = (c: SuggestionChip) => {
    const next = dismiss(dismissed, c.key, c.minutes, Date.now());
    setDismissed(next);
    void native.setSetting(DISMISSED_KEY, JSON.stringify(next)).catch(() => undefined);
  };
  return (
    <div role="group" aria-label="Suggested" className="flex flex-col gap-2">
      <span className="text-meta text-muted">Suggested</span>
      <div className="flex flex-wrap gap-[6px]">
        {chips.map((c) => (
          <span
            key={c.key}
            data-testid="suggestion"
            className="flex h-7 items-center rounded-control border border-line-input text-meta text-text-2 transition-colors duration-ui ease-ui hover:border-check-line"
          >
            <button
              type="button"
              aria-label={`Add ${c.label}`}
              onClick={() => add(c)}
              className="flex h-full items-center gap-[6px] rounded-l-control pl-[10px] pr-[6px] transition-colors duration-ui ease-ui hover:bg-raised hover:text-text"
            >
              <PlusIcon size={10} />
              {c.label}
              {c.minutes !== null ? <span className="text-muted">{minutes(c.minutes)} last week</span> : null}
            </button>
            <button
              type="button"
              aria-label={`Dismiss ${c.label}`}
              onClick={() => drop(c)}
              className="flex h-full w-6 items-center justify-center rounded-r-control text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text"
            >
              <XIcon size={9} />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function BlockList() {
  const distractions = useStore((s) => s.distractions);
  const sealed = useStore((s) => s.appState === "sealed");
  const flag = useStore((s) => s.flag);
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const kind = guessDistraction(draft);
  const count = (k: Filter) => (k === "all" ? distractions.length : distractions.filter((d) => d.kind === k).length);
  const shown = filter === "all" ? distractions : distractions.filter((d) => d.kind === filter);

  // Rows rise in, one after the next, when the list first shows and each time the filter changes.
  const list = useRef<HTMLDivElement>(null);
  const { run } = useMotion(list);
  useGSAP(
    () => {
      const rows = list.current ? Array.from(list.current.children) : [];
      if (!rows.length) return;
      run(() => gsap.timeline({ id: "distractions-cascade" }).fromTo(rows, RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }));
    },
    { scope: list, dependencies: [filter] },
  );

  const submit = async () => {
    if (draft.trim() && (await flag({ kind: "auto", value: draft }))) setDraft("");
  };
  const option = (value: Filter, label: string) => ({
    value,
    label: (
      <span className="flex items-center gap-[6px]">
        {label}{" "}
        <span className="font-mono text-micro text-muted">{count(value)}</span>
      </span>
    ),
  });

  return (
    <Section title="What Sanctum blocks" action={<span className="font-mono text-meta text-muted">{distractions.length}</span>}>
      <div className="flex flex-col gap-3 p-[14px]">
        <div className="flex items-center gap-2">
          <label className="flex h-control min-w-0 grow items-center gap-[10px] focus-ring-within rounded-control border border-line-input bg-raised px-3 transition-colors duration-ui ease-ui focus-within:border-sealed hover:border-check-line">
            <PlusIcon className="shrink-0 text-muted" />
            <input
              aria-label="Add an app, site, link or keyword"
              placeholder="Add an app, site, link or keyword"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              className="focus-ring-off h-full min-w-0 grow border-none bg-transparent text-body text-text placeholder:text-muted"
            />
            {kind ? <span className="shrink-0 text-meta text-muted">{KIND_HINT[kind]} ↵</span> : null}
          </label>
          <Button variant="ghost" onClick={() => setPicking(true)}>
            Pick an app
          </Button>
        </div>
        <Suggested refreshKey={distractions.length} />
      </div>
      <div className="flex items-center border-t border-line px-[14px] py-[10px]">
        <Segmented
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[option("all", "All"), option("app", "Apps"), option("site", "Sites"), option("keyword", "Keywords")]}
        />
      </div>
      {shown.length === 0 ? (
        <p className="m-0 px-[14px] pb-[14px] pt-1 text-meta text-muted">{EMPTY[filter]}</p>
      ) : (
        <div ref={list} data-testid="distraction-list" className="flex flex-col pb-1">
          {shown.map((d) => (
            <Row key={d.id} d={d} sealed={sealed} />
          ))}
        </div>
      )}
      {picking ? (
        <AppPicker
          title="Add an app"
          added={new Set(distractions.filter((d) => d.kind === "app").map((d) => d.value))}
          onClose={() => setPicking(false)}
          onPick={(a) => void flag({ kind: "app", value: a.exe, label: a.name, path: a.launch })}
        />
      ) : null}
    </Section>
  );
}

function WhenItBlocks() {
  return (
    <Section title="When it blocks">
      <BlockRow title="During focus sessions" summary="Everything on the list, in every focus session." control={<span className="text-meta text-muted">Always</span>} />
      <QuietHoursSection />
      <PauseModeSection />
    </Section>
  );
}

export function DistractionsTab() {
  const sealed = useStore((s) => s.appState === "sealed");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {sealed ? (
        <p className="m-0 flex items-center gap-2 text-meta text-muted">
          <LockIcon size={11} className="text-sealed" /> You can add while sealed. Removing waits until the seal ends.
        </p>
      ) : null}
      <BlockList />
      <WhenItBlocks />
    </div>
  );
}
