import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { ChevronRightIcon } from "../../components/icons";
import { native } from "../../lib/native";
import { addDays, fromKey, todayKey } from "../../lib/planner";
import { clock } from "../../lib/time";
import type { DayView } from "../../lib/types";
import { appLabel, CATEGORY, duration, OUTCOME } from "./parts";

// Stats › Day (v0.3, decided 2026-10-29): one strip from the day's first activity to its last,
// coloured productive / neutral / distracting, with each focus session as a band above it
// (broken ones outlined). Hover a stretch to see what it was; the day's biggest apps and sites
// are listed below.

const HOUR = 3_600_000;
const longDay = (key: string) => fromKey(key).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

interface Hovered {
  label: string;
  detail: string;
}

export function DayTab({ date, onDate }: { date: string; onDate: (key: string) => void }) {
  const today = todayKey();
  const [v, setV] = useState<DayView | null>(null);
  const [hover, setHover] = useState<Hovered | null>(null);
  useEffect(() => {
    let live = true;
    setV(null);
    void native.statsDay(date).then(
      (d) => live && setV(d),
      () => live && setV(null),
    );
    return () => {
      live = false;
    };
  }, [date]);

  // The strip spans the day's activity and sessions, on whole hours.
  const span = useMemo(() => {
    if (!v) return null;
    const times = [...v.blocks.flatMap((b) => [b.start, b.end]), ...v.sessions.flatMap((s) => [s.start, s.end])];
    if (!times.length) return null;
    const start = Math.floor(Math.min(...times) / HOUR) * HOUR;
    const end = Math.ceil(Math.max(...times) / HOUR) * HOUR;
    return { start, end, len: Math.max(HOUR, end - start) };
  }, [v]);
  const x = (t: number) => `${((t - span!.start) / span!.len) * 100}%`;
  const w = (a: number, b: number) => `${Math.max(0.3, ((b - a) / span!.len) * 100)}%`;
  const hours = span ? Array.from({ length: Math.round(span.len / HOUR) + 1 }, (_, i) => span.start + i * HOUR) : [];
  const step = hours.length > 13 ? 2 : 1;

  return (
    <>
      <div className="flex items-center gap-2">
        <Button variant="quiet" aria-label="Previous day" className="w-control px-0" onClick={() => onDate(addDays(date, -1))}>
          <ChevronRightIcon size={12} className="rotate-180" />
        </Button>
        <span className="min-w-[200px] text-center text-body font-medium">{longDay(date)}</span>
        <Button variant="quiet" aria-label="Next day" className="w-control px-0" disabled={date >= today} onClick={() => onDate(addDays(date, 1))}>
          <ChevronRightIcon size={12} />
        </Button>
        {date !== today ? (
          <Button variant="ghost" size="sm" onClick={() => onDate(today)}>
            Today
          </Button>
        ) : null}
        <span className="grow" />
        {(["productive", "neutral", "distracting"] as const).map((c) => (
          <span key={c} className="flex items-center gap-[6px] text-meta text-muted">
            <span className={`h-[6px] w-[6px] rounded-full ${CATEGORY[c].dot}`} />
            {CATEGORY[c].label}
          </span>
        ))}
      </div>

      <section aria-label="Timeline" className="flex shrink-0 flex-col gap-2 rounded-panel border border-line bg-panel p-[14px]">
        {!v ? <p className="m-0 text-body text-muted">Loading…</p> : null}
        {v && !span ? (
          <p className="m-0 text-body text-muted">{v.hasActivity ? "Nothing recorded this day." : "Activity from this far back has been cleared; sessions show in Sessions."}</p>
        ) : null}
        {v && span ? (
          <>
            {/* Sessions, above the strip. */}
            <div className="relative h-6" aria-label="Focus sessions">
              {v.sessions.map((s) => (
                <span
                  key={s.id}
                  role="img"
                  aria-label={`${s.profileName}, ${clock(s.start)} to ${clock(s.end)}, ${OUTCOME[s.outcome]}`}
                  onPointerEnter={() => setHover({ label: s.profileName, detail: `${clock(s.start)} to ${clock(s.end)} · ${OUTCOME[s.outcome]}` })}
                  onPointerLeave={() => setHover(null)}
                  className={`absolute top-0 flex h-6 items-center overflow-hidden rounded-[4px] px-2 text-[11px] font-medium ${
                    s.outcome === "broken" ? "border border-broken bg-transparent text-broken-text" : "bg-sealed text-sealed-on"
                  }`}
                  style={{ left: x(s.start), width: w(s.start, s.end) }}
                >
                  <span className="truncate">{s.profileName}</span>
                </span>
              ))}
            </div>
            {/* What you were in. */}
            <div className="relative h-7 overflow-hidden rounded-[4px] bg-line-soft" aria-label="Activity">
              {v.blocks.map((b) => (
                <span
                  key={`${b.start}`}
                  role="img"
                  aria-label={`${appLabel(b.label)}, ${clock(b.start)} to ${clock(b.end)}, ${CATEGORY[b.category].label}`}
                  onPointerEnter={() => setHover({ label: appLabel(b.label), detail: `${clock(b.start)} to ${clock(b.end)} · ${CATEGORY[b.category].label}` })}
                  onPointerLeave={() => setHover(null)}
                  className={`absolute top-0 h-full ${CATEGORY[b.category].dot} transition-opacity duration-ui ease-ui hover:opacity-80`}
                  style={{ left: x(b.start), width: w(b.start, b.end) }}
                />
              ))}
            </div>
            <div className="relative h-4 text-[10px] text-faint" aria-hidden="true">
              {hours
                .filter((_, i) => i % step === 0)
                .map((h) => (
                  <span key={h} className="absolute -translate-x-1/2 font-mono" style={{ left: x(h) }}>
                    {new Date(h).toLocaleTimeString("en-US", { hour: "numeric" }).replace(" ", "").toLowerCase()}
                  </span>
                ))}
            </div>
            <p className="m-0 h-5 text-meta" aria-live="polite">
              {hover ? (
                <>
                  <span className="font-medium text-text">{hover.label}</span> <span className="text-muted">{hover.detail}</span>
                </>
              ) : (
                <span className="text-muted">Hover a stretch to see what it was.</span>
              )}
            </p>
          </>
        ) : null}
      </section>

      {v?.top.length ? (
        <section aria-label="Biggest blocks" className="min-h-0 overflow-y-auto rounded-panel border border-line bg-panel">
          <div className="flex h-10 items-center border-b border-line px-[14px]">
            <h2 className="m-0 text-body font-semibold">Where the day went</h2>
          </div>
          {v.top.map((u) => (
            <div key={`${u.kind}:${u.key}`} className="flex h-row items-center gap-3 border-b border-line-soft px-[14px] last:border-b-0">
              <span className={`h-[6px] w-[6px] rounded-full ${CATEGORY[u.category].dot}`} aria-hidden="true" />
              <span className="min-w-0 grow truncate text-body">{u.kind === "exe" ? appLabel(u.key) : u.key}</span>
              <span className="font-mono text-meta text-text-2">{duration(u.seconds)}</span>
              <span className="w-[86px] text-right text-meta text-muted">{CATEGORY[u.category].label}</span>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
