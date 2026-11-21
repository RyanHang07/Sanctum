import { useRef, type ReactNode } from "react";
import pkg from "../../package.json";
import { Mark } from "./Mark";
import { AnimatedMark } from "./AnimatedMark";
import { JournalIcon, LockIcon, NotesIcon, FoldIcon, SetupIcon, StatsIcon, TodayIcon, TrackersIcon, WeekIcon } from "./icons";
import { TABS, type AppState, type TabId, isTabLocked } from "../state/appState";
import { useStore } from "../state/store";
import { NARROW, useMedia } from "../lib/useMedia";
import { DUR, EASE, gsap, useGSAP } from "../lib/gsap";
import { useMotion } from "../lib/useMotion";

const TAB_ICONS: Record<TabId, ReactNode> = {
  today: <TodayIcon />,
  week: <WeekIcon />,
  stats: <StatsIcon />,
  trackers: <TrackersIcon />,
  notes: <NotesIcon />,
  journal: <JournalIcon />,
  setup: <SetupIcon />,
};

const PILL: Record<AppState, { label: string; box: string; dot: string }> = {
  // Open is the enabled green (2026-11-20), the same dot as the tray and the extension.
  open: { label: "Open", box: "border-line-input bg-transparent text-text", dot: "bg-ok ring-[3px] ring-ok-tint" },
  sealed: {
    label: "Sealed",
    box: "border-sealed-line bg-sealed-tint text-text",
    dot: "bg-sealed ring-[3px] ring-sealed-tint",
  },
  event: {
    label: "In event",
    box: "border-event-line bg-event-tint text-text",
    dot: "bg-event ring-[3px] ring-event-tint",
  },
};

const version = "v" + pkg.version.split(".").slice(0, 2).join(".");

/** Fades what the rail hides; the sidebar's own width clips it (decided 2026-11-16). */
const fade = (collapsed: boolean) => `transition-opacity duration-enter ease-ui ${collapsed ? "pointer-events-none opacity-0" : "opacity-100"}`;

/**
 * One markup open and folded: the dot stays put (30px from the window's edge, the rail's
 * centre), and only the label fades as the box narrows with the sidebar.
 */
export function StatePill({ state, meta, compact = false }: { state: AppState; meta?: string; compact?: boolean }) {
  const p = PILL[state];
  const label = meta ? `${p.label} · ${meta}` : p.label;
  return (
    <div
      data-testid="state-pill"
      role={compact ? "status" : undefined}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={`flex h-control w-full items-center gap-[10px] overflow-hidden rounded-control border px-[11px] transition-colors duration-700 ${p.box}`}
    >
      <span className="flex w-4 shrink-0 justify-center">
        <span className={`h-[7px] w-[7px] rounded-full transition-colors duration-700 ${p.dot}`} />
      </span>
      <span aria-hidden={compact || undefined} className={`flex min-w-0 grow items-center gap-[10px] ${fade(compact)}`}>
        <span className="whitespace-nowrap text-meta font-medium">{p.label}</span>
        {meta ? <span className="ml-auto whitespace-nowrap font-mono text-meta text-muted">{meta}</span> : null}
      </span>
    </div>
  );
}

/**
 * The fold button. When the window is too narrow to open the sidebar (decided 2026-11-16), it
 * fades and shrinks away, out of the tab order, and comes back the same way when there's room.
 */
function CollapseButton({ collapsed, onClick, hidden = false, className = "" }: { collapsed: boolean; onClick: () => void; hidden?: boolean; className?: string }) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={!collapsed}
      aria-hidden={hidden || undefined}
      inert={hidden}
      data-unavailable={hidden || undefined}
      title={`${label} (Ctrl B)`}
      onClick={onClick}
      className={`group flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-faint transition-[color,background-color,opacity,transform] duration-state ease-glide hover:bg-raised hover:text-text-2 focus-visible:text-text-2 motion-reduce:transition-none ${
        // Fades without shrinking, so it stays a 28x28 target at every width (M12).
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      } ${className}`}
    >
      <FoldIcon className={collapsed ? "" : "rotate-180"} />
    </button>
  );
}

/**
 * The nav rows, with one active indicator that glides between them (motion spec §8). The
 * indicator draws the active row's background; the active icon takes the second color
 * (decided). Under reduced motion or a hidden window it jumps. It reads the active row's
 * offsetTop, so the same code serves the 220px sidebar and the 60px rail.
 */
