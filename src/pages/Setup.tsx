import { Button } from "../components/Button";
import { MiniSelect, Switch } from "../components/controls";
import { ChevronRightIcon } from "../components/icons";
import { ProfileDetail } from "./setup/ProfileDetail";
import { ActivitySection, ActivityRulesSection } from "./setup/Activity";
import { ConnectionsSection } from "./setup/Connections";
import { AppListField, Row, Section } from "./setup/parts";
import { useStore } from "../state/store";
import { opensOf, ruleLabel, sealsOf } from "../lib/rules";
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

function PreferencesSection() {
  const settings = useStore((s) => s.settings);
  const { setOnLogin, setCloseAction, setCompactOnFocus, setSounds, setAlwaysAllowed } = useStore();
  return (
    <Section title="Preferences">
      <Row label="On login">
        <MiniSelect label="On login" value={settings.onLogin} options={ON_LOGIN} onChange={setOnLogin} />
      </Row>
      <Row label="Close button">
        <MiniSelect label="Close button" value={settings.closeAction} options={CLOSE} onChange={setCloseAction} />
      </Row>
      <Row label="Go compact when focus starts">
        <Switch label="Go compact when focus starts" checked={settings.compactOnFocus} onChange={setCompactOnFocus} />
      </Row>
      <Row label="Always allowed" hint="Never closed in allowlist mode">
        <AppListField label="Always allowed" saved={settings.alwaysAllowed} placeholder="1password.exe, keepassxc.exe" onSave={setAlwaysAllowed} />
      </Row>
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
          <ActivitySection />
          <ActivityRulesSection />
        </div>
      </div>
    </div>
  );
}
