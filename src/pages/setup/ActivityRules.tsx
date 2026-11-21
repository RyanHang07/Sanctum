import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent } from "react";
import { Button, buttonClass } from "../../components/Button";
import { ChevronIcon, GlobeIcon, LockIcon, PlusIcon, TextIcon } from "../../components/icons";
import { Fold } from "../week/marks";
import { CATEGORY } from "../stats/parts";
import { Section } from "./parts";
import { useStore } from "../../state/store";
import { errorText, native } from "../../lib/native";
import { normalizeDomain } from "../../lib/rules";
import { gsap, RISE_FROM, RISE_STAGGER, RISE_TO, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";
import { CATEGORIES, type Category, type ClassRule, type Distraction, type NewDistraction } from "../../lib/types";

// Setup > Activity > How apps and sites count (decided 2026-11-16): three groups, one per
// category. Each group lists your own rules first; Sanctum's defaults sit in a quieter fold.
// A rule moves by dragging it to another group, or with its Move button (keyboard and touch).
// Distracting rules carry a Block button that adds them to Distractions.

/** What a typed pattern is: an exe name, a site, or a window-title keyword. */
export function ruleKindOf(input: string): { matchKind: ClassRule["matchKind"]; pattern: string } | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[^\s\\/]+\.exe$/i.test(s)) return { matchKind: "exe", pattern: s.toLowerCase() };
  const domain = !/\s/.test(s) ? normalizeDomain(s) : null;
  return domain ? { matchKind: "domain", pattern: domain } : { matchKind: "title", pattern: s };
}

/** The Distractions entry a rule becomes when it's blocked. */
export function distractionOf(r: Pick<ClassRule, "matchKind" | "pattern">): NewDistraction & { kind: Distraction["kind"] } {
  if (r.matchKind === "exe") return { kind: "app", value: r.pattern.toLowerCase() };
  if (r.matchKind === "domain") return { kind: "site", value: r.pattern.toLowerCase() };
  return { kind: "keyword", value: r.pattern.trim().toLowerCase() };
}

const blockKey = (d: { kind: string; value: string }) => `${d.kind}:${d.value.toLowerCase()}`;

const GROUP_HINT: Record<Category, string> = {
  productive: "Counts toward focus.",
  neutral: "Anything not listed is neutral.",
  distracting: "Counts against focus.",
};

const KIND_LABEL: Record<ClassRule["matchKind"], string> = { exe: "App", domain: "Site", title: "Title word" };

export function KindIcon({ kind }: { kind: ClassRule["matchKind"] }) {
  if (kind === "exe") {
    return (
      <span aria-hidden="true" className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-[4px] border border-line-input px-[3px] font-mono text-micro leading-none text-muted">
        EXE
      </span>
    );
  }
  const Icon = kind === "domain" ? GlobeIcon : TextIcon;
  return (
    <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center text-muted">
      <Icon size={14} />
    </span>
  );
}

