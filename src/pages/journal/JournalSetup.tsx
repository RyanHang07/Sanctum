import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/controls";
import { useJournal } from "../../state/journal";
import { PRESETS, THEMES, type JournalSetup as Setup } from "../../lib/journalPrompts";
import type { JournalLock } from "../../lib/types";

// The journal's own setup (v0.2), separate from the app's first-run setup. The first time, it
// IS the Journal page (no dialog over a placeholder); leaving before the end starts it over next
// time, and finishing opens today's page. Later, "Journal settings" opens the same steps in a
// dialog to change prompts or the lock.

type Step = "welcome" | "prompts" | "lock";
const PER_DAY = [
  { value: 0, label: "All of them" },
  { value: 1, label: "1 a day" },
  { value: 2, label: "2 a day" },
  { value: 3, label: "3 a day" },
  { value: 4, label: "4 a day" },
];

export function JournalSetup({ onClose, first }: { onClose: () => void; first: boolean }) {
  const { setup, lock, saveSetup, setLock } = useJournal();
  const [step, setStep] = useState<Step>(first ? "welcome" : "prompts");
  const [picked, setPicked] = useState<string[]>(setup.prompts);
  const [perDay, setPerDay] = useState(setup.perDay);
  const [theme, setTheme] = useState(THEMES[0]!.id);
  const [kind, setKind] = useState<JournalLock["lock"]>(lock?.lock ?? "none");
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const preset = (ids: string[]) => setPicked((p) => (ids.every((id) => p.includes(id)) ? p.filter((x) => !ids.includes(x)) : [...p, ...ids.filter((id) => !p.includes(id))]));
  const pinOk = kind !== "pin" || (/^\d{4,8}$/.test(pin) && pin === again) || (lock?.lock === "pin" && !pin && !again);
  const shown = THEMES.find((t) => t.id === theme)!;

  const finish = async () => {
    setBusy(true);
    try {
      // Only set the lock when it changes (or a new PIN was typed).
      if (kind !== (lock?.lock ?? "none") || (kind === "pin" && pin)) {
        if (!(await setLock(kind, kind === "pin" ? pin : undefined))) return;
      }
      const next: Setup = { done: true, prompts: picked, perDay };
      await saveSetup(next);
      // First time: the page takes over with today; later: the dialog closes.
      if (!first) onClose();
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      {/* Scrolls on a short window so the buttons below always show. */}
      <div className={`flex flex-col gap-4 overflow-y-auto px-6 pb-5 pt-6 ${first ? "min-h-0" : "max-h-[calc(100vh-170px)]"}`}>
        {step === "welcome" ? (
          <>
            <h1 className="headline m-0 text-[24px]">
              A page a day. <em>Yours alone.</em>
            </h1>
            <p className="m-0 text-body leading-relaxed text-text-2">
              One page for each day, with what the day held at the top: focus, tasks, counters, and how you felt. It stays on this PC, is never shared or synced, and you can write in it while sealed.
            </p>
            <p className="m-0 text-meta text-muted">Two quick choices: what it asks you, and whether it locks. Both change any time from Journal settings.</p>
          </>
        ) : null}

        {step === "prompts" ? (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-[16px] font-semibold">What should a page ask?</h2>
              <span className="text-meta text-muted">Pick any number. Each day draws from your picks, so it doesn't read the same every day. Or pick none for a blank page.</span>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
              {PRESETS.map((x) => {
                const on = x.prompts.every((id) => picked.includes(id));
                return (
                  <button
                    key={x.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => preset(x.prompts)}
                    className={`rounded-control border px-3 py-[6px] text-left text-meta transition-colors duration-ui ease-ui ${on ? "border-sealed bg-sealed-tint text-text" : "border-line-input text-text-2 hover:bg-line-soft"}`}
                  >
                    <span className="block font-medium">{x.label}</span>
                    <span className="block text-[11px] text-muted">{x.blurb}</span>
                  </button>
                );
              })}
            </div>
            <div role="tablist" aria-label="Themes" className="flex flex-wrap gap-1 border-b border-line">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={t.id === theme}
                  onClick={() => setTheme(t.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-meta transition-colors duration-ui ease-ui ${t.id === theme ? "border-sealed text-text" : "border-transparent text-muted hover:text-text-2"}`}
                >
                  {t.label}
                  {t.prompts.some((x) => picked.includes(x.id)) ? <span className="ml-[6px] font-mono text-[10px] text-sealed-text">{t.prompts.filter((x) => picked.includes(x.id)).length}</span> : null}
                </button>
              ))}
            </div>
            <div role="tabpanel" aria-label={shown.label} className="flex flex-col gap-1">
              <span className="text-meta text-muted">{shown.blurb}</span>
              {shown.prompts.map((x) => (
                <label key={x.id} className="flex cursor-pointer items-start gap-[10px] rounded-control px-2 py-[6px] hover:bg-line-soft">
                  <input type="checkbox" checked={picked.includes(x.id)} onChange={() => toggle(x.id)} className="mt-[3px] accent-sealed" />
                  <span className="text-body text-text">{x.text}</span>
                </label>
              ))}
            </div>
            <label className="flex items-center justify-between gap-3 text-body">
              <span className="text-text-2">Each day shows</span>
              <select aria-label="Prompts a day" value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className="h-control cursor-pointer rounded-control border border-line-input bg-raised px-2 text-body text-text">
                {PER_DAY.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {step === "lock" ? (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-[16px] font-semibold">Lock the journal?</h2>
              <span className="text-meta text-muted">It locks again when you leave the Journal, hide Sanctum, or step away for 5 minutes. It keeps people at this PC out; the pages aren't encrypted on disk.</span>
            </div>
            <div role="radiogroup" aria-label="Lock" className="flex flex-col gap-2">
              {[
                { value: "none" as const, label: "No lock", blurb: "Opens straight away." },
                { value: "hello" as const, label: "Windows Hello", blurb: lock?.helloAvailable ? "Face, fingerprint, or your Windows PIN." : "Not set up on this PC." },
                { value: "pin" as const, label: "A journal PIN", blurb: "4 to 8 digits, just for the journal." },
              ].map((x) => (
                <label
                  key={x.value}
                  className={`flex items-start gap-[10px] rounded-control border px-3 py-2 ${x.value === "hello" && !lock?.helloAvailable ? "opacity-50" : "cursor-pointer"} ${kind === x.value ? "border-sealed bg-sealed-tint" : "border-line-input"}`}
                >
                  <input
                    type="radio"
                    name="journal-lock"
                    checked={kind === x.value}
                    disabled={x.value === "hello" && !lock?.helloAvailable}
                    onChange={() => setKind(x.value)}
                    className="mt-[3px] accent-sealed"
                  />
                  <span className="flex flex-col">
                    <span className="text-body text-text">{x.label}</span>
                    <span className="text-meta text-muted">{x.blurb}</span>
                  </span>
                </label>
              ))}
            </div>
            {kind === "pin" ? (
              <div className="grid grid-cols-2 gap-3">
                <input aria-label="New PIN" type="password" inputMode="numeric" autoComplete="new-password" placeholder={lock?.lock === "pin" ? "New PIN (or leave)" : "PIN"} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} className="h-control rounded-control border border-line-input bg-raised px-2 font-mono text-body text-text outline-none focus:border-sealed" />
                <input aria-label="PIN again" type="password" inputMode="numeric" autoComplete="new-password" placeholder="Again" value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, "").slice(0, 8))} className="h-control rounded-control border border-line-input bg-raised px-2 font-mono text-body text-text outline-none focus:border-sealed" />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-6 py-3">
        {first ? <span className="text-meta text-faint">{step === "welcome" ? "1" : step === "prompts" ? "2" : "3"} of 3</span> : null}
        <span className="grow" />
        {step === "prompts" && first ? (
          <Button variant="ghost" onClick={() => setStep("welcome")}>
            Back
          </Button>
        ) : null}
        {step === "lock" ? (
          <Button variant="ghost" onClick={() => setStep("prompts")}>
            Back
          </Button>
        ) : null}
        {step === "welcome" ? (
          <Button variant="primary" onClick={() => setStep("prompts")}>
            Set it up
          </Button>
        ) : step === "prompts" ? (
          <Button variant="primary" onClick={() => setStep("lock")}>
            Next
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || !pinOk} onClick={() => void finish()}>
            {first ? "Open today" : "Save"}
          </Button>
        )}
      </div>
    </>
  );

  return first ? (
    <section aria-label="Journal setup" className="m-auto flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-panel border border-line bg-panel">
      {body}
    </section>
  ) : (
    <Dialog label="Journal setup" onClose={onClose} width={560} top={48}>
      {body}
    </Dialog>
  );
}
