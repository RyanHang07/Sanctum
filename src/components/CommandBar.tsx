import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "./icons";
import { useStore, type SetupTab } from "../state/store";
import { useTrackers } from "../state/trackers";
import { usePlanner } from "../state/planner";
import { TABS } from "../state/appState";
import { native } from "../lib/native";
import { guessDistraction } from "../lib/rules";
import { todayKey } from "../lib/planner";

// Command bar (SPEC 4.0, Ctrl K): jump anywhere, enter focus with any profile, and act on what
// you typed (add it as a task for today, or flag it as a distraction). Arrow keys and Enter.

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => unknown;
}

const SETUP_TABS: { id: SetupTab; label: string }[] = [
  { id: "profiles", label: "Profiles" },
  { id: "distractions", label: "Distractions" },
  { id: "trackers", label: "Trackers and check-ins" },
  { id: "tracking", label: "Activity" },
  { id: "connections", label: "Connections" },
  { id: "general", label: "General" },
];

/** Every command for the current state; `query` adds the ones that act on typed text. */
export function commandsFor(query: string): Command[] {
  const s = useStore.getState();
  const sealed = s.appState === "sealed";
  const out: Command[] = [];
  for (const t of TABS) out.push({ id: `go:${t.id}`, group: "Go to", label: t.label, hint: t.key, run: () => s.navigate(t.id) });
  for (const t of SETUP_TABS) out.push({ id: `setup:${t.id}`, group: "Setup", label: `Setup › ${t.label}`, run: () => s.openSetup(t.id) });
  if (sealed) {
    out.push({ id: "compact", group: "Focus", label: "Compact timer", hint: "Ctrl M", run: () => native.showCompact() });
    out.push({ id: "break", group: "Focus", label: "Break the seal", run: () => s.openEndEarly() });
  } else if (s.appState === "open") {
    for (const p of s.profiles) {
      out.push({
        id: `focus:${p.id}`,
        group: "Focus",
        label: `Enter focus: ${p.name}`,
        hint: `${p.defaultMinutes} min`,
        run: () => {
          s.selectProfile(p.id);
          s.navigate("today");
          return s.enterFocus();
        },
      });
    }
  }
  out.push({ id: "log", group: "Trackers", label: "Log a tracker entry", run: () => useTrackers.getState().openLog() });
  out.push({ id: "sidebar", group: "App", label: s.settings.sidebarCollapsed ? "Expand the sidebar" : "Collapse the sidebar", hint: "Ctrl B", run: () => s.toggleSidebar() });
  if (!sealed) out.push({ id: "onboarding", group: "App", label: "Run setup again", run: () => s.openOnboarding() });

  const text = query.trim();
  const q = text.toLowerCase();
  const matched = q ? out.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)) : out;
  if (text) {
    matched.push({
      id: "add-task",
      group: "Act on it",
      label: `Add “${text}” for today`,
      run: () => usePlanner.getState().saveTodo({ title: text, dueDate: todayKey(), dueTime: null, durationMin: null, profileId: null }),
    });
    const kind = guessDistraction(text);
    if (kind) {
      matched.push({
        id: "flag",
        group: "Act on it",
        label: `Flag “${text}” as a distraction`,
        hint: kind === "app" ? "App" : kind === "site" ? "Site or link" : "Keyword",
        run: () => s.flag({ kind, value: text }),
      });
    }
  }
  return matched;
}

export function CommandBar() {
  const open = useStore((s) => s.commandOpen);
  const close = useStore((s) => s.closeCommand);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  // Recomputed per keystroke; reads the stores directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const commands = useMemo(() => (open ? commandsFor(query) : []), [open, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    void c.run();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(commands.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(commands[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-40 animate-fade-in bg-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
        className="absolute left-1/2 top-[96px] flex max-h-[440px] w-[520px] -translate-x-1/2 animate-rise-in flex-col overflow-hidden rounded-dialog border border-line-input bg-panel shadow-dialog"
      >
        <label className="flex h-12 shrink-0 items-center gap-[10px] border-b border-line px-4 text-muted">
          <SearchIcon size={14} />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={commands[active] ? `command-${commands[active]!.id}` : undefined}
            aria-label="Search or command"
            placeholder="Go to, enter focus, add a task, flag a site…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            className="min-w-0 grow bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
          />
          <span className="font-mono text-[11px] text-faint">Esc</span>
        </label>
        <div ref={list} id="command-list" role="listbox" aria-label="Commands" className="min-h-0 overflow-y-auto py-1">
          {commands.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header ? <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{header}</div> : null}
                <div
                  id={`command-${c.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  className={`mx-1 flex h-9 cursor-pointer items-center gap-3 rounded-control px-3 text-body ${i === active ? "bg-raised text-text" : "text-text-2"}`}
                >
                  <span className="min-w-0 grow truncate">{c.label}</span>
                  {c.hint ? <span className="shrink-0 font-mono text-[11px] text-faint">{c.hint}</span> : null}
                </div>
              </div>
            );
          })}
          {!commands.length ? <p className="m-0 px-4 py-3 text-body text-muted">Nothing matches.</p> : null}
        </div>
      </div>
    </div>
  );
}