function Dot({ c }: { c: Category }) {
  return <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY[c].dot}`} />;
}

// Controls that wait for hover show on keyboard focus, and always on touch screens.
const REVEAL =
  "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

function RuleRow({
  r,
  blocked,
  open,
  onToggle,
  onMove,
  onRemove,
  onBlock,
  onDragStart,
  onDragEnd,
}: {
  r: ClassRule;
  blocked: boolean;
  open: boolean;
  onToggle: () => void;
  onMove: (c: Category) => void;
  onRemove: () => void;
  onBlock: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => {
    onToggle();
    toggle.current?.focus();
  };
  return (
    <li
      data-rule={r.id}
      draggable={!open}
      onDragStart={(e) => {
        e.dataTransfer?.setData("text/plain", String(r.id));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className="flex flex-col"
    >
      <div className="group flex h-row items-center gap-[10px] px-[14px] transition-colors duration-ui ease-ui hover:bg-raised">
        <span title={KIND_LABEL[r.matchKind]} className="flex">
          <KindIcon kind={r.matchKind} />
        </span>
        <span className="min-w-0 grow truncate text-body text-text" title={r.pattern}>
          {r.pattern}
        </span>
        {r.category === "distracting" ? (
          blocked ? (
            <span className="flex shrink-0 items-center gap-1 px-2 text-meta text-muted" title="Blocked during focus. It's in Distractions.">
              <LockIcon size={11} className="text-sealed" />
              Blocked
            </span>
          ) : (
            <Button variant="ghost" size="sm" aria-label={`Block ${r.pattern}`} onClick={onBlock}>
              Block
            </Button>
          )
        ) : null}
        <button
          ref={toggle}
          type="button"
          data-move=""
          aria-label={`Move ${r.pattern}`}
          aria-expanded={open}
          onClick={onToggle}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted transition-[opacity,color,background-color] duration-ui ease-ui hover:bg-raised hover:text-text ${open ? "bg-raised text-text opacity-100" : REVEAL}`}
        >
          <ChevronIcon size={10} />
        </button>
      </div>
      {open ? (
        <div
          role="group"
          aria-label={`Move ${r.pattern} to`}
          onKeyDown={(e) => e.key === "Escape" && close()}
          className="flex flex-wrap items-center gap-[6px] px-[14px] pb-2 pl-[40px] pt-[2px]"
        >
          <span className="text-meta text-muted">Move to</span>
          {CATEGORIES.filter((c) => c !== r.category).map((c, i) => (
            <button
              key={c}
              type="button"
              autoFocus={i === 0}
              aria-label={`Move ${r.pattern} to ${CATEGORY[c].label}`}
              onClick={() => onMove(c)}
              className={buttonClass("ghost", "sm", "gap-[6px]")}
            >
              <Dot c={c} />
              {CATEGORY[c].label}
            </button>
          ))}
          <Button variant="danger-plain" size="sm" aria-label={`Remove ${r.pattern}`} onClick={onRemove}>
            Remove
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function AddField({ category, onAdd }: { category: Category; onAdd: (text: string, c: Category) => Promise<boolean> }) {
  const [draft, setDraft] = useState("");
  const kind = ruleKindOf(draft);
  return (
    <label className="mx-2 my-2 flex h-control items-center gap-2 focus-ring-within rounded-control border border-line-input bg-raised px-2 transition-colors duration-ui ease-ui focus-within:border-sealed hover:border-check-line">
      <PlusIcon className="shrink-0 text-muted" />
      <input
        aria-label={`Add to ${CATEGORY[category].label}`}
        placeholder="Add an app, site or title word"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && kind) void onAdd(draft, category).then((ok) => ok && setDraft(""));
        }}
        className="focus-ring-off h-full min-w-0 grow border-none bg-transparent text-body text-text placeholder:text-muted"
      />
      {kind ? <span className="shrink-0 text-meta text-muted">{KIND_LABEL[kind.matchKind]} ↵</span> : null}
    </label>
  );
}

