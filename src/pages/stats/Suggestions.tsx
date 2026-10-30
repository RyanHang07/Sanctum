import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { errorText, native } from "../../lib/native";
import { WEEKDAYS_MASK } from "../../lib/planner";
import { useStore } from "../../state/store";
import { usePlanner } from "../../state/planner";
import type { Suggestion } from "../../lib/types";

// Stats › Overview › From your own history (v0.3.1, decided 2026-10-30). Fixed rhythms like
// Pomodoro or 90-minute cycles have little support and people differ, so the suggestions come
// from your sessions: the length you finish, the hours you keep, and when temptation comes.
// Each one only shows when the history clearly says it.

export function Suggestions() {
  const [list, setList] = useState<Suggestion[]>([]);
  const [used, setUsed] = useState<string[]>([]);
  const notice = useStore((s) => s.showNotice);
  useEffect(() => void native.reviewSuggestions().then(setList, () => setList([])), []);
  if (!list.length) return null;

  const use = async (s: Suggestion) => {
    try {
      if (s.kind === "length") {
        if (s.profileId !== null) await native.updateProfile(s.profileId, { defaultMinutes: s.minutes });
        await useStore.getState().loadProfiles();
        useStore.getState().setDuration(s.minutes);
        notice({ lead: `${s.minutes} minutes it is.`, rest: "It's the profile's length now." });
      } else if (s.kind === "hours") {
        const [h1, m1] = s.start.split(":").map(Number);
        const [h2, m2] = s.end.split(":").map(Number);
        const duration = ((h2! * 60 + m2! - (h1! * 60 + m1!)) + 1440) % 1440 || 120;
        await native.saveRoutine({ title: "Focus block", profileId: s.profileId, active: true, daysMask: WEEKDAYS_MASK, time: s.start, durationMin: duration });
        void usePlanner.getState().reload();
        notice({ lead: "Added.", rest: `A weekday focus block at ${s.start}. Home suggests it when it starts.` });
      } else {
        // An if-then plan is yours to write: the field waits on Home.
        useStore.getState().navigate("today");
        setTimeout(() => document.querySelector<HTMLInputElement>(`[aria-label="If I'm tempted, I'll"]`)?.focus(), 50);
      }
      setUsed((u) => [...u, s.line]);
    } catch (e) {
      notice({ lead: errorText(e) });
    }
  };

  const label = (s: Suggestion) => (s.kind === "length" ? `Use ${s.minutes} min` : s.kind === "hours" ? "Add a focus block" : "Write an if-then");
  return (
    <section aria-label="From your own history" className="flex flex-col gap-2 rounded-panel border border-line bg-panel p-[14px]">
      <h2 className="m-0 text-body font-semibold">From your own history</h2>
      {list.map((s) => (
        <div key={s.line} className="flex flex-col gap-1 border-t border-line-soft pt-2 first-of-type:border-t-0 first-of-type:pt-0">
          <span className="text-meta text-text-2">{s.line}</span>
          {used.includes(s.line) ? (
            <span className="text-[11px] text-muted">Done.</span>
          ) : (
            <Button variant="quiet" size="sm" className="-ml-2 self-start" onClick={() => void use(s)}>
              {label(s)}
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
