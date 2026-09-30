import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { AppIcon, Dialog } from "../../components/controls";
import { ChevronIcon, GlobeIcon, PlusIcon, XIcon } from "../../components/icons";
import { AppPicker } from "./AppPicker";
import { useStore } from "../../state/store";
import { durationsMin } from "../../theme/tokens";
import { useInstalledApps } from "../../lib/installedApps";
import { distractionLabel, normalizeUrl, opensOf, ruleLabel, ruleMeta } from "../../lib/rules";
import type { InstalledApp, Profile, Rule } from "../../lib/types";

const isApp = (r: Rule) => r.kind === "launch_app";

/** Where to read an app rule's icon: its saved shortcut, else the installed app with that exe. */
const appPath = (r: Rule, apps: InstalledApp[] | null) => r.path ?? apps?.find((a) => a.exe === r.value)?.launch ?? null;

/** Only knowable once the scan has finished. */
export const notInstalled = (r: Rule, apps: InstalledApp[] | null) => isApp(r) && apps !== null && appPath(r, apps) === null;

function RuleIcon({ rule, apps }: { rule: Rule; apps: InstalledApp[] | null }) {
  if (isApp(rule)) return <AppIcon path={appPath(rule, apps)} label={ruleLabel(rule)} size={16} />;
  const Icon = GlobeIcon;
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">
      <Icon size={14} />
    </span>
  );
}