export function ActivityRulesSection() {
  const showNotice = useStore((s) => s.showNotice);
  const distractions = useStore((s) => s.distractions);
  const loadDistractions = useStore((s) => s.loadDistractions);
  const flag = useStore((s) => s.flag);
  const [rules, setRules] = useState<ClassRule[] | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [defaultsOpen, setDefaultsOpen] = useState<Record<Category, boolean>>({ productive: false, neutral: false, distracting: false });
  const [dragging, setDragging] = useState<ClassRule | null>(null);
  const [over, setOver] = useState<Category | null>(null);
  const [landed, setLanded] = useState<{ id: number; focus: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { run } = useMotion(root);

  const reload = useCallback(() => void native.listClassRules().then(setRules).catch(() => setRules([])), []);
  useEffect(reload, [reload]);
  useEffect(() => void loadDistractions(), [loadDistractions]);

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      reload();
      return true;
    } catch (e) {
      showNotice({ lead: errorText(e) });
      reload();
      return false;
    }
  };

  const add = (text: string, category: Category) => {
    const kind = ruleKindOf(text);
    return kind ? guard(() => native.addClassRule({ ...kind, category })) : Promise.resolve(false);
  };

  const move = (r: ClassRule, category: Category, focus: boolean) => {
    if (r.category === category) return;
    // Moved rules are yours: they leave the defaults fold for the top of their new group.
    setRules((rs) => rs?.map((x) => (x.id === r.id ? { ...x, category, source: "user" as const } : x)) ?? rs);
    setOpenId(null);
    setLanded({ id: r.id, focus });
    // The list already shows the move; it reloads only if saving fails.
    native.setClassRuleCategory(r.id, category).catch((e) => {
      showNotice({ lead: errorText(e) });
      reload();
    });
  };

  const block = async (r: ClassRule) => {
    if (await flag(distractionOf(r))) showNotice({ lead: "Blocked during focus.", rest: "It's in Distractions now." });
  };

  const blocked = new Set(distractions.map(blockKey));

  // The groups cascade in once the rules arrive, as lists do elsewhere.
  const loaded = rules !== null;
  useGSAP(
    () => {
      if (!loaded || !root.current) return;
      const groups = root.current.querySelectorAll("[data-category]");
      if (groups.length) run(() => gsap.timeline({ id: "activity-rules" }).fromTo(groups, RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }));
    },
    { scope: root, dependencies: [loaded] },
  );

  // A moved rule rises into its new group; a keyboard move keeps focus on it.
  useLayoutEffect(() => {
    if (!landed || !root.current) return;
    const row = root.current.querySelector<HTMLElement>(`[data-rule="${landed.id}"]`);
    if (!row) return;
    run(() => gsap.timeline({ id: "activity-rule-landed" }).fromTo(row, RISE_FROM, RISE_TO));
    // Focus after the tween starts: GSAP can reparent an element while it reads its transform.
    if (landed.focus) row.querySelector<HTMLElement>("[data-move]")?.focus();
    setLanded(null);
  }, [landed, rules, run]);

  const dragOver = (c: Category) => (e: DragEvent) => {
    if (!dragging || dragging.category === c) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    if (over !== c) setOver(c);
  };
  const drop = (c: Category) => (e: DragEvent) => {
    e.preventDefault();
    const id = Number(e.dataTransfer?.getData("text/plain")) || dragging?.id;
    const r = rules?.find((x) => x.id === id);
    setOver(null);
    setDragging(null);
    if (r) move(r, c, false);
  };

  const row = (r: ClassRule) => (
    <RuleRow
      key={r.id}
      r={r}
      blocked={blocked.has(blockKey(distractionOf(r)))}
      open={openId === r.id}
      onToggle={() => setOpenId(openId === r.id ? null : r.id)}
      onMove={(c) => move(r, c, true)}
      onRemove={() => {
        setOpenId(null);
        void guard(() => native.removeClassRule(r.id));
      }}
      onBlock={() => void block(r)}
      onDragStart={() => setDragging(r)}
      onDragEnd={() => {
        setDragging(null);
        setOver(null);
      }}
    />
  );

  return (
    <Section title="How apps and sites count" action={<span className="text-meta text-muted">Drag between groups, or use Move</span>}>
      <div ref={root} className="@container">
        <div data-testid="activity-groups" className="grid grid-cols-1 @[720px]:grid-cols-3">
          {CATEGORIES.map((c, i) => {
            const items = rules?.filter((r) => r.category === c) ?? [];
            const own = items.filter((r) => r.source === "user");
            const defaults = items.filter((r) => r.source === "catalog");
            const target = dragging !== null && dragging.category !== c;
            const foldId = `activity-defaults-${c}`;
            return (
              <section
                key={c}
                aria-label={CATEGORY[c].label}
                data-category={c}
                onDragOver={dragOver(c)}
                onDragEnter={dragOver(c)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === c ? null : o));
                }}
                onDrop={drop(c)}
                className={`flex min-w-0 flex-col pb-1 transition-colors duration-ui ease-ui ${i > 0 ? "border-t border-line @[720px]:border-l @[720px]:border-t-0" : ""} ${
                  over === c ? "bg-sealed-tint" : target ? "bg-line-soft" : ""
                }`}
              >
                <div className="flex flex-col gap-[2px] px-[14px] pb-1 pt-3">
                  <h3 className="m-0 flex items-center gap-2 text-body font-semibold">
                    <Dot c={c} />
                    {CATEGORY[c].label}
                    <span className="font-mono text-meta font-normal text-muted">{items.length || ""}</span>
                  </h3>
                  <p className="m-0 text-meta text-muted">{GROUP_HINT[c]}</p>
                </div>
                <ul data-own="" aria-label={`Your ${CATEGORY[c].label.toLowerCase()} apps and sites`} className="m-0 flex list-none flex-col p-0">
                  {own.map(row)}
                </ul>
                <AddField category={c} onAdd={add} />
                {defaults.length ? (
                  <div className="flex flex-col">
                    <button
                      type="button"
                      aria-expanded={defaultsOpen[c]}
                      aria-controls={foldId}
                      onClick={() => setDefaultsOpen((o) => ({ ...o, [c]: !o[c] }))}
                      className="mx-[6px] flex h-8 items-center gap-2 rounded-control px-2 text-meta text-muted transition-colors duration-ui ease-ui hover:bg-raised hover:text-text-2"
                    >
                      <ChevronIcon size={10} className={`transition-transform duration-ui ease-ui ${defaultsOpen[c] ? "" : "-rotate-90"}`} />
                      Sanctum's defaults
                      <span className="font-mono">{defaults.length}</span>
                    </button>
                    <Fold open={defaultsOpen[c] || defaults.some((r) => r.id === openId)}>
                      <ul id={foldId} aria-label={`Sanctum's ${CATEGORY[c].label.toLowerCase()} defaults`} className="m-0 flex list-none flex-col p-0">
                        {defaults.map(row)}
                      </ul>
                    </Fold>
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
