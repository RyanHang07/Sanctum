import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { REPO, useReleases, type Release } from "./releases";
import { useTabTitle } from "../title";

// The changelog (v0.2 site): every published release, newest first, from GitHub. Each release's
// notes are its CHANGELOG.md section (the release workflow writes them), then an "## Install"
// part for GitHub's page, which this page leaves out.

/** A release's changes: its notes up to the install part (or nothing, for install-only notes). */
export function changesOf(notes: string): string {
  const cut = notes.split(/^## Install\b/m)[0]!.trim();
  return /^Download the `-setup\.exe`/.test(cut) ? "" : cut;
}

const COMPONENTS: Components = {
  // The version is the heading; the section's own top heading would repeat it.
  h1: () => null,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  a: ({ href = "", children }) =>
    /^(https?:|mailto:)/.test(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  img: () => null,
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function Entry({ r, latest }: { r: Release; latest: boolean }) {
  const changes = changesOf(r.notes);
  return (
    <section className="release" id={r.tag} aria-labelledby={`${r.tag}-title`}>
      <div className="release-meta">
        <h2 id={`${r.tag}-title`}>
          <a href={`#${r.tag}`}>{r.tag}</a>
        </h2>
        <time dateTime={r.date}>{day(r.date)}</time>
        {latest ? <span className="pill">Latest</span> : null}
      </div>
      <div className="release-body">
        {changes ? (
          <div className="prose">
            <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
              {changes}
            </Markdown>
          </div>
        ) : (
          <p className="muted">This release has no notes here yet.</p>
        )}
        <div className="row">
          {r.installer ? (
            <a className="button ghost" href={r.installer}>
              Download {r.tag}
            </a>
          ) : null}
          <a className="more" href={r.url}>
            On GitHub →
          </a>
        </div>
      </div>
    </section>
  );
}

export function Changelog() {
  useTabTitle("Changelog");
  const releases = useReleases();
  return (
    <div className="changelog">
      <header className="changelog-head">
        <h1 className="headline">
          What changed. <em>Release by release.</em>
        </h1>
        <p className="lede">
          Sanctum updates itself; this is what each update brought. Follow along on <a href={`${REPO}/releases`}>GitHub Releases</a>.
        </p>
      </header>
      {releases.kind === "loading" ? <p className="muted">Loading releases…</p> : null}
      {releases.kind === "offline" ? (
        <p className="muted">
          Can't reach GitHub right now. The releases are at <a href={`${REPO}/releases`}>github.com/ryanhang07/sanctum/releases</a>.
        </p>
      ) : null}
      {releases.kind === "ready" ? releases.list.map((r, i) => <Entry key={r.tag} r={r} latest={i === 0} />) : null}
    </div>
  );
}
