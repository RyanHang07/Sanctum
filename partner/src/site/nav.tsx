import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

// Moving between the site's pages without a reload (v0.2 site).

export function go(path: string) {
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
  scrollTo({ top: 0 });
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
    const [path, hash] = href.split("#");
    go(path || location.pathname);
    if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView());
  };
  return <a href={href} onClick={open} {...rest} />;
}
