import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ChevronRightIcon, SearchIcon } from "../../components/icons";
import { errorText, native } from "../../lib/native";
import { addDays, fromKey, toKey, weekStart } from "../../lib/planner";
import { firstWords } from "../../lib/journalPrompts";
import { DUR, EASE, gsap, RISE_FROM, RISE_STAGGER, RISE_TO, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import type { DayStat, JournalHit } from "../../lib/types";
import { DayDot, dayMarkLabel } from "../week/marks";

// Looking back in the journal (v0.5). Under the day card, a quiet line for the page written a
// month and a year before the day, when there is one. From the header, "Older pages": a month
// calendar to reach any day (which days have a page, and each day's kept or missed mark), and a
// search across every page. Both lists cascade in with the rise-in Pending's rows use; the panel
// opens the way Pending does, to its height first, then its contents.

const long = (key: string) => fromKey(key).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** The same day `months` months before, or null when that month is too short to have it. */
export function monthsBack(date: string, months: number): string | null {
  const d = fromKey(date);
  const day = d.getDate();
  const back = new Date(d.getFullYear(), d.getMonth() - months, day);
  return back.getDate() === day ? toKey(back) : null;
}

/** Cascades a list's rows in whenever `key` changes (and there are rows). */
function useCascade(list: RefObject<HTMLElement | null>, id: string, key: string) {
  const { run } = useMotion(list);
  useGSAP(
    () => {
      const el = list.current;
      if (!el || !el.children.length) return;
      run(() => gsap.timeline({ id }).fromTo(Array.from(el.children), RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }));
    },
    { scope: list, dependencies: [key] },
  );
}

interface Back {
  label: string;
  date: string;
  words: string;
}

