import { useEffect, useState, type ReactNode } from "react";
import { A, usePath } from "./nav";
import { DOWNLOAD, REPO } from "./releases";
import { useTheme } from "./theme";

// The site's frame (v0.2): a top bar (Docs, Changelog, Partners, Download, light/dark) over
// every page, and a footer with the legal links. On a phone the links fold into a menu.

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

function ThemeToggle() {
  const { dark, toggle } = useTheme();
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

export function Shell({ children, wide = true }: { children: ReactNode; wide?: boolean }) {
  const path = usePath();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const here = (href: string) => path === href || path.startsWith(`${href}/`) || (href === "/partner" && /^\/(approve|invite)\//.test(path));
  return (
    <div className="site">
      <header className="site-bar">
        <div className="site-bar-inner">
          <A href="/" className="site-logo" aria-label="Sanctum home">
            <Mark size={20} />
            <span>Sanctum</span>
          </A>
          <nav className={`site-links ${menu ? "open" : ""}`} aria-label="Site">
            {LINKS.map((l) => (
              <A key={l.href} href={l.href} aria-current={here(l.href) ? "page" : undefined}>
                {l.label}
              </A>
            ))}
            <a href={REPO} className="site-github">
              GitHub
            </a>
          </nav>
          <span className="grow" />
          <ThemeToggle />
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
      <div className={wide ? "site-main" : "site-main narrow"}>{children}</div>
      <footer className="site-footer">
        <div className="site-footer-inner">
          <span className="site-logo small-logo">
            <Mark size={16} />
            <span>Sanctum</span>
          </span>
          <span className="faint">Free and open source, MIT.</span>
          <span className="grow" />
          <A href="/docs">Docs</A>
          <A href="/changelog">Changelog</A>
          <A href="/privacy">Privacy</A>
          <A href="/terms">Terms</A>
          <a href={REPO}>GitHub</a>
        </div>
      </footer>
    </div>
  );
}
