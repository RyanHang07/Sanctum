import type { ReactNode } from "react";
import pkg from "../../package.json";
import { Mark } from "./Mark";
import { LockIcon, PanelIcon, SetupIcon, StatsIcon, TodayIcon, TrackersIcon, WeekIcon } from "./icons";
import { TABS, type AppState, type TabId, isTabLocked } from "../state/appState";
import { useStore } from "../state/store";

const TAB_ICONS: Record<TabId, ReactNode> = {
  today: <TodayIcon />,
  week: <WeekIcon />,
  stats: <StatsIcon />,
  trackers: <TrackersIcon />,
  setup: <SetupIcon />,
};

const PILL: Record<AppState, { label: string; box: string; dot: string }> = {
  open: { label: "Open", box: "border-line bg-transparent text-text-2", dot: "bg-open" },
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

export function StatePill({ state, meta, compact = false }: { state: AppState; meta?: string; compact?: boolean }) {
  const p = PILL[state];
  const label = meta ? `${p.label} · ${meta}` : p.label;
  if (compact) {
    return (
      <div data-testid="state-pill" role="status" aria-label={label} title={label} className={`flex h-control items-center justify-center rounded-control border ${p.box}`}>
        <span className={`h-[7px] w-[7px] rounded-full ${p.dot}`} />
      </div>
    );
  }
  return (
    <div data-testid="state-pill" className={`flex h-control items-center gap-2 rounded-control border px-[10px] ${p.box}`}>
      <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${p.dot}`} />
      <span className="text-meta font-medium">{p.label}</span>
      {meta ? <span className="ml-auto font-mono text-meta text-muted">{meta}</span> : null}
    </div>
  );
}

function CollapseButton({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={!collapsed}
      title={`${label} (Ctrl B)`}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control text-faint transition-colors duration-ui ease-ui hover:bg-line-soft hover:text-text-2"
    >
      <PanelIcon />
    </button>
  );
}

/**
 * App sidebar (design/screens/Sidebar.dc.html). Collapses to an icon rail (Ctrl B); the
 * choice is remembered. Collapsed, labels move into tooltips and the pill becomes its dot.
 */
export function Sidebar({ pillMeta }: { pillMeta?: string }) {
  const appState = useStore((s) => s.appState);
  const activeTab = useStore((s) => s.activeTab);
  const navigate = useStore((s) => s.navigate);
  const displayName = useStore((s) => s.settings.displayName);
  const collapsed = useStore((s) => s.settings.sidebarCollapsed);
  const toggle = useStore((s) => s.toggleSidebar);

  return (
    <nav
      aria-label="Sanctum"
      data-collapsed={collapsed || undefined}
      className={`box-border flex h-full shrink-0 flex-col gap-[18px] overflow-hidden border-r border-line bg-sidebar py-4 transition-[width,padding] duration-enter ease-ui ${
        collapsed ? "w-sidebar-rail px-[10px]" : "w-sidebar px-3"
      }`}
    >
      <div className={`flex h-7 items-center gap-[10px] ${collapsed ? "justify-center" : "pl-2"}`}>
        <Mark size={18} />
        {collapsed ? null : (
          <>
            <span className="grow whitespace-nowrap text-[14px] font-semibold tracking-[-0.01em]">Sanctum</span>
            <CollapseButton collapsed={false} onClick={toggle} />
          </>
        )}
      </div>

      <StatePill state={appState} meta={pillMeta} compact={collapsed} />

      <div className="flex flex-col gap-[2px]">
        {TABS.map((t) => {
          const on = t.id === activeTab;
          const locked = isTabLocked(appState, t.id);
          const tone = on
            ? "bg-raised text-text font-medium"
            : locked
              ? "text-locked cursor-not-allowed"
              : "text-muted hover:bg-line-soft hover:text-text-2";
          const tip = locked ? `${t.label} is locked while you're sealed` : `${t.label} (${t.key})`;
          return (
            <button
              key={t.id}
              type="button"
              aria-current={on ? "page" : undefined}
              aria-disabled={locked || undefined}
              aria-label={collapsed ? t.label : undefined}
              title={collapsed ? tip : undefined}
              onClick={() => navigate(t.id)}
              className={`relative flex h-control items-center gap-[10px] rounded-control text-left text-body transition-colors duration-ui ease-ui ${
                collapsed ? "justify-center" : "px-[10px]"
              } ${tone}`}
            >
              <span className="flex w-4 shrink-0 justify-center">{TAB_ICONS[t.id]}</span>
              {collapsed ? (
                locked ? (
                  <LockIcon size={9} className="absolute bottom-[5px] right-[7px]" />
                ) : null
              ) : (
                <>
                  <span className="grow whitespace-nowrap">{t.label}</span>
                  {locked ? <LockIcon /> : <span className="font-mono text-[11px] text-faint">{t.key}</span>}
                </>
              )}
            </button>
          );
        })}
      </div>

      <div className="grow" />

      {collapsed ? (
        <div className="flex justify-center">
          <CollapseButton collapsed onClick={toggle} />
        </div>
      ) : (
        <div className="flex items-center gap-2 px-2 text-meta text-faint">
          {displayName ? (
            <>
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-text-2">
                {displayName[0]!.toUpperCase()}
              </span>
              <span className="whitespace-nowrap">{displayName}</span>
            </>
          ) : null}
          <span className="ml-auto font-mono text-[11px]">{version}</span>
        </div>
      )}
    </nav>
  );
}