function NavList({ collapsed }: { collapsed: boolean }) {
  const appState = useStore((s) => s.appState);
  const activeTab = useStore((s) => s.activeTab);
  const navigate = useStore((s) => s.navigate);
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const { live } = useMotion(root);
  const activeIndex = TABS.findIndex((t) => t.id === activeTab);

  useGSAP(
    () => {
      const el = indicator.current;
      const item = root.current?.querySelectorAll<HTMLElement>("[data-nav-item]")[activeIndex];
      if (!el || !item) return;
      const y = item.offsetTop; // read once per navigation
      // One transform tween per navigation; a new one takes over mid-glide (overwrite).
      // The first placement, and every move under reduced motion, lands without a glide.
      if (live && placed.current) gsap.to(el, { y, duration: DUR.state, ease: EASE.ui, overwrite: true });
      else gsap.set(el, { y, overwrite: true });
      placed.current = true;
    },
    { scope: root, dependencies: [activeIndex, live, collapsed] },
  );

  return (
    <div ref={root} className="relative flex flex-col gap-[2px]">
      <span
        ref={indicator}
        aria-hidden="true"
        data-nav-indicator=""
        hidden={activeIndex < 0}
        className="pointer-events-none absolute inset-x-0 top-0 h-control rounded-control bg-raised"
      />
      {TABS.map((t) => {
        const on = t.id === activeTab;
        const locked = isTabLocked(appState, t.id);
        const tone = on
          ? "text-text font-medium"
          : locked
            ? "text-locked cursor-not-allowed"
            : "text-muted hover:bg-raised hover:text-text-2";
        const tip = locked ? `${t.label} is locked while you're sealed` : `${t.label} (${t.key})`;
        return (
          <button
            key={t.id}
            type="button"
            data-nav-item={t.id}
            aria-current={on ? "page" : undefined}
            aria-disabled={locked || undefined}
            aria-description={locked ? "Locked while sealed" : undefined}
            aria-label={collapsed ? t.label : undefined}
            title={collapsed ? tip : undefined}
            onClick={() => navigate(t.id)}
            className={`relative flex h-control items-center gap-[10px] overflow-hidden rounded-control px-[12px] text-left text-body transition-colors duration-ui ease-ui ${tone}`}
          >
            <span
              data-nav-icon=""
              className={`flex w-4 shrink-0 justify-center transition-colors duration-ui ease-ui ${on ? "text-second [[data-scheme=light]_&]:text-second-text" : ""}`}
            >
              {TAB_ICONS[t.id]}
            </span>
            {locked ? <LockIcon size={9} className={`absolute bottom-[5px] left-[30px] transition-opacity duration-enter ease-ui ${collapsed ? "opacity-100" : "opacity-0"}`} /> : null}
            <span aria-hidden={collapsed || undefined} className={`flex min-w-0 grow items-center gap-[10px] ${fade(collapsed)}`}>
              <span className="grow whitespace-nowrap">{t.label}</span>
              {locked ? <LockIcon /> : <span className="font-mono text-micro text-muted">{t.key}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * App sidebar (design/screens/Sidebar.dc.html). Collapses to an icon rail (Ctrl B); the
 * choice is remembered. Collapsed, labels move into tooltips and the pill becomes its dot.
 */
export function Sidebar({ pillMeta }: { pillMeta?: string }) {
  const appState = useStore((s) => s.appState);
  const sealed = appState === "sealed";
  // A narrow window (a vertical monitor) folds it to the rail whatever the setting says.
  const narrow = useMedia(NARROW);
  const collapsed = useStore((s) => s.settings.sidebarCollapsed) || narrow;
  const toggle = useStore((s) => s.toggleSidebar);

  return (
    <nav
      aria-label="Sanctum"
      data-collapsed={collapsed || undefined}
      className={`box-border flex h-full shrink-0 flex-col gap-[18px] overflow-hidden border-r border-line bg-sidebar px-[10px] py-4 transition-[width] duration-enter ease-ui ${
        collapsed ? "w-sidebar-rail" : "w-sidebar"
      }`}
    >
      <div className="flex h-7 items-center pl-[11px]">
        <div className="flex min-w-0 grow items-center gap-[10px] text-text">
          {sealed ? (
            <span className="flex text-text">
              <AnimatedMark size={18} mode="breathe" label="Sanctum, sealed" keyClass="text-sealed" />
            </span>
          ) : (
            <Mark size={18} />
          )}
          <span aria-hidden={collapsed || undefined} className={`grow whitespace-nowrap text-[14px] font-semibold tracking-[-0.01em] ${fade(collapsed)}`}>
            Sanctum
          </span>
        </div>
      </div>

      <StatePill state={appState} meta={pillMeta} compact={collapsed} />

      <NavList collapsed={collapsed} />

      <div className="grow" />

      <div
        className="group/sidebar-bottom mt-auto flex min-h-7 items-center justify-between gap-2 pl-[6px] pr-2 text-faint"
      >
        <CollapseButton collapsed={collapsed} onClick={toggle} hidden={narrow} />
        <span
          // The rail keeps only its button: the version slides in with the expanded sidebar, not on hover.
          aria-hidden={collapsed || undefined}
          className={`overflow-hidden whitespace-nowrap font-mono text-micro text-muted transition-all duration-ui ease-ui ${
            collapsed ? "max-w-0 opacity-0" : "max-w-[64px] opacity-100"
          }`}
        >
          {version}
        </span>
      </div>
    </nav>
  );
}
