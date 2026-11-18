import { useEffect, useState } from "react";
import { errorText, native } from "../lib/native";
import type { StartupStatus } from "../lib/types";
import { Button } from "../components/Button";
import { MiniSelect, Switch } from "../components/controls";
import { ChevronRightIcon } from "../components/icons";
import { ProfileDetail } from "./setup/ProfileDetail";
import { ActivityTab } from "./setup/Activity";
import { ConnectionsSection, useCalendarStatus } from "./setup/Connections";
import { BrowsersSection, useBrowserStatus } from "./setup/Browsers";
import { AccountSection, usePartnerStatus } from "./setup/Account";
import { Cascade, Row, Section } from "./setup/parts";
import { StatusDot, type ConnectionTone } from "./setup/status";
import { DistractionsTab } from "./setup/Distractions";
import { TrackersTab } from "./setup/Trackers";
import { AboutSection } from "./setup/About";
import { SoundsSection } from "./setup/Sounds";
import { DndQuietRow, DndRow } from "./setup/Dnd";
import { WeekTargetRow, WeeklyRecapRow } from "./setup/WeekTarget";
import { DangerZone, DataSection } from "./setup/Data";
import { ProtectionSection, useProtectionStatus } from "./setup/Protection";
import { useStore, type SetupTab } from "../state/store";
import { opensOf, ruleLabel } from "../lib/rules";
import { hasDay, WEEKDAYS } from "../lib/planner";
import { minutes } from "../lib/time";
import type { CloseAction, OnLogin } from "../state/appState";
import { AppearanceSection } from "./setup/Appearance";
import { useSwap } from "../lib/useSwap";
import { useTrackers } from "../state/trackers";
import { GOAL_MINUTES } from "./setup/options";

function ProfilesSection() {
  const profiles = useStore((s) => s.profiles);
  const loaded = useStore((s) => s.profilesLoaded);
  const createProfile = useStore((s) => s.createProfile);
  const editProfile = useStore((s) => s.editProfile);

  const create = async () => {
    const p = await createProfile();
    if (p) editProfile(p.id);
  };

  return (
    <Section
      title="Profiles"
      titled={false}
      action={
        <Button variant="ghost" size="sm" onClick={() => void create()}>
          New profile
        </Button>
      }
    >
      {loaded && profiles.length === 0 ? (
        <p className="m-0 px-[14px] py-3 text-meta text-muted">No profiles yet.</p>
      ) : null}
      {profiles.map((p) => {
        const opens = [...new Set(opensOf(p).map(ruleLabel))];
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => editProfile(p.id)}
            className="group flex w-full flex-col gap-[6px] whitespace-normal border-b border-line-soft px-[14px] py-[10px] text-left transition-colors duration-ui ease-ui last:border-b-0 hover:bg-raised"
          >
            <span className="flex w-full items-baseline gap-2">
              <span className="text-body font-medium text-text">{p.name}</span>
              <span className="ml-auto font-mono text-meta text-muted">{p.defaultMinutes} min</span>
              <ChevronRightIcon
                size={10}
                className="self-center text-muted opacity-0 transition-opacity duration-ui ease-ui group-hover:opacity-100"
              />
            </span>
            {p.workTypes.length ? (
              <span className="flex flex-wrap gap-1">
                {p.workTypes.map((t) => (
                  <span key={t} className="flex h-5 items-center rounded-[4px] border border-line-input px-[7px] text-meta text-text-2">
                    {t}
                  </span>
                ))}
              </span>
            ) : (
              <span className="truncate text-meta text-muted">{opens.length ? `Opens ${opens.join(", ")}` : "Opens nothing"}</span>
            )}
          </button>
        );
      })}
    </Section>
  );
}

const ON_LOGIN: { value: OnLogin; label: string }[] = [
  { value: "home", label: "Open Today" },
  { value: "tray", label: "Start in tray" },
];

const CLOSE: { value: CloseAction; label: string }[] = [
  { value: "ask", label: "Ask every time" },
  { value: "tray", label: "Minimize to tray" },
  { value: "quit", label: "Quit Sanctum" },
];

const GOALS = GOAL_MINUTES.map((m) => ({ value: m, label: minutes(m) }));

