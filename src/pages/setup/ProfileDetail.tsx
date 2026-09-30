import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { AppIcon, Dialog, Switch } from "../../components/controls";
import { ChevronIcon, GlobeIcon, PlusIcon, TextIcon, XIcon } from "../../components/icons";
import { AppPicker } from "./AppPicker";
import { useStore } from "../../state/store";
import { durationsMin } from "../../theme/tokens";
import { useInstalledApps } from "../../lib/installedApps";
import { classifySealInput, normalizeUrl, opensOf, ruleLabel, ruleMeta, sealsOf } from "../../lib/rules";
import type { InstalledApp, Profile, Rule } from "../../lib/types";

const isApp = (r: Rule) => r.kind === "app" || r.kind === "launch_app";

/** Where to read an app rule's icon: its saved shortcut, else the installed app with that exe. */
const appPath = (r: Rule, apps: InstalledApp[] | null) => r.path ?? apps?.find((a) => a.exe === r.value)?.launch ?? null;

/** Only knowable once the scan has finished. */
export const notInstalled = (r: Rule, apps: InstalledApp[] | null) => isApp(r) && apps !== null && appPath(r, apps) === null;

function RuleIcon({ rule, apps }: { rule: Rule; apps: InstalledApp[] | null }) {
  if (isApp(rule)) return <AppIcon path={appPath(rule, apps)} label={ruleLabel(rule)} size={16} />;
  const Icon = rule.kind === "title" ? TextIcon : GlobeIcon;
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
  note,
  onAddApp,
  onSubmit,
  onRemove,
  onAllow,
  onRemoveAllow,
}: {
  title: string;
  rules: Rule[];
  apps: InstalledApp[] | null;
  placeholder: string;
  empty: string;
  note?: string;
  onAddApp: () => void;
  /** Returns true when the input was accepted and should clear. */
  onSubmit: (text: string) => Promise<boolean>;
  onRemove: (rule: Rule) => void;
  /** Sealed sites: add a page that stays open. Returns true when accepted. */
  onAllow?: (rule: Rule, text: string) => Promise<boolean>;
  onRemoveAllow?: (id: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const [allowing, setAllowing] = useState<number | null>(null);
  const [allowDraft, setAllowDraft] = useState("");
  const submitAllow = async (r: Rule) => {
    if (!allowDraft.trim()) return setAllowing(null);
    if (onAllow && (await onAllow(r, allowDraft))) {
      setAllowDraft("");
      setAllowing(null);
    }
  };
  const iconButton =
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted opacity-0 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100";
  const submit = async () => {
    if (draft.trim() && (await onSubmit(draft))) setDraft("");
  };
  return (
    <section aria-label={title} className="flex min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-[14px]">
        <h2 className="m-0 text-body font-semibold text-text">{title}</h2>
        <span className="font-mono text-meta text-muted">{rules.length}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onAddApp}>
          Add app
        </Button>
      </div>
      {note ? <p className="m-0 border-b border-line-soft px-[14px] py-2 text-meta text-muted">{note}</p> : null}
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
              {onAllow && r.kind === "domain" ? (
                <button
                  type="button"
                  aria-label={`Allow a page on ${r.value}`}
                  onClick={() => {
                    setAllowDraft("");
                    setAllowing(allowing === r.id ? null : r.id);
                  }}
                  className={`h-6 shrink-0 rounded-control px-2 text-meta text-muted opacity-0 transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-raised hover:text-text focus-visible:opacity-100 group-hover:opacity-100 ${allowing === r.id ? "opacity-100" : ""}`}
                >
                  Allow a page
                </button>
              ) : null}
              <button type="button" aria-label={`Remove ${ruleLabel(r)}`} onClick={() => onRemove(r)} className={iconButton}>
                <XIcon />
              </button>
            </div>
            {r.allow.map((a) => (
              <div key={a.id} className="group flex h-7 shrink-0 items-center gap-2 pl-[40px] pr-[14px] transition-colors duration-ui ease-ui hover:bg-line-soft">
                <span className="text-meta text-faint">allows</span>
                <span className="min-w-0 grow truncate font-mono text-[11px] text-text-2">{a.prefix}</span>
                <button type="button" aria-label={`Stop allowing ${a.prefix}`} onClick={() => onRemoveAllow?.(a.id)} className={iconButton}>
                  <XIcon />
                </button>
              </div>
            ))}
            {allowing === r.id ? (
              <div className="flex h-8 shrink-0 items-center gap-2 pl-[40px] pr-[14px]">
                <input
                  autoFocus
                  aria-label={`Page on ${r.value} to allow`}
                  placeholder={`${r.value.split("/")[0]}/@channel stays open`}
                  value={allowDraft}
                  onChange={(e) => setAllowDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submitAllow(r);
                    if (e.key === "Escape") setAllowing(null);
                  }}
                  className="h-[26px] min-w-0 grow rounded-control border border-line-input bg-transparent px-2 font-mono text-[11px] text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
                />
                <span className="font-mono text-[11px] text-faint">↵</span>
              </div>
            ) : null}
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
  const { editProfile, updateProfile, deleteProfile, addRule, removeRule, addSiteAllow, removeSiteAllow, launchProfile, showNotice } = useStore();
  const apps = useInstalledApps();
  const [picker, setPicker] = useState<"opens" | "seals" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [launching, setLaunching] = useState(false);

  const opens = opensOf(profile);
  const seals = sealsOf(profile);
  const added = useMemo(() => {
    const kind = picker === "opens" ? "launch_app" : "app";
    return new Set(profile.rules.filter((r) => r.kind === kind).map((r) => r.value));
  }, [picker, profile.rules]);

  const addUrl = async (text: string) => {
    const url = normalizeUrl(text);
    if (!url) {
      showNotice({ lead: `${text.trim()} is not a URL.` });
      return false;
    }
    return !!(await addRule(profile.id, { kind: "launch_url", value: url }));
  };

  const addSeal = async (text: string) => {
    const rule = classifySealInput(text);
    return !!rule && !!(await addRule(profile.id, rule));
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
        <div className="ml-auto flex items-center gap-3 pr-2">
          <span className="flex flex-col items-end gap-[2px]">
            <span className="text-body text-text">Allowlist mode</span>
            <span className="text-meta text-muted">Only apps this profile opens can start while sealed</span>
          </span>
          <Switch
            label="Allowlist mode"
            checked={profile.allowlistMode}
            onChange={(v) => void updateProfile(profile.id, { allowlistMode: v })}
          />
        </div>
      </div>

      <div className="grid min-h-0 grow grid-cols-2 gap-4">
        <RulePanel
          title="Opens"
          rules={opens}
          apps={apps}
          placeholder="Add a URL"
          empty="Nothing opens with this profile yet."
          onAddApp={() => setPicker("opens")}
          onSubmit={addUrl}
          onRemove={(r) => void removeRule(r.id)}
        />
        <RulePanel
          title="Seals"
          rules={seals}
          apps={apps}
          placeholder="Add a site or a title keyword"
          empty="Nothing is sealed yet."
          note={profile.allowlistMode ? "Allowlist mode is on. These still close, and new apps this profile does not open are closed as they start. What's already running stays." : undefined}
          onAddApp={() => setPicker("seals")}
          onSubmit={addSeal}
          onRemove={(r) => void removeRule(r.id)}
          onAllow={async (r, text) => !!(await addSiteAllow(r.id, text))}
          onRemoveAllow={(id) => void removeSiteAllow(id)}
        />
      </div>

      {picker ? (
        <AppPicker
          title={picker === "opens" ? "Add an app to open" : "Add an app to seal"}
          added={added}
          onClose={() => setPicker(null)}
          onPick={(a) =>
            void addRule(profile.id, {
              kind: picker === "opens" ? "launch_app" : "app",
              value: a.exe,
              label: a.name,
              path: a.launch,
            })
          }
        />
      ) : null}

      {confirmDelete ? (
        <Dialog label={`Delete ${profile.name}`} onClose={() => setConfirmDelete(false)}>
          <div className="flex flex-col gap-1 px-[18px] pb-4 pt-[18px]">
            <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">Delete {profile.name}</h1>
            <p className="m-0 text-body text-muted">Its launch set and seal rules are removed. Past sessions keep their history.</p>
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
