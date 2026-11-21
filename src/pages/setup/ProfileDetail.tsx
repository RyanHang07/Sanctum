import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { AppIcon, Dialog } from "../../components/controls";
import { ChevronIcon, GlobeIcon, PlusIcon, XIcon } from "../../components/icons";
import { AppPicker } from "./AppPicker";
import { Section } from "./parts";
import { useStore } from "../../state/store";
import { errorText, native } from "../../lib/native";
import { durationsMin } from "../../theme/tokens";
import { useInstalledApps } from "../../lib/installedApps";
import { distractionLabel, normalizeUrl, opensOf, ruleLabel, ruleMeta } from "../../lib/rules";
import type { InstalledApp, Profile, Rule } from "../../lib/types";

const isApp = (r: Rule) => r.kind === "launch_app";

/** "1 keyword", "6 sites". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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
    "flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted opacity-0 transition-[opacity,background-color,color] duration-ui ease-ui hover:bg-line hover:text-danger-text focus-visible:opacity-100 focus-visible:text-danger-text group-hover:opacity-100 group-focus-within:opacity-100";
  return (
    <section aria-label={title} className="flex flex-col overflow-hidden rounded-panel border border-line bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-[14px]">
        <h2 className="m-0 text-body font-semibold text-text">{title}</h2>
        <span className="font-mono text-meta text-muted">{rules.length}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onAddApp}>
          Add app
        </Button>
      </div>
      <div className="flex flex-col py-1">
        {rules.length === 0 ? <p className="m-0 px-[14px] py-2 text-meta text-muted">{empty}</p> : null}
        {rules.map((r) => (
          <div key={r.id} className="flex shrink-0 flex-col">
            <div className="group flex h-row shrink-0 items-center gap-[10px] px-[14px] transition-colors duration-ui ease-ui hover:bg-raised focus-within:bg-raised">
              <RuleIcon rule={r} apps={apps} />
              {/* The name keeps its room (up to about half the row); a long link takes what's left
                  and truncates first (2026-11-20). */}
              <span data-rule-name className="min-w-0 max-w-[55%] shrink-0 truncate text-body text-text">{ruleLabel(r)}</span>
              <span data-rule-meta className="min-w-0 flex-1 basis-0 truncate font-mono text-micro text-muted">
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
        <PlusIcon className="text-muted" />
        <input
          aria-label={placeholder}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="h-full min-w-0 grow border-none bg-transparent text-body text-text placeholder:text-muted"
        />
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
        className="h-control w-[260px] rounded-control border border-line-input bg-raised pl-[56px] pr-3 text-body font-medium text-text transition-colors duration-ui ease-ui hover:border-check-line focus:border-sealed"
      />
    </label>
  );
}

/** The profile's if-then plan (v0.3.2): set once here, and every catch in its seals says it back. */
function PlanField({ profile }: { profile: Profile }) {
  const showNotice = useStore((s) => s.showNotice);
  const [plan, setPlan] = useState("");
  // What's saved, once it's known: a failed read must never save a blank over the real plan.
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void native.focusPrepare(profile.id, null).then(
      (p) => {
        if (!live) return;
        setPlan(p.plan ?? "");
        setSaved(p.plan ?? "");
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [profile.id]);
  const commit = async () => {
    if (saved === null || plan.trim() === saved) return;
    try {
      const now = (await native.focusSetPlan(profile.id, plan)) ?? "";
      setPlan(now);
      setSaved(now);
    } catch (e) {
      showNotice({ lead: errorText(e) });
    }
  };
  return (
    <label className="relative flex basis-full items-center">
      <span className="pointer-events-none absolute left-[10px] text-meta text-muted">If I’m tempted, I’ll</span>
      <input
        aria-label="If I'm tempted, I'll"
        value={plan}
        maxLength={200}
        placeholder="stand up and stretch"
        onChange={(e) => setPlan(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="h-control w-full rounded-control border border-line-input bg-raised pl-[132px] pr-3 text-body text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line focus:border-sealed"
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

  // Inside Setup's column like any section (2026-11-17): a way back, the name as the section
  // heading with its actions, then the same boxes and spacing as the rest of Setup.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Button variant="quiet" size="sm" className="-ml-2 self-start" onClick={() => editProfile(null)}>
          <ChevronIcon size={12} className="rotate-90" />
          Profiles
        </Button>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-[2px]">
            <h2 className="m-0 truncate text-[16px] font-semibold tracking-[-0.01em]">{profile.name}</h2>
            <p className="m-0 text-body text-muted">What it opens, for how long.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="raised" size="sm" onClick={() => void testLaunch()} disabled={launching || opens.length === 0}>
              {launching ? "Opening" : "Test launch"}
            </Button>
            <Button variant="danger-quiet" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </div>
        </div>
      </div>

      <Section title="Details">
        <div className="flex flex-wrap items-center gap-2 p-[14px]">
        <NameField profile={profile} />
        <label className="relative flex items-center">
          <span className="pointer-events-none absolute left-[10px] text-meta text-muted">For</span>
          <select
            aria-label="Default duration"
            value={profile.defaultMinutes}
            onChange={(e) => void updateProfile(profile.id, { defaultMinutes: Number(e.target.value) })}
            className="h-control w-[124px] cursor-pointer appearance-none rounded-control border border-line-input bg-raised pl-[38px] pr-[30px] font-mono text-body text-text transition-colors duration-ui ease-ui hover:border-check-line focus-visible:border-sealed"
          >
            {durationsMin.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
          <ChevronIcon className="pointer-events-none absolute right-[10px] text-muted" />
        </label>
        <PlanField key={profile.id} profile={profile} />
        </div>
      </Section>

      <div className="grid grid-cols-[minmax(0,1fr)_240px] items-start gap-4">
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
        <Section title="Seals">
          <div className="flex flex-col gap-3 p-[14px]">
            <p className="m-0 text-body text-muted">Your Distractions list. What this opens stays open.</p>
            <span className="font-mono text-meta text-text-2">
              {plural(count("app"), "app")} · {plural(count("site"), "site")} · {plural(count("keyword"), "keyword")}
            </span>
            {distractions.length ? (
              // One name once: Discord the app and discord.com the site both read Discord.
              <span data-testid="seal-names" className="truncate text-meta text-muted">{[...new Set(distractions.map(distractionLabel))].slice(0, 6).join(", ")}</span>
            ) : null}
            <Button variant="ghost" size="sm" className="self-start" onClick={() => openSetup("distractions")}>
              Edit distractions
            </Button>
          </div>
        </Section>
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
        <Dialog label={`Delete ${profile.name}`} alert onClose={() => setConfirmDelete(false)}>
          <div className="flex flex-col gap-1 px-[18px] pb-4 pt-[18px]">
            <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">This deletes {profile.name}.</h1>
            <p className="m-0 text-body text-muted">Its launch set is removed. Past sessions keep their history.</p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
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
