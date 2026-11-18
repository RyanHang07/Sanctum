import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { landAt } from "./motion";

// Moving between the site's pages without a reload (v0.2 site). The page swap (site/motion.ts)
// scrolls to the top, or to the link's #heading, once the new page is in.

export function go(href: string) {
  const [path, hash] = href.split("#");
  history.pushState(null, "", `${path || location.pathname}${hash ? `#${hash}` : ""}`);
  dispatchEvent(new PopStateEvent("popstate"));
  landAt(hash || null);
}

/** The current path, updated on every move (and the browser's back and forward). */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}

/** A link inside the site: a plain <a>, so it opens in a new tab too, moved without a reload. */
export function A({ href = "/", onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    // Same-page anchors scroll as usual.
    if (href.startsWith("#")) return;
    e.preventDefault();
    go(href);
  };
  return <a href={href} onClick={open} {...rest} />;
}