function RulePanel({
  title,
  rules,
  apps,
  placeholder,
  empty,
  onAddApp,
  onSubmit,
  onRemove,
}: {
  title: string;
  rules: Rule[];
  apps: InstalledApp[] | null;
  placeholder: string;
  empty: string;
  onAddApp: () => void;
  /** Returns true when the input was accepted and should clear. */
  onSubmit: (text: string) => Promise<boolean>;
  onRemove: (rule: Rule) => void;
}) {
  const [draft, setDraft] = useState("");
  const submit = async () => {
    if (draft.trim() && (await onSubmit(draft))) setDraft("");
  };
  const iconButton =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted opacity-0 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100";
  return (
    <section aria-label={title} className="flex min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-[14px]">
        <h2 className="m-0 text-body font-semibold text-text">{title}</h2>
        <span className="font-mono text-meta text-muted">{rules.length}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onAddApp}>
          Add app
        </Button>
      </div>
      <div className="flex min-h-0 grow flex-col overflow-y-auto py-1">
        {rules.length === 0 ? <p className="m-0 px-[14px] py-2 text-meta text-faint">{empty}</p> : null}
        {rules.map((r) => (
          <div key={r.id} className="flex shrink-0 flex-col">
            <div className="group flex h-row shrink-0 items-center gap-[10px] px-[14px] transition-colors duration-ui ease-ui hover:bg-line-soft">
              <RuleIcon rule={r} apps={apps} />
              <span className="min-w-0 truncate text-body text-text">{ruleLabel(r)}</span>
              <span className="min-w-0 grow truncate font-mono text-[11px] text-faint">
                {ruleMeta(r)}
                {notInstalled(r, apps) ? " · not installed" : ""}
              </span>
              <button type="button" aria-label={`Remove ${ruleLabel(r)}`} onClick={() => onRemove(r)} className={iconButton}>
                <XIcon />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex h-[38px] shrink-0 items-center gap-[10px] border-t border-line px-[14px]">
        <PlusIcon className="text-faint" />
        <input
          aria-label={placeholder}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="h-9 min-w-0 grow border-none bg-transparent text-body text-text outline-none placeholder:text-faint"
        />
        <span className="font-mono text-[11px] text-faint">↵</span>
      </div>
    </section>
  );
}

function NameField({ profile }: { profile: Profile }) {
  const updateProfile = useStore((s) => s.updateProfile);
  const [name, setName] = useState(profile.name);
  useEffect(() => setName(profile.name), [profile.name]);
  const commit = async () => {
    if (name.trim() === profile.name) return setName(profile.name);
    if (!(await updateProfile(profile.id, { name }))) setName(profile.name);
  };
  return (
    <label className="relative flex items-center">
      <span className="pointer-events-none absolute left-[10px] text-meta text-muted">Name</span>
      <input
        aria-label="Profile name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-9 w-[260px] rounded-control border border-line-input bg-raised pl-[56px] pr-3 text-body font-medium text-text outline-none transition-colors duration-ui ease-ui hover:border-check-line focus:border-sealed"
      />
    </label>
  );
}

export function ProfileDetail({ profile }: { profile: Profile }) {
  const { editProfile, updateProfile, deleteProfile, addRule, removeRule, launchProfile, showNotice, openSetup } = useStore();
  const distractions = useStore((s) => s.distractions);
  const apps = useInstalledApps();
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [launching, setLaunching] = useState(false);

  const opens = opensOf(profile);
  const added = useMemo(() => new Set(profile.rules.filter((r) => r.kind === "launch_app").map((r) => r.value)), [profile.rules]);
  const count = (kind: string) => distractions.filter((d) => d.kind === kind).length;

  const addUrl = async (text: string) => {
    const url = normalizeUrl(text);
    if (!url) {
      showNotice({ lead: `${text.trim()} is not a URL.` });
      return false;
    }
    return !!(await addRule(profile.id, { kind: "launch_url", value: url }));
  };

  const testLaunch = async () => {
    setLaunching(true);
    await launchProfile(profile.id);
    setLaunching(false);
  };

  return (
    <div className="flex h-full flex-col gap-4 px-7 pb-6 pt-5">
      <div className="flex h-control items-center gap-2">
        <button
          type="button"
          onClick={() => editProfile(null)}
          className="page-title rounded-control text-muted transition-colors duration-ui ease-ui hover:text-text"
        >
          Setup
        </button>
        <ChevronIcon size={12} className="-rotate-90 text-faint" />
        <h1 className="page-title m-0 min-w-0 truncate">{profile.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="raised" onClick={() => void testLaunch()} disabled={launching || opens.length === 0}>
            {launching ? "Opening" : "Test launch"}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-panel border border-line bg-panel p-2">
        <NameField profile={profile} />
        <label className="relative flex items-center">
          <span className="pointer-events-none absolute left-[10px] text-meta text-muted">For</span>
          <select
            aria-label="Default duration"
            value={profile.defaultMinutes}
            onChange={(e) => void updateProfile(profile.id, { defaultMinutes: Number(e.target.value) })}
            className="h-9 w-[124px] cursor-pointer appearance-none rounded-control border border-line-input bg-raised pl-[38px] pr-[30px] font-mono text-body text-text outline-none transition-colors duration-ui ease-ui hover:border-check-line focus-visible:border-sealed"
          >
            {durationsMin.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
          <ChevronIcon className="pointer-events-none absolute right-[10px] text-muted" />
        </label>
      </div>

      <div className="grid min-h-0 grow grid-cols-[minmax(0,1fr)_280px] gap-4">
        <RulePanel
          title="Opens"
          rules={opens}
          apps={apps}
          placeholder="Add a URL"
          empty="Nothing opens with this profile yet."
          onAddApp={() => setPicker(true)}
          onSubmit={addUrl}
          onRemove={(r) => void removeRule(r.id)}
        />
        <section aria-label="Seals" className="flex flex-col gap-3 self-start rounded-panel border border-line bg-panel p-[14px]">
          <h2 className="m-0 text-body font-semibold">Seals</h2>
          <p className="m-0 text-meta text-muted">
            Every profile seals your Distractions list. Apps this profile opens are never closed.
          </p>
          <span className="font-mono text-meta text-text-2">
            {count("app")} apps · {count("site")} sites · {count("keyword")} keywords
          </span>
          {distractions.length ? (
            <span className="truncate text-meta text-faint">{distractions.slice(0, 6).map(distractionLabel).join(", ")}</span>
          ) : null}
          <Button variant="ghost" size="sm" className="self-start" onClick={() => openSetup("distractions")}>
            Edit distractions
          </Button>
        </section>
      </div>

      {picker ? (
        <AppPicker
          title="Add an app to open"
          added={added}
          onClose={() => setPicker(false)}
          onPick={(a) => void addRule(profile.id, { kind: "launch_app", value: a.exe, label: a.name, path: a.launch })}
        />
      ) : null}

      {confirmDelete ? (
        <Dialog label={`Delete ${profile.name}`} onClose={() => setConfirmDelete(false)}>
          <div className="flex flex-col gap-1 px-[18px] pb-4 pt-[18px]">
            <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">Delete {profile.name}</h1>
            <p className="m-0 text-body text-muted">Its launch set is removed. Past sessions keep their history.</p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              autoFocus
              onClick={async () => {
                setConfirmDelete(false);
                if (await deleteProfile(profile.id)) editProfile(null);
              }}
            >
              Delete
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
