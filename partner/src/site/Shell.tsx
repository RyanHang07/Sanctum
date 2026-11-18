import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { A, usePath } from "./nav";
import { DOWNLOAD, REPO, starCount, useStars } from "./releases";
import { useTheme } from "./theme";
import { useGrow, useSlidingIndicator, useSwap } from "./motion";

// The site's frame (v0.2): a top bar (Docs, Changelog, Partners, Download, light/dark) over
// every page, and a footer with the legal links. On a phone the links fold into a menu.
// Redesign (v0.4, S8): when the page follows a Sanctum theme (site/theme.ts), the light/dark
// switch steps aside. The partner pages (narrow) keep the footer to Privacy and GitHub: one
// decision per page. The frame stays put while pages swap inside it (site/motion.ts): the old
// page fades out, a beat, then the new one rises in, as the app's screens do.

const LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/changelog", label: "Changelog" },
  { href: "/partner", label: "Partners" },
];

/** The torii mark (design/logo): light ink on dark, dark ink on light; CSS shows the one that fits. */
export function Mark({ size }: { size: number }) {
  return (
    <>
      <img className="mark-on-dark" src="/mark.svg" width={size} height={size} alt="" />
      <img className="mark-on-light" src="/mark-light.svg" width={size} height={size} alt="" />
    </>
  );
}

function ThemeToggle({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  return (
    <button type="button" className="icon-button" aria-label={dark ? "Use the light theme" : "Use the dark theme"} title={dark ? "Light" : "Dark"} onClick={toggle}>
      {dark ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="8" cy="8" r="3" />
          <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

interface View {
  node: ReactNode;
  wide: boolean;
}

/**
 * The frame around every site page. `page` names what's inside: a new name swaps the content
 * (the old page stays drawn while it fades out); the same name updates it in place.
 */
export function Shell({ children, wide = true, page = "" }: { children: ReactNode; wide?: boolean; page?: string }) {
  const path = usePath();
  const { dark, toggle, app } = useTheme();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const here = (href: string) => path === href || path.startsWith(`${href}/`) || (href === "/partner" && /^\/(approve|invite)\//.test(path));

  // The page being shown trails `page` until the old one has faded out.
  const views = useRef(new Map<string, View>());
  views.current.set(page, { node: children, wide });
  const { ref, shown } = useSwap(page);
  for (const k of [...views.current.keys()]) if (k !== page && k !== shown) views.current.delete(k);
  const view = views.current.get(shown) ?? { node: children, wide };

  const links = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const active = LINKS.find((l) => here(l.href))?.href ?? null;
  useSlidingIndicator(links, indicator, active, String(menu));
  useGrow(links, menu);

  return (
    <div className="site">
      <header className="site-bar">
        <div className="site-bar-inner">
          <A href="/" className="site-logo" aria-label="Sanctum home">
            <Mark size={20} />
            <span>Sanctum</span>
          </A>
          <nav ref={links} className={`site-links ${menu ? "open" : ""}`} aria-label="Site">
            <span ref={indicator} className="site-links-indicator" aria-hidden="true" />
            {LINKS.map((l) => (
              <A key={l.href} href={l.href} data-indicator-item={l.href} data-rise="" aria-current={here(l.href) ? "page" : undefined}>
                {l.label}
              </A>
            ))}
            <a href={REPO} className="site-github" data-rise="">
              GitHub
            </a>
          </nav>
          <span className="grow" />
          {app ? null : <ThemeToggle dark={dark} toggle={toggle} />}
          <Stars />
          <a className="button primary site-download" href={DOWNLOAD}>
            Download
          </a>
          <button type="button" className="icon-button site-menu" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              {menu ? <path d="M4 4l8 8M12 4l-8 8" /> : <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />}
            </svg>
          </button>
        </div>
      </header>
      <div ref={ref} className={view.wide ? "site-main" : "site-main narrow"}>
        <Fragment key={shown}>{view.node}</Fragment>
      </div>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <span className="site-logo small-logo">
            <Mark size={16} />
            <span>Sanctum</span>
          </span>
          <span className="muted">Free and open source, MIT.</span>
          <span className="grow" />
          {view.wide ? (
            <>
              <A href="/docs">Docs</A>
              <A href="/changelog">Changelog</A>
            </>
          ) : null}
          <A href="/privacy">Privacy</A>
          {view.wide ? (
            <>
              <A href="/terms">Terms</A>
              <A href="/legal">Legal</A>
            </>
          ) : null}
          <a href={REPO}>GitHub</a>
        </div>
      </footer>
    </div>
  );
}

/** Star on GitHub, with the repo's count once it loads (2026-11-18). */
function Stars() {
  const stars = useStars();
  return (
    <a
      className="button ghost site-stars"
      href={REPO}
      aria-label={stars === null ? "Star Sanctum on GitHub" : `Star Sanctum on GitHub, ${stars} ${stars === 1 ? "star" : "stars"}`}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 1.75l1.9 3.85 4.25.62-3.08 3 .73 4.23L8 11.45l-3.8 2 .73-4.23-3.08-3 4.25-.62z" />
      </svg>
      <span>Star</span>
      {stars === null ? null : (
        <span className="site-stars-count" data-testid="star-count">
          {starCount(stars)}
        </span>
      )}
    </a>
  );
}
