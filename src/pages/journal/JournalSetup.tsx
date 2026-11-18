import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Check, Dialog, Segmented, TabPanel } from "../../components/controls";
import { HEADLINE } from "../headlines";
import { useJournal } from "../../state/journal";
import { PRESETS, THEMES, type JournalSetup as Setup } from "../../lib/journalPrompts";
import type { JournalLock } from "../../lib/types";

// The journal's own setup (v0.2), separate from the app's first-run setup. The first time, it
// IS the Journal page (no dialog over a placeholder): one screen, the lock, because it's the one
// choice that can't wait until after you've written (2026-11-17; prompts start from a starter set
// and change later). Finishing opens today's page. "Journal settings" is one scrolling dialog:
// the prompts, then the lock, saved together; "Change prompts" opens it at the prompts.

const THEME_TABS = "journal-themes";

/** What the lock does and doesn't do, said plainly: in the lock step and on the lock screen. The
 *  backend refuses pages while locked; the database file holds them the way it holds notes. */
export const PROTECTION = "The lock keeps out people at this PC. Pages aren't encrypted on disk.";

export function JournalSetup({ onClose, first, at }: { onClose: () => void; first: boolean; at?: "prompts" }) {
  const { setup, lock, saveSetup, setLock } = useJournal();
  const promptsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (at === "prompts") promptsRef.current?.scrollIntoView?.({ block: "start" });
  }, [at]);
  const [picked, setPicked] = useState<string[]>(setup.prompts);
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
      const next: Setup = { ...setup, done: true, prompts: picked };
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
        {!first ? (
          <div ref={promptsRef} data-testid="journal-prompts" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-body font-semibold text-text">{HEADLINE.journalPrompts}</h2>
              <span className="text-meta text-muted">Pages open blank. Each day offers one of your picks above the page, to use or pass on. Pick none and it offers nothing.</span>
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
                    className={`rounded-control border px-3 py-[6px] text-left text-meta transition-colors duration-ui ease-ui ${on ? "border-sealed bg-sealed-tint text-text" : "border-line-input text-text-2 hover:bg-raised"}`}
                  >
                    <span className="block font-medium">{x.label}</span>
                    <span className="block text-micro text-muted">{x.blurb}</span>
                  </button>
                );
              })}
            </div>
            <Segmented
              label="Themes"
              panels={THEME_TABS}
              value={theme}
              onChange={setTheme}
              className="flex-wrap self-start"
              options={THEMES.map((t) => {
                const n = t.prompts.filter((x) => picked.includes(x.id)).length;
                return {
                  value: t.id,
                  label: (
                    <>
                      {t.label}
                      {n ? <span className="ml-[6px] font-mono text-micro text-sealed-text">{n}</span> : null}
                    </>
                  ),
                };
              })}
            />
            <TabPanel base={THEME_TABS} value={shown.id} className="flex flex-col gap-1 rounded-control">
              <span className="text-meta text-muted">{shown.blurb}</span>
              {shown.prompts.map((x) => (
                <label key={x.id} className="flex cursor-pointer items-start gap-[10px] rounded-control px-2 py-[6px] hover:bg-raised">
                  <Check checked={picked.includes(x.id)} onToggle={() => toggle(x.id)} className="mt-px" />
                  <span className="text-body text-text">{x.text}</span>
                </label>
              ))}
            </TabPanel>
          </div>
        ) : null}

        <div className={`flex flex-col gap-4 ${first ? "" : "border-t border-line pt-4"}`}>
            {/* First run sits under the page's own title, so its headline is the second level. */}
            {first ? <h2 className="headline m-0 text-moment-dialog">{HEADLINE.journalSetup}</h2> : null}
            {/* One heading, one line (2026-11-17): what the lock does and doesn't do. */}
            <div className="flex flex-col gap-1">
              {first ? (
                <h3 className="m-0 text-body font-semibold text-text">Lock Your Journal (Optional)</h3>
              ) : (
                <h2 className="m-0 text-body font-semibold text-text">Lock Your Journal (Optional)</h2>
              )}
              <span data-testid="journal-protection" className="text-meta text-muted">{PROTECTION}</span>
            </div>
            {/* A radiogroup of cards (M8): each card is the radio, with a 16px dot in place of the native one. */}
            <div role="radiogroup" aria-label="Lock" className="flex flex-col gap-2">
              {[
                { value: "none" as const, label: "No lock", blurb: "Opens straight away." },
                { value: "hello" as const, label: "Windows Hello", blurb: lock?.helloAvailable ? "Face, fingerprint, or your Windows PIN." : "Not set up on this PC." },
                { value: "pin" as const, label: "A journal PIN", blurb: "4 to 8 digits, just for the journal." },
              ].map((x, i, all) => {
                const on = kind === x.value;
                const off = x.value === "hello" && !lock?.helloAvailable;
                // Roving tab stop: the chosen card, or the first one when none is.
                const stop = on || (!all.some((y) => y.value === kind) && i === 0);
                const move = (dir: 1 | -1) => {
                  const live = all.filter((y) => !(y.value === "hello" && !lock?.helloAvailable));
                  const at = live.findIndex((y) => y.value === x.value);
                  const next = live[(at + dir + live.length) % live.length]!;
                  setKind(next.value);
                  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-lock-card="${next.value}"]`)?.focus());
                };
                return (
                  <button
                    key={x.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-disabled={off || undefined}
                    data-lock-card={x.value}
                    tabIndex={stop ? 0 : -1}
                    onClick={() => !off && setKind(x.value)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown" || e.key === "ArrowRight") (e.preventDefault(), move(1));
                      if (e.key === "ArrowUp" || e.key === "ArrowLeft") (e.preventDefault(), move(-1));
                    }}
                    className={`flex items-start gap-[10px] rounded-control border px-3 py-2 text-left transition-colors duration-ui ease-ui ${off ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-check-line"} ${on ? "border-sealed! bg-sealed-tint" : "border-line-input"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-px box-border flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${on ? "border border-sealed bg-sealed" : "border-[1.5px] border-check-line"}`}
                    >
                      {on ? <span className="h-[6px] w-[6px] rounded-full bg-sealed-on" /> : null}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-body text-text">{x.label}</span>
                      <span className="text-meta text-muted">{x.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {kind === "pin" ? (
              <div className="grid grid-cols-2 gap-3">
                <input aria-label="New PIN" type="password" inputMode="numeric" autoComplete="new-password" placeholder={lock?.lock === "pin" ? "New PIN (or leave)" : "PIN"} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} className="h-control rounded-control border border-line-input bg-raised px-2 font-mono text-body text-text" />
                <input aria-label="PIN again" type="password" inputMode="numeric" autoComplete="new-password" placeholder="Again" value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, "").slice(0, 8))} className="h-control rounded-control border border-line-input bg-raised px-2 font-mono text-body text-text" />
              </div>
            ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-6 py-3">
        {first ? <span className="text-meta text-muted">Change it any time in Journal settings.</span> : null}
        <span className="grow" />
        <Button variant="primary" disabled={busy || !pinOk} onClick={() => void finish()}>
          {first ? "Start writing" : "Save"}
        </Button>
      </div>
    </>
  );

  return first ? (
    <section aria-label="Journal setup" className="m-auto flex max-h-full w-full max-w-[560px] flex-col overflow-hidden rounded-panel border border-line bg-panel">
      {body}
    </section>
  ) : (
    <Dialog label="Journal settings" onClose={onClose} width={560} top={48}>
      {body}
    </Dialog>
  );
}