export function RestDays({ mask, onChange }: { mask: number; onChange: (mask: number) => void }) {
  return (
    <div role="group" aria-label="Rest days" className="flex shrink-0 gap-[3px]">
      {WEEKDAYS.map((d) => {
        const on = hasDay(mask, d.bit);
        return (
          <button
            key={d.name}
            type="button"
            aria-label={d.name}
            aria-pressed={on}
            onClick={() => onChange(mask ^ (1 << d.bit))}
            className={`h-control-sm w-control-sm rounded-control border text-meta transition-colors duration-ui ease-ui ${
              on ? "border-sealed bg-sealed-tint text-text" : "border-line-input text-muted hover:border-check-line hover:text-text-2"
            }`}
          >
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The goal tick from Today's ruler (DayRuler), beside the goal it sets: a crisp solid mark in the
 * second color, the one place this tab uses it. No glow: here the goal is a setting, not met.
 */
export function GoalTick() {
  return <span aria-hidden="true" data-goal-tick className="h-4 w-[2px] shrink-0 rounded-[1px] bg-second" />;
}

/** Goals: the daily goal and the streak it keeps, and the week's target. */
function GoalsSection() {
  const settings = useStore((s) => s.settings);
  const { setDailyGoal, setDailyResetTime, setRestDays } = useStore();
  const [resetDraft, setResetDraft] = useState(settings.dailyResetTime);
  useEffect(() => setResetDraft(settings.dailyResetTime), [settings.dailyResetTime]);
  const commitReset = () => {
    if (resetDraft !== settings.dailyResetTime) void setDailyResetTime(resetDraft);
  };
  return (
    <Section title="Goal and streak">
      <Row label="Daily focus goal" hint="Reaching it keeps the streak">
        <span className="flex shrink-0 items-center gap-2">
          <GoalTick />
          <MiniSelect label="Daily focus goal" value={settings.dailyGoalMin} options={GOALS} onChange={setDailyGoal} />
        </span>
      </Row>
      <Row label="Day resets at" hint="Late nights count as that day">
        <input
          type="time"
          aria-label="Day resets at"
          value={resetDraft}
          onChange={(e) => setResetDraft(e.target.value)}
          onBlur={commitReset}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-control-sm shrink-0 cursor-pointer rounded-control border border-line-input bg-panel px-2 font-mono text-meta text-text transition-colors duration-ui ease-ui hover:border-check-line hover:bg-raised focus:border-sealed focus:bg-panel [color-scheme:inherit] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
        />
      </Row>
      <Row label="Rest days" hint="Days off keep the streak">
        <RestDays mask={settings.restDaysMask} onChange={setRestDays} />
      </Row>
      <WeekTargetRow />
      <WeeklyRecapRow />
    </Section>
  );
}

/** Behavior: how Sanctum starts, closes, and shrinks, then About. */
function BehaviorSection() {
  const settings = useStore((s) => s.settings);
  const { setOnLogin, setCloseAction, setCompactOnFocus, openOnboarding } = useStore();
  return (
    <>
      <Section
        title="Behavior"
        titled={false}
        action={
          <Button variant="quiet" size="sm" onClick={openOnboarding}>
            Run setup again
          </Button>
        }
      >
        <StartupRow />
        <Row label="On login">
          <MiniSelect label="On login" value={settings.onLogin} options={ON_LOGIN} onChange={setOnLogin} />
        </Row>
        <Row label="Close button">
          <MiniSelect label="Close button" value={settings.closeAction} options={CLOSE} onChange={setCloseAction} />
        </Row>
        <Row label="Go compact when focus starts">
          <Switch label="Go compact when focus starts" checked={settings.compactOnFocus} onChange={setCompactOnFocus} />
        </Row>
      </Section>
      <AboutSection />
    </>
  );
}

/** Sound and Alerts: the sounds, then Windows' Do not disturb. */
function AlertsSection() {
  return (
    <>
      <SoundsSection />
      <Section title="Do not disturb">
        <DndRow />
        <DndQuietRow />
      </Section>
    </>
  );
}

/**
 * Start with Windows (v0.1.4). Mirrors Windows' Settings › Apps › Startup both ways, so it's
 * read fresh whenever the window comes back (you may have just changed it there).
 */
function StartupRow() {
  const [status, setStatus] = useState<StartupStatus | null>(null);
  useEffect(() => {
    const load = () => void native.startupStatus().then(setStatus).catch(() => setStatus(null));
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);
  return (
    <Row label="Start with Windows">
      <Switch
        label="Start with Windows"
        checked={status?.enabled ?? false}
        onChange={(on) => void native.setStartup(on).then(setStatus).catch((e) => useStore.getState().showNotice({ lead: errorText(e) }))}
      />
    </Row>
  );
}

// Four groups by what they're for (regrouped 2026-11-16): Focus, Protection, Tracking, App.
// One section at a time on the right, under a short line saying what it does.
type Tab = { id: SetupTab; label: string; blurb: string; group: "Focus" | "Protection" | "Tracking" | "App" };
const TABS: Tab[] = [
  { id: "profiles", group: "Focus", label: "Profiles", blurb: "What each kind of work opens." },
  { id: "distractions", group: "Focus", label: "Distractions", blurb: "What every seal blocks." },
  { id: "goals", group: "Focus", label: "Goals", blurb: "Your daily goal and streak." },
  { id: "protection", group: "Protection", label: "App Guard", blurb: "Blocks sites and reopens Sanctum." },
  { id: "browser", group: "Protection", label: "Browser Extension", blurb: "Seals sites and tabs." },
  { id: "partner", group: "Protection", label: "Partner", blurb: "A friend who holds the key." },
  { id: "trackers", group: "Tracking", label: "Trackers", blurb: "What you track, and when." },
  { id: "tracking", group: "Tracking", label: "Activity", blurb: "What Sanctum notices. Stays here." },
  { id: "calendar", group: "Tracking", label: "Calendar", blurb: "Two-way sync with Google Calendar." },
  { id: "appearance", group: "App", label: "Appearance", blurb: "Themes for light and dark." },
  { id: "sounds", group: "App", label: "Sound and Alerts", blurb: "Sounds and notifications." },
  { id: "behaviour", group: "App", label: "Behavior", blurb: "How Sanctum starts and closes." },
  { id: "data", group: "App", label: "Your Data", blurb: "Export, back up, or erase." },
];

type Mark = { count?: number; attention?: boolean };

/**
 * What the list shows beside an item: a count where there's a list, and a dot only when a
 * connection needs something (the second color). Fine and off stay quiet. The status hooks
 * mount here once, so the guard's poll runs once however many items there are.
 */
function useNavMarks(): Partial<Record<SetupTab, Mark>> {
  const profiles = useStore((s) => (s.profilesLoaded ? s.profiles.length : 0));
  const distractions = useStore((s) => s.distractions.length);
  const trackers = useTrackers((s) => s.trackers.length);
  const tones: [SetupTab, ConnectionTone][] = [
    ["protection", useProtectionStatus()],
    ["browser", useBrowserStatus()],
    ["partner", usePartnerStatus()],
    ["calendar", useCalendarStatus()],
  ];
  const marks: Partial<Record<SetupTab, Mark>> = {
    profiles: { count: profiles },
    distractions: { count: distractions },
    trackers: { count: trackers },
  };
  for (const [id, tone] of tones) if (tone === "attention") marks[id] = { attention: true };
  return marks;
}

const PANEL_ID = "setup-panel";
const tabId = (id: SetupTab) => `setup-tab-${id}`;

/**
 * Setup's list: one vertical tablist. Only the picked section is a Tab stop; Up and Down move
 * between sections (wrapping), Home and End jump to the ends, and moving picks. The group headers
 * sit outside the tab semantics. Under about 800px of page the list narrows so the content keeps
 * its room.
 */
function SetupNav({ tab, onChange }: { tab: SetupTab; onChange: (t: SetupTab) => void }) {
  const marks = useNavMarks();
  const groups = TABS.reduce<{ name: Tab["group"]; tabs: Tab[] }[]>((out, t) => {
    const last = out[out.length - 1];
    if (last && last.name === t.group) last.tabs.push(t);
    else out.push({ name: t.group, tabs: [t] });
    return out;
  }, []);
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((t) => t.id === tab);
    const to =
      e.key === "ArrowDown" ? (at + 1) % TABS.length
      : e.key === "ArrowUp" ? (at - 1 + TABS.length) % TABS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? TABS.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    const next = TABS[to]!.id;
    onChange(next);
    e.currentTarget.querySelector<HTMLElement>(`#${tabId(next)}`)?.focus();
  };
  return (
    <nav aria-label="Setup sections" className="flex w-[184px] shrink-0 flex-col @max-[800px]/setup:w-[136px]">
      <div role="tablist" aria-label="Setup" aria-orientation="vertical" onKeyDown={onKey} className="flex flex-col gap-px">
        {groups.map((g, gi) => (
          <div key={g.name} role="presentation" className="flex flex-col gap-px">
            <span role="presentation" className={`px-[10px] pb-1 label ${gi === 0 ? "" : "pt-4"}`}>
              {g.name}
            </span>
            {g.tabs.map((t) => {
              const mark = marks[t.id];
              const on = tab === t.id;
              return (
                <button
                  key={t.id}
                  id={tabId(t.id)}
                  role="tab"
                  aria-selected={on}
                  aria-controls={PANEL_ID}
                  tabIndex={on ? 0 : -1}
                  aria-label={t.label}
                  aria-description={mark?.attention ? "Needs attention" : undefined}
                  data-attention={mark?.attention || undefined}
                  onClick={() => onChange(t.id)}
                  className={`flex h-8 items-center gap-2 rounded-control px-[10px] text-left text-body transition-colors duration-ui ease-ui ${
                    on ? "bg-raised font-medium text-text" : "text-text-2 hover:bg-raised/60 hover:text-text"
                  }`}
                >
                  <span className="min-w-0 grow truncate">{t.label}</span>
                  {mark?.attention ? <StatusDot tone="attention" /> : null}
                  {mark?.count ? (
                    <span aria-hidden="true" data-testid="nav-count" className="font-mono text-meta font-normal text-muted">
                      {mark.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}

export function Setup() {
  const editing = useStore((s) => s.profiles.find((p) => p.id === s.editingProfileId) ?? null);
  const profiles = useStore((s) => s.profiles);
  const tab = useStore((s) => s.setupTab);
  const loadDistractions = useStore((s) => s.loadDistractions);
  useEffect(() => void loadDistractions(), [loadDistractions]);
  const setTab = (setupTab: SetupTab) => {
    if (editing) useStore.getState().editProfile(null);
    useStore.setState({ setupTab });
  };
  // Sections swap like screens (decided 2026-11-16): the list moves at once, the content follows.
  // A profile opens in the same column with the same swap, Profiles still picked (2026-11-17).
  const { ref: swapRef, shown } = useSwap<string>(editing ? `profile:${editing.id}` : tab, "setup-swap");
  const shownProfile = shown.startsWith("profile:") ? (profiles.find((p) => `profile:${p.id}` === shown) ?? null) : null;
  const picked = editing ? "profiles" : (TABS.find((t) => t.id === tab) ?? TABS[0]!).id;
  const current = (shownProfile ? TABS.find((t) => t.id === "profiles") : TABS.find((t) => t.id === shown)) ?? TABS[0]!;

  return (
    <div className="@container/setup flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control shrink-0 items-center">
        <h1 className="page-title m-0">Setup</h1>
      </div>
      <div className="flex min-h-0 grow gap-6 @max-[800px]/setup:gap-4">
        <SetupNav tab={picked} onChange={setTab} />
        <div
          ref={swapRef}
          id={PANEL_ID}
          role="tabpanel"
          aria-label={shownProfile ? shownProfile.name : current.label}
          className="flex min-h-0 min-w-0 grow flex-col overflow-y-auto pr-1"
        >
          {/* Every section sits in the same column (decided 2026-11-16), so moving between them
              never changes the width. Distractions' two columns fit side by side at this width. */}
          <div data-testid="setup-column" className="flex w-full max-w-[760px] flex-col gap-4">
          {shownProfile ? <ProfileDetail profile={shownProfile} /> : (<>
          <div className="flex shrink-0 flex-col gap-[2px]">
            <h2 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">{current.label}</h2>
            <p className="m-0 text-body text-muted">{current.blurb}</p>
          </div>
          {current.id === "profiles" ? (
            <div className="flex flex-col gap-4">
              <ProfilesSection />
            </div>
          ) : null}
          {current.id === "distractions" ? <DistractionsTab /> : null}
          {current.id === "goals" ? (
            <Cascade>
              <GoalsSection />
            </Cascade>
          ) : null}
          {current.id === "protection" ? (
            <div className="flex flex-col gap-4">
              <ProtectionSection />
            </div>
          ) : null}
          {current.id === "browser" ? (
            <div className="flex flex-col gap-4">
              <BrowsersSection />
            </div>
          ) : null}
          {current.id === "partner" ? (
            <div className="flex flex-col gap-4">
              <AccountSection />
            </div>
          ) : null}
          {current.id === "trackers" ? <TrackersTab /> : null}
          {current.id === "tracking" ? <ActivityTab /> : null}
          {current.id === "calendar" ? (
            <div className="flex flex-col gap-4">
              <ConnectionsSection />
            </div>
          ) : null}
          {current.id === "appearance" ? <AppearanceSection /> : null}
          {current.id === "sounds" ? (
            <Cascade>
              <AlertsSection />
            </Cascade>
          ) : null}
          {current.id === "behaviour" ? (
            <Cascade>
              <BehaviorSection />
            </Cascade>
          ) : null}
          {current.id === "data" ? (
            <Cascade>
              <DataSection />
              <DangerZone />
            </Cascade>
          ) : null}
          </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
