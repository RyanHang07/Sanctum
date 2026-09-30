import { useState } from "react";
import { Button } from "../components/Button";
import { MiniSelect, Switch } from "../components/controls";
import { ChevronRightIcon, XIcon } from "../components/icons";
import { ProfileDetail } from "./setup/ProfileDetail";
import { ActivitySection, ActivityRulesSection } from "./setup/Activity";
import { ConnectionsSection } from "./setup/Connections";
import { BrowsersSection } from "./setup/Browsers";
import { AccountSection } from "./setup/Account";
import { Row, Section } from "./setup/parts";
import { AppPicker } from "./setup/AppPicker";
import { useStore } from "../state/store";
import { exeList, opensOf, ruleLabel, sealsOf } from "../lib/rules";
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
              <span className="ml-auto text-meta text-muted">
                {p.allowlistMode ? "allowlist" : `seals ${sealsOf(p).length}`}
              </span>
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

/**
 * The universal allowlist: apps allowlist mode always lets start, whatever the profile. Starts
 * with Claude, Spotify, browsers, and terminals. Apps already running when a seal begins stay.
 */
export function AlwaysOpen({ saved, onSave }: { saved: string; onSave: (v: string) => void }) {
  const [picking, setPicking] = useState(false);
  const list = exeList(saved);
  const save = (next: string[]) => onSave(next.join(", "));
  return (
    <div className="flex flex-col gap-2 border-b border-line-soft px-[14px] py-[10px]">
      <div className="flex items-center gap-[10px]">
        <span className="flex min-w-0 grow flex-col gap-[2px]">
          <span className="text-body">Always open</span>
          <span className="text-[11px] text-muted">Allowlist mode always lets these start. Apps already open when you enter stay open.</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
          Add app
        </Button>
      </div>
      <div className="flex flex-wrap gap-1">
        {list.length === 0 ? <span className="text-meta text-faint">Nothing else stays open.</span> : null}
        {list.map((exe) => (
          <span key={exe} className="group flex h-6 items-center gap-1 rounded-[4px] border border-line-input pl-[7px] pr-[3px] font-mono text-[11px] text-text-2">
            {exe}
            <button
              type="button"
              aria-label={`Remove ${exe} from Always open`}
              onClick={() => save(list.filter((e) => e !== exe))}
              className="flex h-4 w-4 items-center justify-center rounded-[3px] text-faint transition-colors duration-ui ease-ui hover:bg-raised hover:text-text"
            >
              <XIcon size={10} />
            </button>
          </span>
        ))}
      </div>
      {picking ? (
        <AppPicker
          title="Keep an app open"
          added={new Set(list)}
          onClose={() => setPicking(false)}
          onPick={(a) => save([...list.filter((e) => e !== a.exe), a.exe])}
        />
      ) : null}
    </div>
  );
}

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
  const { setOnLogin, setCloseAction, setCompactOnFocus, setSounds, setAlwaysAllowed, setDailyGoal, setRestDays, openOnboarding } = useStore();
  return (
    <Section
      title="Preferences"
      action={
        <Button variant="quiet" size="sm" onClick={openOnboarding}>
          Run setup again
        </Button>
      }
    >
      <Row label="Daily focus goal" hint="A day keeps the streak when you reach it and no seal breaks">
        <MiniSelect label="Daily focus goal" value={settings.dailyGoalMin} options={GOALS} onChange={setDailyGoal} />
      </Row>
      <Row label="Rest days" hint="Planned days off never break the streak">
        <RestDays mask={settings.restDaysMask} onChange={setRestDays} />
      </Row>
      <Row label="On login">
        <MiniSelect label="On login" value={settings.onLogin} options={ON_LOGIN} onChange={setOnLogin} />
      </Row>
      <Row label="Close button">
        <MiniSelect label="Close button" value={settings.closeAction} options={CLOSE} onChange={setCloseAction} />
      </Row>
      <Row label="Go compact when focus starts">
        <Switch label="Go compact when focus starts" checked={settings.compactOnFocus} onChange={setCompactOnFocus} />
      </Row>
      <AlwaysOpen saved={settings.alwaysAllowed} onSave={setAlwaysAllowed} />
      <Row label="Sounds" hint="Enter, blocked, held, and seal broken">
        <Switch label="Sounds" checked={settings.sounds} onChange={setSounds} />
      </Row>
    </Section>
  );
}

export function Setup() {
  const editing = useStore((s) => s.profiles.find((p) => p.id === s.editingProfileId) ?? null);
  if (editing) return <ProfileDetail profile={editing} />;

  // Trackers, Check-ins, the accountability partner, and rest days join this page in their milestones.
  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control items-center">
        <h1 className="page-title m-0">Setup</h1>
      </div>
      <div className="grid min-h-0 grow grid-cols-2 items-start gap-4 overflow-y-auto">
        <div className="flex flex-col gap-4">
          <ProfilesSection />
          <PreferencesSection />
        </div>
        <div className="flex flex-col gap-4">
          <ConnectionsSection />
          <AccountSection />
          <BrowsersSection />
          <ActivitySection />
          <ActivityRulesSection />
        </div>
      </div>
    </div>
  );
}
