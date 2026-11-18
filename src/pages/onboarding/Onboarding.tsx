import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Kbd } from "../../components/Button";
import { Mark } from "../../components/Mark";
import { catalogDistractions, rulesForWorkTypes, sampleProfiles, WORK_TYPES } from "../../lib/catalog";
import { distractionLabel, guessDistraction } from "../../lib/rules";
import type { NewDistraction } from "../../lib/types";
import { AppPicker } from "../setup/AppPicker";
import { errorText, native } from "../../lib/native";
import { minutes } from "../../lib/time";
import { useStore } from "../../state/store";
import { useCalendar } from "../../state/calendar";
import { RestDays } from "../Setup";
import { AWAY_MINUTES, GOAL_MINUTES } from "../setup/options";
import { BrowsersSection } from "../setup/Browsers";
import { ProtectionSection } from "../setup/Protection";
import { ThemeGrid } from "../setup/Appearance";
import { CheckMark, Segmented, Switch, TabPanel } from "../../components/controls";
import { useTheme } from "../../state/theme";
import { THEMES } from "../../theme/themes";
import { ONBOARDING } from "../headlines";
import { DUR, EASE, gsap, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";

// First run (SPEC 4.11, design/screens/Onboarding.dc.html): welcome, profiles, distractions,
// goals, calendar, browser, done. The partner (M6) and the watchdog (M8) join later.

const STEPS = ["Welcome", "Profiles", "Distractions", "Goals", "Look", "Calendar", "Browser", "Ready"] as const;
/** Picked by default: the catalog's always-sealed four. */
const STARTER = ["Discord", "YouTube", "Instagram", "TikTok"];

type Picks = Record<string, string[]>;

/** A step title: one plain sentence from ONBOARDING in ../headlines (the 2026-11-15 headline
 *  rule: one weight, one color, no italic payoff), with a muted line under it. */
export function Headline({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <h1 className="headline m-0 text-moment">{title}</h1>
      <p className="m-0 text-body text-muted">{sub}</p>
    </div>
  );
}

function Chips<T extends number>({ label, value, options, format, onChange }: { label: string; value: T; options: readonly T[]; format: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-meta text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-[6px]">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            onClick={() => onChange(o)}
            className={`h-9 rounded-control border px-3 font-mono text-body transition-colors duration-ui ease-ui ${
              value === o ? "border-sealed bg-sealed-tint text-text" : "border-line text-text-2 hover:border-line-input"
            }`}
          >
            {format(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

function opensOf(types: string[]): string[] {
  const rules = types.length ? rulesForWorkTypes(types) : [];
  return [...new Set(rules.map((r) => r.label ?? r.value))];
}

function ProfilesStep({ picks, setPicks }: { picks: Picks; setPicks: (p: Picks) => void }) {
  const names = Object.keys(picks);
  const [current, setCurrent] = useState(names[0]!);
  const picked = picks[current] ?? [];
  const opens = opensOf(picked);
  return (
    <>
      <Headline title={ONBOARDING.profile(current)} sub="Pick the work it's for. Sanctum decides what opens and what gets sealed." />
      <Segmented
        label="Profiles"
        panels="ob-profile"
        className="self-start"
        options={names.map((n, i) => ({ value: String(i), label: n }))}
        value={String(Math.max(0, names.indexOf(current)))}
        onChange={(i) => setCurrent(names[Number(i)]!)}
      />
      <TabPanel base="ob-profile" value={String(Math.max(0, names.indexOf(current)))} className="grid grid-cols-3 gap-[6px]">
        {WORK_TYPES.map((w) => {
          const on = picked.includes(w);
          return (
            <button
              key={w}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => setPicks({ ...picks, [current]: on ? picked.filter((p) => p !== w) : [...picked, w] })}
              className={`flex h-9 items-center gap-[10px] rounded-control border px-[10px] text-left text-body transition-colors duration-ui ease-ui ${
                on ? "border-sealed bg-sealed-tint text-text" : "border-line text-text-2 hover:border-line-input"
              }`}
            >
              <CheckMark done={on} />
              {w}
            </button>
          );
        })}
      </TabPanel>
      <div className="flex flex-col gap-2 rounded-panel border border-line bg-panel-footer p-3">
        <span className="text-meta text-muted">Opens when you enter</span>
        <span className="text-body leading-normal text-text">{opens.length ? opens.join(", ") : "Nothing yet"}</span>
      </div>
      <p className="m-0 text-meta text-muted">A profile with no work picked is skipped. Rename and edit them any time in Setup.</p>
    </>
  );
}

export interface Flags {
  /** Common distractions picked by name. */
  common: string[];
  /** Anything else: typed sites, links, keywords, and picked apps. */
  extra: NewDistraction[];
}

function DistractionsStep({ flags, setFlags }: { flags: Flags; setFlags: (f: Flags) => void }) {
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const groups = catalogDistractions();
  const toggle = (label: string) =>
    setFlags({ ...flags, common: flags.common.includes(label) ? flags.common.filter((l) => l !== label) : [...flags.common, label] });
  const add = () => {
    const kind = guessDistraction(draft);
    if (!kind) return;
    setFlags({ ...flags, extra: [...flags.extra, { kind, value: draft.trim() }] });
    setDraft("");
  };
  return (
    <>
      <Headline title={ONBOARDING.distractions} sub="One list for every profile: sealed in every session, and counted as distracting time." />
      <div className="flex flex-wrap gap-[6px]">
        {groups.map((g) => {
          const on = flags.common.includes(g.label);
          return (
            <button
              key={g.label}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(g.label)}
              className={`flex h-8 items-center gap-2 rounded-control border px-[10px] text-body transition-colors duration-ui ease-ui ${
                on ? "border-sealed bg-sealed-tint text-text" : "border-line text-text-2 hover:border-line-input"
              }`}
            >
              <CheckMark done={on} />
              {g.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          aria-label="Add a site, link, or keyword"
          placeholder="Add a site, link, or keyword"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="h-control min-w-0 grow rounded-control border border-line-input bg-raised px-3 text-body text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line focus:border-sealed"
        />
        <Button variant="ghost" onClick={() => setPicking(true)}>
          Add an app
        </Button>
      </div>
      {flags.extra.length ? (
        <span className="text-meta text-text-2">Also: {flags.extra.map((e) => distractionLabel({ kind: e.kind === "auto" ? "keyword" : e.kind, value: e.value, label: e.label ?? null })).join(", ")}</span>
      ) : null}
      <p className="m-0 text-meta text-muted">Setup › Distractions suggests more once Sanctum has seen a few days of your work.</p>
      {picking ? (
        <AppPicker
          title="Flag an app"
          added={new Set(flags.extra.filter((e) => e.kind === "app").map((e) => e.value))}
          onClose={() => setPicking(false)}
          onPick={(a) => setFlags({ ...flags, extra: [...flags.extra, { kind: "app", value: a.exe, label: a.name, path: a.launch }] })}
        />
      ) : null}
    </>
  );
}

/** Pick a look (v0.3): following Windows, the theme for the mode Windows is in now. */
function LookStep() {
  const { prefs, theme, setFollow } = useTheme();
  const mode = theme.scheme;
  return (
    <>
      <Headline title={ONBOARDING.look} sub="Colors only: Sanctum stays Sanctum. Hover a theme to see it." />
      <label className="flex items-center gap-3 text-body">
        <Switch checked={prefs.follow} onChange={(v) => void setFollow(v)} label="Follow Windows" />
        <span>
          Follow Windows{" "}
          <span className="text-muted">{prefs.follow ? `(it's in ${mode} mode; pick the other in Setup › Appearance)` : "(one theme, always)"}</span>
        </span>
      </label>
      <div className="max-h-[236px] overflow-y-auto pr-1">
        <ThemeGrid
          small
          themes={prefs.follow ? THEMES.filter((t) => t.scheme === mode) : THEMES}
          chosen={prefs.follow ? prefs[mode] : prefs.fixed}
          label={prefs.follow ? `Theme in ${mode} mode` : "Theme"}
        />
      </div>
    </>
  );
}

function GoalsStep() {
  const settings = useStore((s) => s.settings);
  const { setDailyGoal, setRestDays, setActivitySetting } = useStore();
  return (
    <>
      <Headline title={ONBOARDING.goal} sub="A day keeps your streak when you reach the goal and no seal breaks." />
      <Chips label="Daily focus goal" value={settings.dailyGoalMin} options={GOAL_MINUTES} format={minutes} onChange={setDailyGoal} />
      <Chips label="Count you as away after" value={settings.idleThresholdMin} options={AWAY_MINUTES} format={(m) => `${m} min`} onChange={(m) => setActivitySetting("idleThresholdMin", m)} />
      <div className="flex flex-col gap-2">
        <span className="text-meta text-muted">Rest days never break the streak</span>
        <RestDays mask={settings.restDaysMask} onChange={setRestDays} />
      </div>
    </>
  );
}

function CalendarStep() {
  const status = useCalendar((s) => s.status);
  const { connect, cancelConnect, load } = useCalendar();
  useEffect(() => void load(), [load]);
  let body: ReactNode;
  if (!status?.configured) body = <p className="m-0 text-body text-muted">This build has no Google sign-in. Connect later in Setup.</p>;
  else if (status.connected) body = <p className="m-0 text-body text-text">Connected as {status.email ?? "your account"}. Timed items and the routines you choose sync to a Sanctum calendar.</p>;
  else if (status.connecting)
    body = (
      <div className="flex items-center gap-3">
        <span className="text-body text-muted">Finish signing in in your browser.</span>
        <Button variant="quiet" size="sm" onClick={cancelConnect}>
          Cancel
        </Button>
      </div>
    );
  else
    body = (
      <Button variant="ghost" className="self-start" onClick={() => void connect()}>
        Connect Google Calendar
      </Button>
    );
  return (
    <>
      <Headline title={ONBOARDING.calendar} sub="Events tagged #focus start their profile on time, and meetings pause the seal. Optional." />
      {body}
    </>
  );
}

function BrowserStep() {
  return (
    <>
      <Headline title={ONBOARDING.browser} sub="The extension blocks your distracting sites, links, and keyword tabs. Protection blocks sites in every browser and keeps Sanctum open while you're sealed." />
      <div className="flex max-h-[300px] flex-col gap-3 overflow-y-auto pr-1 [&>*]:shrink-0">
        <BrowsersSection titled />
        <ProtectionSection />
      </div>
    </>
  );
}

function ReadyStep({ picks, flags }: { picks: Picks; flags: Flags }) {
  const goal = useStore((s) => s.settings.dailyGoalMin);
  const made = Object.entries(picks).filter(([, t]) => t.length);
  const sealed = [...flags.common, ...flags.extra.map((e) => e.label ?? e.value)];
  return (
    <>
      <Headline title={ONBOARDING.done} sub="Sanctum starts with Windows and opens Today. Change anything in Setup." />
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-body">
        <li className="flex justify-between border-b border-line-soft pb-2">
          <span className="text-muted">Profiles</span>
          <span className="text-text">{made.length ? made.map(([n]) => n).join(", ") : "None yet"}</span>
        </li>
        <li className="flex justify-between gap-6 border-b border-line-soft pb-2">
          <span className="shrink-0 text-muted">Distractions</span>
          <span className="truncate text-text">{sealed.length ? sealed.join(", ") : "None yet"}</span>
        </li>
        <li className="flex justify-between border-b border-line-soft pb-2">
          <span className="text-muted">Daily goal</span>
          <span className="font-mono text-text">{minutes(goal)}</span>
        </li>
      </ul>
    </>
  );
}

/**
 * A new step settles in (Onboarding.dc's obIn): the body rises 6 px and fades in, so Continue and
 * Back read as a move without a slide. The first step shows at once. Under reduced motion or a
 * hidden window the timeline jumps to its end, so the step simply appears.
 */
function useStepIn(step: number) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const { run } = useMotion(ref);
  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (!ref.current) return;
      run(() =>
        gsap
          .timeline({ id: "onboarding-step" })
          .fromTo(ref.current, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: DUR.state, ease: EASE.glide, clearProps: "transform" }),
      );
    },
    { scope: ref, dependencies: [step] },
  );
  return ref;
}

/** Creates the picked profiles (skipping names that exist), flags the distractions, and marks setup done. */
export async function finishOnboarding(picks: Picks, name: string, flags: Flags = { common: [], extra: [] }): Promise<void> {
  const existing = new Set((await native.listProfiles()).map((p) => p.name.toLowerCase()));
  const minutesFor = Object.fromEntries(sampleProfiles().map((p) => [p.name, p.defaultMinutes]));
  for (const [n, types] of Object.entries(picks)) {
    if (!types.length || existing.has(n.toLowerCase())) continue;
    await native.createProfile({ name: n, defaultMinutes: minutesFor[n] ?? 60, workTypes: types, rules: rulesForWorkTypes(types) });
  }
  for (const g of catalogDistractions().filter((g) => flags.common.includes(g.label))) {
    for (const item of g.items) await native.addDistraction(item).catch(() => undefined);
  }
  for (const item of flags.extra) await native.addDistraction(item).catch(() => undefined);
  if (name.trim()) await native.setSetting("display_name", name.trim());
  await native.setSetting("onboarded", "1");
}

export function Onboarding() {
  const close = useStore((s) => s.closeOnboarding);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(useStore.getState().settings.displayName);
  const [picks, setPicks] = useState<Picks>(() => Object.fromEntries(sampleProfiles().map((p) => [p.name, [...(p.workTypes ?? [])]])));
  const [flags, setFlags] = useState<Flags>({ common: STARTER, extra: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter and the button can both fire: one finish at a time, or profiles are made twice.
  const finishing = useRef(false);
  const last = step === STEPS.length - 1;
  const body = useStepIn(step);

  const next = async () => {
    if (finishing.current) return;
    if (!last) return setStep(step + 1);
    finishing.current = true;
    setBusy(true);
    setError(null);
    try {
      await finishOnboarding(picks, name, flags);
      await close();
      await useStore.getState().loadDistractions();
    } catch (e) {
      setError(errorText(e));
    } finally {
      finishing.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The close dialog owns Enter while it's open.
      if (e.key === "Enter" && !(e.target instanceof HTMLInputElement) && !useStore.getState().closeDialogOpen) void next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex h-full w-full items-center justify-center bg-app">
      <div role="dialog" aria-label="Sanctum setup" className="flex w-[680px] flex-col overflow-hidden rounded-dialog border border-line bg-panel">
        <div className="flex flex-col gap-[10px] px-6 pt-[18px]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Mark size={16} />
              <span className="text-body font-semibold">Sanctum setup</span>
            </span>
            <span className="text-meta text-muted">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </span>
          </div>
          <div className="flex gap-1" aria-hidden="true">
            {STEPS.map((s, i) => (
              <span key={s} className={`h-[3px] flex-1 rounded-[2px] ${i <= step ? "bg-sealed" : "bg-line"}`} />
            ))}
          </div>
        </div>

        <div ref={body} data-step-body className="flex min-h-[380px] flex-col gap-[18px] px-6 py-[22px]">
          {step === 0 ? (
            <>
              <Headline title={ONBOARDING.welcome} sub="Two minutes: pick your profiles, name your distractions, set a goal, and connect what you use." />
              <label className="flex flex-col gap-2">
                <span className="text-meta text-muted">Your name, for Today</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void next()}
                  placeholder="Optional"
                  className="h-control w-[260px] rounded-control border border-line-input bg-raised px-3 text-body text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line focus:border-sealed"
                />
              </label>
            </>
          ) : null}
          {step === 1 ? <ProfilesStep picks={picks} setPicks={setPicks} /> : null}
          {step === 2 ? <DistractionsStep flags={flags} setFlags={setFlags} /> : null}
          {step === 3 ? <GoalsStep /> : null}
          {step === 4 ? <LookStep /> : null}
          {step === 5 ? <CalendarStep /> : null}
          {step === 6 ? <BrowserStep /> : null}
          {step === 7 ? <ReadyStep picks={picks} flags={flags} /> : null}
        </div>

        <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-6 py-3">
          {error ? (
            <p role="alert" className="m-0 min-w-0 truncate text-meta text-broken-text">
              {error}
            </p>
          ) : null}
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          ) : null}
          {step === 5 || step === 6 ? (
            <Button variant="quiet" onClick={() => setStep(step + 1)}>
              Skip
            </Button>
          ) : null}
          <Button variant="primary" className="ml-auto gap-[10px]" disabled={busy} onClick={() => void next()}>
            {last ? "Start using Sanctum" : "Continue"}
            <Kbd onFill>↵</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}
