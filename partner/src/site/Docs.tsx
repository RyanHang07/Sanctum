import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { A, go } from "./nav";
import { REPO } from "./releases";
import { useTabTitle } from "../title";
import { ThemePreview } from "./ThemePreview";

// The docs (v0.2 site). Pages are Markdown in the repo (docs/guide/*.md, plus
// docs/self-hosting.md), bundled at build time and drawn with react-markdown, which never
// inserts raw HTML. A page's title is its "# " line; its "## " lines make "On this page".

const files = import.meta.glob<string>(["../../../docs/guide/*.md", "../../../docs/self-hosting.md"], { query: "?raw", import: "default", eager: true });
const source = (slug: string) => Object.entries(files).find(([path]) => path.endsWith(`/${slug}.md`))?.[1] ?? null;

const SECTIONS: { title: string; pages: string[] }[] = [
  { title: "Getting started", pages: ["install", "first-setup", "extension", "first-seal"] },
  { title: "Using Sanctum", pages: ["profiles", "the-seal", "leaving-early", "protection", "planning", "notes", "journal", "stats", "themes", "keyboard"] },
  { title: "Partners", pages: ["partners", "add-a-partner"] },
  { title: "Help", pages: ["faq", "troubleshooting", "self-hosting"] },
];

interface Page {
  slug: string;
  title: string;
  section: string;
  text: string;
  headings: { id: string; text: string }[];
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const PAGES: Page[] = SECTIONS.flatMap((sec) =>
  sec.pages.flatMap((slug) => {
    const text = source(slug);
    if (text === null) return [];
    const title = /^# (.+)$/m.exec(text)?.[1]?.trim() ?? slug;
    const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => ({ id: slugify(m[1]!), text: m[1]!.replace(/[`*_]/g, "").trim() }));
    return [{ slug, title, section: sec.title, text, headings }];
  }),
);

/** Text of a heading's children, for its id. */
function plain(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(plain).join("");
  if (children && typeof children === "object" && "props" in children) return plain((children as { props: { children?: ReactNode } }).props.children);
  return "";
}

const COMPONENTS: Components = {
  // The page title is drawn by the page itself.
  h1: () => null,
  h2: ({ children }) => <h2 id={slugify(plain(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={slugify(plain(children))}>{children}</h3>,
  a: ({ href = "", children }) =>
    href.startsWith("/") ? (
      <A href={href}>{children}</A>
    ) : /^(https?:|mailto:)/.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : href.startsWith("#") ? (
      <a href={href}>{children}</a>
    ) : (
      <>{children}</>
    ),
  table: ({ children }) => (
    <div className="doc-table">
      <table>{children}</table>
    </div>
  ),
  // Images in docs come from GitHub's copy of the repo (docs/ paths are relative there).
  img: () => null,
};

/** Search over titles, headings, and text; the best matches first. */
function search(q: string): { page: Page; heading?: { id: string; text: string } }[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { page: Page; heading?: { id: string; text: string }; score: number }[] = [];
  for (const page of PAGES) {
    const title = page.title.toLowerCase();
    const body = page.text.toLowerCase();
    if (!words.every((w) => body.includes(w) || title.includes(w))) continue;
    scored.push({ page, score: words.filter((w) => title.includes(w)).length * 10 + 1 });
    for (const h of page.headings) {
      if (words.some((w) => h.text.toLowerCase().includes(w))) scored.push({ page, heading: h, score: words.filter((w) => h.text.toLowerCase().includes(w)).length * 5 });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 8);
}

function Search() {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => search(q), [q]);
  useEffect(() => {
    // "/" focuses search, as on most docs sites.
    const on = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
  const open = (r: (typeof results)[number]) => {
    setQ("");
    go(`/docs/${r.page.slug}`);
    if (r.heading) requestAnimationFrame(() => document.getElementById(r.heading!.id)?.scrollIntoView());
  };
  return (
    <div className="doc-search">
      <input
        ref={input}
        type="search"
        placeholder="Search docs"
        aria-label="Search docs"
        value={q}
        onChange={(e) => (setQ(e.target.value), setAt(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setAt((a) => Math.min(a + 1, results.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setAt((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter" && results[at]) open(results[at]);
          else if (e.key === "Escape") setQ("");
        }}
      />
      <kbd>/</kbd>
      {q.trim() ? (
        <ul className="doc-results" role="listbox" aria-label="Results">
          {results.length ? (
            results.map((r, i) => (
              <li key={`${r.page.slug}#${r.heading?.id ?? ""}`} role="option" aria-selected={i === at}>
                <button type="button" onMouseEnter={() => setAt(i)} onClick={() => open(r)}>
                  <strong>{r.heading?.text ?? r.page.title}</strong>
                  <span>{r.heading ? `${r.page.title} · ${r.page.section}` : r.page.section}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="none">Nothing matches “{q.trim()}”.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

function Sidebar({ slug }: { slug: string | null }) {
  return (
    <nav className="doc-nav" aria-label="Docs">
      {SECTIONS.map((sec) => (
        <div key={sec.title} className="doc-nav-group">
          <span className="doc-nav-title">{sec.title}</span>
          {PAGES.filter((p) => p.section === sec.title).map((p) => (
            <A key={p.slug} href={`/docs/${p.slug}`} aria-current={p.slug === slug ? "page" : undefined}>
              {p.title}
            </A>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Highlights the heading being read in "On this page". */
function useReading(ids: string[]): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(null);
    if (!ids.length) return;
    const seen = new Set<string>();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id));
        const first = ids.find((x) => seen.has(x));
        if (first) setId(first);
      },
      { rootMargin: "-64px 0px -60% 0px" },
    );
    ids.forEach((x) => {
      const el = document.getElementById(x);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, [ids]);
  return id;
}

function Index() {
  useTabTitle("Docs");
  return (
    <article className="doc-page">
      <h1 className="headline">
        How Sanctum <em>works.</em>
      </h1>
      <p className="lede">From installing to your first seal, leaving early, and being someone's partner.</p>
      <div className="doc-cards">
        {SECTIONS.map((sec) => (
          <section key={sec.title} className="doc-card">
            <strong>{sec.title}</strong>
            {PAGES.filter((p) => p.section === sec.title).map((p) => (
              <A key={p.slug} href={`/docs/${p.slug}`}>
                {p.title}
              </A>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}

export function Docs({ slug }: { slug: string | null }) {
  const index = PAGES.findIndex((p) => p.slug === slug);
  const page = PAGES[index];
  useTabTitle(page ? `${page.title} · Docs` : slug ? "Not found" : "Docs");
  const ids = useMemo(() => page?.headings.map((h) => h.id) ?? [], [page]);
  const reading = useReading(ids);
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [slug]);
  const prev = index > 0 ? PAGES[index - 1] : undefined;
  const next = index >= 0 ? PAGES[index + 1] : undefined;

  return (
    <div className="docs">
      <aside className={`doc-side ${menu ? "open" : ""}`}>
        <Search />
        <button type="button" className="doc-menu ghost" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          {page ? page.title : "All pages"} <span aria-hidden="true">▾</span>
        </button>
        <Sidebar slug={slug} />
      </aside>
      {!slug ? (
        <Index />
      ) : !page ? (
        <article className="doc-page">
          <h1 className="headline">
            No such page. <em>Try the search.</em>
          </h1>
          <A href="/docs">All docs</A>
        </article>
      ) : (
        <>
          <article className="doc-page" key={page.slug}>
            <span className="kicker">{page.section}</span>
            <h1 className="doc-title">{page.title}</h1>
            <div className="prose">
              <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
                {page.text}
              </Markdown>
              {/* The Themes page lets you try them (v0.3). */}
              {page.slug === "themes" ? (
                <div className="doc-preview">
                  <ThemePreview />
                </div>
              ) : null}
            </div>
            <div className="doc-pager">
              {prev ? (
                <A href={`/docs/${prev.slug}`} className="prev">
                  <span>Previous</span>
                  {prev.title}
                </A>
              ) : (
                <span />
              )}
              {next ? (
                <A href={`/docs/${next.slug}`} className="next">
                  <span>Next</span>
                  {next.title}
                </A>
              ) : null}
            </div>
            <a className="doc-edit" href={`${REPO}/blob/main/docs/${page.slug === "self-hosting" ? "" : "guide/"}${page.slug}.md`}>
              Edit this page on GitHub
            </a>
          </article>
          {page.headings.length > 1 ? (
            <nav className="doc-toc" aria-label="On this page">
              <span className="doc-nav-title">On this page</span>
              {page.headings.map((h) => (
                <a key={h.id} href={`#${h.id}`} aria-current={h.id === reading ? "location" : undefined}>
                  {h.text}
                </a>
              ))}
            </nav>
          ) : (
            <span />
          )}
        </>
      )}
    </div>
  );
}
