import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "./icons";
import { useStore, type SetupTab } from "../state/store";
import { useTrackers } from "../state/trackers";
import { usePlanner } from "../state/planner";
import { noteTitle, useNotes } from "../state/notes";
import { TABS } from "../state/appState";
import { errorText, native } from "../lib/native";
import { guessDistraction } from "../lib/rules";
import { todayKey } from "../lib/planner";
import { useTheme } from "../state/theme";
import { THEMES } from "../theme/themes";

// Command bar (SPEC 4.0, Ctrl K): jump anywhere, enter focus with any profile, and act on what
// you typed (add it as a task for today, or flag it as a distraction). Arrow keys and Enter.

export interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  run: () => unknown;
}

// The same names as Setup's list, so a section is called one thing everywhere.
const SETUP_TABS: { id: SetupTab; label: string }[] = [
  { id: "profiles", label: "Profiles" },
  { id: "distractions", label: "Distractions" },
  { id: "goals", label: "Goals" },
  { id: "protection", label: "App Guard" },
  { id: "browser", label: "Browser Extension" },
  { id: "partner", label: "Partner" },
  { id: "trackers", label: "Trackers" },
  { id: "tracking", label: "Activity" },
  { id: "calendar", label: "Calendar" },
  { id: "appearance", label: "Appearance" },
  { id: "sounds", label: "Sound and Alerts" },
  { id: "behaviour", label: "Behavior" },
  { id: "data", label: "Your Data" },
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
    // v0.3.1: the park box on Today (Ctrl Alt P does it from any app).
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
  if (!sealed && s.quiet?.on) out.push({ id: "quiet-pause", group: "Focus", label: "Pause quiet hours 15 min", run: () => s.openQuietPause() });
  if (!sealed && s.quiet?.pausedUntil) {
    out.push({ id: "quiet-resume", group: "Focus", label: "Resume quiet hours", run: async () => s.applyQuiet(await native.quietResume()) });
  }
  out.push({ id: "log", group: "Trackers", label: "Log a tracker entry", run: () => useTrackers.getState().openLog() });
  out.push({
    id: "new-note",
    group: "Notes",
    label: "New note",
    run: async () => {
      s.navigate("notes");
      await useNotes.getState().create();
    },
  });
  out.push({ id: "sidebar", group: "App", label: s.settings.sidebarCollapsed ? "Expand the sidebar" : "Collapse the sidebar", hint: "Ctrl B", run: () => s.toggleSidebar() });
  if (!sealed) out.push({ id: "onboarding", group: "App", label: "Run setup again", run: () => s.openOnboarding() });
  // Your Data (v0.1): the same as Setup › Your Data, one keystroke away.
  const saved = (lead: string) => (f: { name: string }) => s.showNotice({ lead, rest: f.name });
  const failed = (e: unknown) => s.showNotice({ lead: errorText(e) });
  out.push({ id: "backup", group: "App", label: "Back up now", run: () => native.backupCreate().then(saved("Backed up."), failed) });
  out.push({ id: "export-json", group: "App", label: "Export data as JSON", run: () => native.exportData("json").then(saved("Exported."), failed) });
  out.push({ id: "export-csv", group: "App", label: "Export data as CSV", run: () => native.exportData("csv").then(saved("Exported."), failed) });

  // Themes (v0.3): light or dark in one keystroke; each theme by name once you type.
  const th = useTheme.getState();
  const other = th.theme.scheme === "dark" ? "light" : "dark";
  out.push({
    id: "theme-flip",
    group: "Appearance",
    label: `Switch to ${other}`,
    run: () => th.setPrefs({ ...th.prefs, follow: false, fixed: other === "light" ? th.prefs.light : th.prefs.dark }),
  });
  if (!th.prefs.follow) out.push({ id: "theme-follow", group: "Appearance", label: "Follow Windows' light and dark", run: () => th.setFollow(true) });

  const text = query.trim();
  const q = text.toLowerCase();
  if (q)
    // Following Windows, only themes for the mode it's in now, as Setup › Appearance lists them
    // (2026-11-17): a theme for the other mode would change nothing you could see.
    for (const t of THEMES.filter((t) => !th.prefs.follow || t.scheme === th.theme.scheme))
      out.push({ id: `theme:${t.id}`, group: "Appearance", label: `Theme: ${t.name}`, hint: t.id === th.theme.id ? "Now" : undefined, run: () => th.pick(t.id) });
  const matched = q ? out.filter((c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)) : out;
  // Notes whose title or text match, when you've typed something.
  if (q) {
    for (const n of useNotes.getState().notes.filter((n) => `${n.title}
${n.body}`.toLowerCase().includes(q)).slice(0, 5)) {
      matched.push({
        id: `note:${n.id}`,
        group: "Notes",
        label: `Open note: ${noteTitle(n)}`,
        run: () => {
          useNotes.getState().open(n.id);
          s.navigate("notes");
        },
      });
    }
  }
  if (text) {
    matched.push({
      id: "add-task",
      group: "Act on it",
      label: `Add “${text}” for today`,
      run: () => usePlanner.getState().saveTodo({ title: text, dueDate: todayKey(new Date(), useStore.getState().settings.dailyResetTime), dueTime: null, durationMin: null, profileId: null }),
    });
    matched.push({
      id: "save-note",
      group: "Act on it",
      label: `Save “${text}” as a note`,
      run: async () => {
        await useNotes.getState().create(text);
        s.navigate("notes");
      },
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
    // A command that fails says why; the bar is already closed.
    void Promise.resolve()
      .then(() => c.run())
      .catch((e: unknown) => useStore.getState().showNotice({ lead: errorText(e) }));
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

  // Consecutive commands of one group sit under its header, as a labeled group in the list.
  const groups: { name: string; items: { c: Command; i: number }[] }[] = [];
  commands.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (last && last.name === c.group) last.items.push({ c, i });
    else groups.push({ name: c.group, items: [{ c, i }] });
  });
  return (
    <div className="fixed inset-0 z-40 animate-fade-in bg-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command bar"
        className="absolute left-1/2 top-[96px] flex max-h-[440px] w-[520px] -translate-x-1/2 animate-rise-in flex-col overflow-hidden rounded-dialog border border-line-input bg-panel shadow-dialog"
      >
        {/* The search row shows keyboard focus as an accent underline; the field itself opts out of the ring. */}
        <label className="flex h-12 shrink-0 items-center gap-[10px] border-b border-line px-4 text-muted transition-colors duration-ui ease-ui has-[:focus-visible]:border-sealed">
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
            className="focus-ring-off min-w-0 grow bg-transparent text-[14px] text-text placeholder:text-muted"
          />
          <span className="font-mono text-micro text-muted">Esc</span>
        </label>
        <div ref={list} id="command-list" role="listbox" aria-label="Commands" className="min-h-0 overflow-y-auto py-1">
          {groups.map((g, gi) => (
            <div key={`${g.name}-${gi}`} role="group" aria-labelledby={`command-group-${gi}`}>
              <div id={`command-group-${gi}`} role="presentation" className="label px-4 pb-1 pt-2">
                {g.name}
              </div>
              {g.items.map(({ c, i }) => (
                <div
                  key={c.id}
                  id={`command-${c.id}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onClick={() => run(c)}
                  className={`mx-1 flex h-9 cursor-pointer items-center gap-3 rounded-control px-3 text-body ${i === active ? "bg-raised text-text" : "text-text-2"}`}
                >
                  <span className="min-w-0 grow truncate">{c.label}</span>
                  {c.hint ? <span className="shrink-0 font-mono text-micro text-muted">{c.hint}</span> : null}
                </div>
              ))}
            </div>
          ))}
          {!commands.length ? <p className="m-0 px-4 py-3 text-body text-muted">Nothing matches.</p> : null}
        </div>
        {/* How many commands match, said to screen readers as you type. */}
        <p data-testid="command-count" aria-live="polite" aria-atomic="true" className="sr-only">
          {`${commands.length} ${commands.length === 1 ? "result" : "results"}`}
        </p>
      </div>
    </div>
  );
}