/** "A month ago: …" and "A year ago: …" under the day card, for pages that exist. */
export function OnThisDay({ date, onOpen }: { date: string; onOpen: (d: string) => void }) {
  const [lines, setLines] = useState<Back[]>([]);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    const back: [string, string | null][] = [
      ["A month ago", monthsBack(date, 1)],
      ["A year ago", monthsBack(date, 12)],
    ];
    const wanted = back.filter((w): w is [string, string] => !!w[1]);
    void Promise.all(
      wanted.map(async ([label, d]): Promise<Back | null> => {
        const written = await native.journalWritten(d, d);
        if (!written.includes(d)) return null;
        const page = await native.journalGet(d);
        const words = page ? firstWords(page.body) : "";
        return words ? { label, date: d, words } : null;
      }),
    )
      .then((found) => live && setLines(found.filter((x): x is Back => !!x)))
      .catch(() => live && setLines([]));
    return () => {
      live = false;
    };
  }, [date]);
  useCascade(list, "journal-on-this-day", lines.map((l) => l.date).join());
  if (!lines.length) return null;
  return (
    <div ref={list} aria-label="On this day" className="-mt-2 flex shrink-0 flex-col gap-[2px] px-1">
      {lines.map((l) => (
        <button
          key={l.date}
          type="button"
          onClick={() => onOpen(l.date)}
          title={long(l.date)}
          className="min-w-0 truncate rounded-control text-left text-meta text-muted transition-colors duration-ui ease-ui hover:text-text-2"
        >
          <span className="text-text-2">{l.label}:</span> {l.words}
        </button>
      ))}
    </div>
  );
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** A month of days: which have a page, each day's mark. Days after today can't be opened. */
function Month({ date, today, onOpen }: { date: string; today: string; onOpen: (d: string) => void }) {
  const [month, setMonth] = useState(() => `${date.slice(0, 7)}-01`);
  const [written, setWritten] = useState<string[]>([]);
  const [stats, setStats] = useState<DayStat[]>([]);
  const first = month;
  const last = addDays(toKey(new Date(fromKey(first).getFullYear(), fromKey(first).getMonth() + 1, 1)), -1);
  const cells = useMemo(() => {
    const out: string[] = [];
    for (let d = weekStart(first); d <= last || out.length % 7; d = addDays(d, 1)) out.push(d);
    return out;
  }, [first, last]);
  useEffect(() => {
    let live = true;
    void native
      .journalWritten(first, last)
      .then((w) => live && setWritten(w))
      .catch(() => live && setWritten([]));
    void native
      .statsOverview(first, last)
      .then((o) => live && setStats(o.days))
      .catch(() => live && setStats([]));
    return () => {
      live = false;
    };
  }, [first, last]);
  const shift = (n: number) => setMonth(toKey(new Date(fromKey(first).getFullYear(), fromKey(first).getMonth() + n, 1)));
  const title = fromKey(first).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return (
    <>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="flex h-7 w-7 items-center justify-center rounded-control text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text-2">
          <ChevronRightIcon size={10} className="rotate-180" />
        </button>
        <span aria-live="polite" className="grow text-center text-meta font-medium text-text-2">
          {title}
        </span>
        <button
          type="button"
          aria-label="Next month"
          disabled={last >= today}
          onClick={() => shift(1)}
          className="flex h-7 w-7 items-center justify-center rounded-control text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text-2 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <ChevronRightIcon size={10} />
        </button>
      </div>
      <div role="grid" aria-label={title} className="grid grid-cols-7 gap-[2px]">
        {WEEKDAYS.map((w, i) => (
          <span key={i} aria-hidden="true" className="pb-1 text-center text-micro text-muted">
            {w}
          </span>
        ))}
        {cells.map((d) => {
          if (d < first || d > last) return <span key={d} aria-hidden="true" />;
          const stat = stats.find((s) => s.date === d);
          const wrote = written.includes(d);
          const on = d === date;
          const said = [dayMarkLabel(stat)?.toLowerCase(), wrote ? "page written" : null].filter(Boolean).join(", ");
          return (
            <button
              key={d}
              type="button"
              data-day={d}
              aria-label={said ? `${long(d)}: ${said}` : long(d)}
              aria-current={on ? "date" : undefined}
              disabled={d > today}
              onClick={() => onOpen(d)}
              className={`flex h-9 flex-col items-center justify-center gap-[2px] rounded-control transition-colors duration-ui ease-ui disabled:opacity-40 ${on ? "bg-sealed-tint" : "hover:bg-raised disabled:hover:bg-transparent"}`}
            >
              <span className={`font-mono text-meta ${on ? "text-sealed-text" : d === today ? "text-text" : "text-text-2"}`}>{fromKey(d).getDate()}</span>
              <span aria-hidden="true" className="flex h-[7px] items-center gap-[3px]">
                <DayDot day={stat} />
                {wrote ? <span data-testid="written-dot" className="h-1 w-1 rounded-full bg-muted" /> : null}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

const SEARCH_MS = 200;

/** Search results: the date, then the snippet. */
function Results({ query, onOpen }: { query: string; onOpen: (d: string) => void }) {
  const [hits, setHits] = useState<JournalHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      native.journalSearch(query).then(
        (h) => {
          if (!live) return;
          setHits(h);
          setError(null);
        },
        (e) => {
          if (!live) return;
          setHits([]);
          setError(errorText(e));
        },
      );
    }, SEARCH_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);
  useCascade(list, "journal-search", hits ? `${query}:${hits.map((h) => h.date).join()}` : "");
  if (error) return <p className="m-0 px-1 text-meta text-muted">{error}</p>;
  if (!hits) return <p className="m-0 px-1 text-meta text-muted">Searching…</p>;
  if (!hits.length) return <p className="m-0 px-1 text-meta text-muted">No pages match.</p>;
  return (
    <div ref={list} role="list" aria-label="Pages found" className="flex max-h-[300px] flex-col gap-[2px] overflow-y-auto">
      {hits.map((h) => (
        <button
          key={h.date}
          type="button"
          role="listitem"
          onClick={() => onOpen(h.date)}
          className="flex flex-col gap-[2px] rounded-control px-2 py-[6px] text-left transition-colors duration-ui ease-ui hover:bg-raised"
        >
          <span className="text-meta font-medium text-text-2">{long(h.date)}</span>
          <span className="line-clamp-2 text-meta text-muted">{h.snippet}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * "Older pages": opens under its header button. Escape or a click outside closes it; opening a
 * day closes it too. Grows to its height, then the search field, the month and its grid rise in.
 */
export function OlderPages({ date, today, onOpen, onClose, toggle }: { date: string; today: string; onOpen: (d: string) => void; onClose: () => void; toggle: RefObject<HTMLElement | null> }) {
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const { run } = useMotion(panel);
  useGSAP(
    () => {
      const el = panel.current;
      if (!el || !inner.current) return;
      run(() =>
        gsap
          .timeline({ id: "journal-older-pages" })
          .fromTo(el, { height: 0 }, { height: "auto", duration: DUR.state, ease: EASE.glide, clearProps: "height" })
          .fromTo(Array.from(inner.current!.children), RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }, "-=0.06"),
      );
    },
    { scope: panel },
  );
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
      toggle.current?.querySelector<HTMLElement>("button")?.focus();
    };
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !toggle.current?.contains(t)) onClose();
    };
    window.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
    };
  }, [onClose, toggle]);
  const q = query.trim();
  return (
    <div ref={panel} role="dialog" aria-label="Older pages" className="absolute right-0 top-[calc(100%+6px)] z-30 w-[300px] overflow-hidden rounded-panel border border-line-input bg-panel shadow-toast">
      <div ref={inner} className="flex flex-col gap-2 p-2">
        <label className="focus-ring-within flex h-control items-center gap-2 rounded-control border border-line-input bg-raised px-2 text-muted">
          <SearchIcon size={12} className="shrink-0" />
          <input
            aria-label="Search pages"
            placeholder="Search pages"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="focus-ring-off min-w-0 grow bg-transparent text-body text-text placeholder:text-muted"
          />
        </label>
        {q ? <Results query={q} onOpen={onOpen} /> : <Month date={date} today={today} onOpen={onOpen} />}
      </div>
    </div>
  );
}
