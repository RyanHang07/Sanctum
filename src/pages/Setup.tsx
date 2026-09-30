import { useEffect } from "react";
import { Button } from "../components/Button";
import { MiniSelect, Switch } from "../components/controls";
import { ChevronRightIcon } from "../components/icons";
import { ProfileDetail } from "./setup/ProfileDetail";
import { ActivitySection, ActivityRulesSection } from "./setup/Activity";
import { ConnectionsSection } from "./setup/Connections";
import { BrowsersSection } from "./setup/Browsers";
import { AccountSection } from "./setup/Account";
import { Row, Section } from "./setup/parts";
import { DistractionsTab } from "./setup/Distractions";
import { TrackersTab } from "./setup/Trackers";
import { useStore, type SetupTab } from "../state/store";
import { opensOf, ruleLabel } from "../lib/rules";
import { hasDay, WEEKDAYS } from "../lib/planner";
import { minutes } from "../lib/time";
import type { CloseAction, OnLogin } from "../state/appState";

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
      action={
        <Button variant="ghost" size="sm" onClick={() => void create()}>
          New profile
        </Button>
      }
    >
      {loaded && profiles.length === 0 ? (
        <p className="m-0 px-[14px] py-3 text-meta text-muted">No profiles yet. Onboarding sets them up, or create one now.</p>
      ) : null}
      {profiles.map((p) => {
        const opens = [...new Set(opensOf(p).map(ruleLabel))];
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => editProfile(p.id)}
            className="group flex w-full flex-col gap-[6px] whitespace-normal border-b border-line-soft px-[14px] py-[10px] text-left transition-colors duration-ui ease-ui last:border-b-0 hover:bg-line-soft"
          >
            <span className="flex w-full items-baseline gap-2">
              <span className="text-body font-medium text-text">{p.name}</span>
              <span className="ml-auto font-mono text-meta text-muted">{p.defaultMinutes} min</span>
              <ChevronRightIcon
                size={10}
                className="self-center text-faint opacity-0 transition-opacity duration-ui ease-ui group-hover:opacity-100"
              />
            </span>
            {p.workTypes.length ? (
              <span className="flex flex-wrap gap-1">
                {p.workTypes.map((t) => (
                  <span key={t} className="flex h-5 items-center rounded-[4px] border border-line-input px-[7px] text-[11px] text-text-2">
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
  { value: "home", label: "Open Home" },
  { value: "tray", label: "Start in tray" },
];

const CLOSE: { value: CloseAction; label: string }[] = [
  { value: "ask", label: "Ask every time" },
  { value: "tray", label: "Minimize to tray" },
  { value: "quit", label: "Quit Sanctum" },
];

const GOALS = [30, 60, 90, 120, 150, 180, 240, 300].map((m) => ({ value: m, label: minutes(m) }));

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
            className={`h-[26px] w-[26px] rounded-control border text-meta transition-colors duration-ui ease-ui ${
              on ? "border-sealed-line bg-sealed-tint text-text" : "border-line-input text-muted hover:border-check-line hover:text-text-2"
            }`}
          >
            {d.short}
          </button>
        );
      })}
    </div>
  );
}

function PreferencesSection() {
  const settings = useStore((s) => s.settings);
  const { setOnLogin, setCloseAction, setCompactOnFocus, setSounds, setDailyGoal, setRestDays, openOnboarding } = useStore();
  return (
    <>
    <Section title="Goal and streak">
      <Row label="Daily focus goal" hint="A day keeps the streak when you reach it and no seal breaks">
        <MiniSelect label="Daily focus goal" value={settings.dailyGoalMin} options={GOALS} onChange={setDailyGoal} />
      </Row>
      <Row label="Rest days" hint="Planned days off never break the streak">
        <RestDays mask={settings.restDaysMask} onChange={setRestDays} />
      </Row>
    </Section>
    <Section
      title="App"
      action={
        <Button variant="quiet" size="sm" onClick={openOnboarding}>
          Run setup again
        </Button>
      }
    >
      <Row label="On login">
        <MiniSelect label="On login" value={settings.onLogin} options={ON_LOGIN} onChange={setOnLogin} />
      </Row>
      <Row label="Close button">
        <MiniSelect label="Close button" value={settings.closeAction} options={CLOSE} onChange={setCloseAction} />
      </Row>
      <Row label="Go compact when focus starts">
        <Switch label="Go compact when focus starts" checked={settings.compactOnFocus} onChange={setCompactOnFocus} />
      </Row>
      <Row label="Sounds" hint="Enter, blocked, held, and seal broken">
        <Switch label="Sounds" checked={settings.sounds} onChange={setSounds} />
      </Row>
    </Section>
    </>
  );
}

const TABS: { id: SetupTab; label: string; blurb: string }[] = [
  { id: "profiles", label: "Profiles", blurb: "What each kind of work opens, and how long it runs." },
  { id: "distractions", label: "Distractions", blurb: "What every focus session blocks." },
  { id: "trackers", label: "Trackers", blurb: "What you track, and when check-ins ask for it." },
  { id: "tracking", label: "Activity", blurb: "What Sanctum notices while you work. It stays on this PC." },
  { id: "connections", label: "Connections", blurb: "Your calendar, your partner, and your browsers." },
  { id: "general", label: "General", blurb: "Your goal, your rest days, and how the app behaves." },
];

function SetupTabs({ tab, onChange }: { tab: SetupTab; onChange: (t: SetupTab) => void }) {
  return (
    <div role="tablist" aria-label="Setup" className="flex rounded-control border border-line-input p-[2px]">
      {TABS.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={tab === t.id}
          onClick={() => onChange(t.id)}
          className={`h-[26px] rounded-[4px] px-[10px] text-meta transition-colors duration-ui ease-ui ${
            tab === t.id ? "bg-line font-medium text-text" : "text-muted hover:text-text-2"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Setup() {
  const editing = useStore((s) => s.profiles.find((p) => p.id === s.editingProfileId) ?? null);
  const tab = useStore((s) => s.setupTab);
  const loadDistractions = useStore((s) => s.loadDistractions);
  useEffect(() => void loadDistractions(), [loadDistractions]);
  const setTab = (setupTab: SetupTab) => useStore.setState({ setupTab });
  if (editing) return <ProfileDetail profile={editing} />;
  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="page-title m-0">Setup</h1>
          <span className="truncate text-body text-muted">{current.blurb}</span>
        </div>
        <SetupTabs tab={tab} onChange={setTab} />
      </div>
      <div className="min-h-0 grow overflow-y-auto pr-1">
        {tab === "profiles" ? (
          <div className="flex max-w-[640px] flex-col gap-4">
            <ProfilesSection />
          </div>
        ) : null}
        {tab === "distractions" ? <DistractionsTab /> : null}
        {tab === "trackers" ? <TrackersTab /> : null}
        {tab === "tracking" ? (
          <div className="flex max-w-[640px] flex-col gap-4">
            <ActivitySection />
            <ActivityRulesSection />
          </div>
        ) : null}
        {tab === "connections" ? (
          <div className="flex max-w-[640px] flex-col gap-4">
            <ConnectionsSection />
            <AccountSection />
            <BrowsersSection />
          </div>
        ) : null}
        {tab === "general" ? (
          <div className="flex max-w-[640px] flex-col gap-4">
            <PreferencesSection />
          </div>
        ) : null}
      </div>
    </div>
  );
}
