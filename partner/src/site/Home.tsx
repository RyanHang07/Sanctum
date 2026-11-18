import { useRef, type ReactNode } from "react";
import { A } from "./nav";
import { DOWNLOAD, REPO, useReleases } from "./releases";
import { useTabTitle } from "../title";
import { useReveal } from "./motion";
import { ThemePreview } from "./ThemePreview";
import { THEMES } from "../../../src/theme/themes";
import hero from "../../../docs/screenshots/sanctum.webp";
import overlay from "../../../docs/screenshots/blocked-overlay.png";
import extension from "../../../docs/screenshots/extension-blocked.png";
import approve from "../../../docs/screenshots/partner-approve.png";
import week from "../../../docs/screenshots/week.png";
import notes from "../../../docs/screenshots/notes.png";
import journal from "../../../docs/screenshots/journal.png";
import stats from "../../../docs/screenshots/stats.png";
import trackers from "../../../docs/screenshots/trackers.png";

// The home page (v0.2 site; flat and quiet since v0.4): what Sanctum is, shown with the app's own
// screenshots, and the download. Copy follows SPEC.md, docs/guide, and CHANGELOG.md v0.4.0.
// Headlines are one plain sentence (design/README.md). Sections rise in as they scroll into view,
// their parts 40ms apart (site/motion.ts).

function Shot({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return <img className={`shot ${className}`} src={src} alt={alt} loading="lazy" decoding="async" />;
}

function Feature({ label, title, children, media, flip = false, id }: { label: string; title: string; children: ReactNode; media: ReactNode; flip?: boolean; id?: string }) {
  return (
    <section className={`feature ${flip ? "flip" : ""}`} id={id} data-reveal="">
      <div className="feature-text">
        <span className="label" data-rise="">
          {label}
        </span>
        <h2 className="headline" data-rise="">
          {title}
        </h2>
        {children}
      </div>
      <div className="feature-media" data-rise="">
        {media}
      </div>
    </section>
  );
}

function Download({ note = true }: { note?: boolean }) {
  const releases = useReleases();
  const latest = releases.kind === "ready" ? releases.list[0] : undefined;
  return (
    <div className="download">
      <div className="row">
        <a className="button primary large" href={latest?.installer ?? DOWNLOAD}>
          Download for Windows
        </a>
        <A className="button ghost large" href="/docs/install">
          How to install
        </A>
      </div>
      {note ? <span className="small">{latest ? `${latest.tag}, free for Windows 10 and 11.` : "Free for Windows 10 and 11."}</span> : null}
    </div>
  );
}

export function Home() {
  useTabTitle(null);
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <div className="home" ref={root}>
      <section className="hero">
        <div className="hero-text">
          <h1 className="headline">Seal yourself in and finish what you started.</h1>
          <p className="lede">A focus app for Windows that closes what distracts you and keeps it closed until the time is up.</p>
          <Download />
        </div>
        <img
          className="shot hero-shot"
          src={hero}
          alt="Entering focus: the seal closes, Discord is caught and sent back, and the session ends with Sanctum held."
          decoding="async"
        />
      </section>

      <ul className="proof" aria-label="At a glance" data-reveal="">
        {[
          ["Closes flagged apps", "Within a fraction of a second."],
          ["Blocks sites and tabs", "In Chrome, Edge, Brave, and Comet."],
          ["Reopens if closed", "Within seconds, with App Guard."],
          ["Stays on your PC", "No tracking, no ads."],
        ].map(([a, b]) => (
          <li key={a} data-rise="">
            <strong>{a}</strong>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <Feature
        label="The seal"
        title="It holds even when you don't."
        media={
          <div className="stack-shots">
            <Shot src={overlay} alt="Discord stays sealed: the overlay a blocked app gets" />
            <Shot src={extension} alt="youtube.com stays sealed: the extension's blocked page" className="offset" />
          </div>
        }
      >
        <p data-rise="">One Distractions list covers apps, sites, links, and title keywords.</p>
        <ul className="ticks" data-rise="">
          <li>Idle time pauses the countdown, so 60 minutes sealed is 60 minutes of work.</li>
          <li>App Guard, an optional Windows service, blocks sites in every browser and reopens Sanctum mid-seal.</li>
          <li>Moving the clock or stopping the guard breaks the seal, and it still holds to its planned end.</li>
        </ul>
        <A className="more" href="/docs/the-seal" data-rise="">
          How the seal works
        </A>
      </Feature>

      <Feature
        flip
        id="partner"
        label="Leaving early"
        title="Someone else holds the key."
        media={<Shot src={approve} alt="The partner's approve page on a phone: the reason, time left, a PIN, Deny or Approve" className="phone" />}
      >
        <p data-rise="">Getting out early is a climb, not a button.</p>
        <ol className="ladder">
          <li data-rise="">
            <span>
              <strong>Say why.</strong> A written reason, then a 5-minute wait.
            </span>
          </li>
          <li data-rise="">
            <span>
              <strong>Mean it.</strong> Retype a paragraph, exactly.
            </span>
          </li>
          <li data-rise="">
            <span>
              <strong>Ask.</strong> Your partner answers from their phone with a PIN only they know.
            </span>
          </li>
        </ol>
        <p className="muted" data-rise="">
          A partner is optional, and nothing else needs an account.
        </p>
        <A className="more" href="/docs/partners" data-rise="">
          Being a partner
        </A>
      </Feature>

      <Feature label="Your day" title="The plan sits next to the button." media={<Shot src={week} alt="Week: seven days of routines, tasks, and calendar events" />}>
        <p data-rise="">Today measures your focused minutes on a ruler, with your goal as one tall tick.</p>
        <ul className="ticks" data-rise="">
          <li>One fixed top slot holds the next focus block or the task you linked.</li>
          <li>Tag a block with a profile and Today suggests it when it starts.</li>
          <li>Google Calendar syncs both ways, and Next up counts down to what's next.</li>
        </ul>
        <A className="more" href="/docs/planning" data-rise="">
          Today and Week
        </A>
      </Feature>

      <Feature
        flip
        label="Notes and journal"
        title="Write it down and keep it yours."
        media={
          <div className="stack-shots">
            <Shot src={notes} alt="Notes: a block note with bullets and a checklist" />
            <Shot src={journal} alt="Journal: today's page under its prompt" className="offset" />
          </div>
        }
      >
        <p data-rise="">Notes with headings, checklists, tables, images, and links to your tasks.</p>
        <ul className="ticks" data-rise="">
          <li>The journal starts on one screen: an optional lock, then the page.</li>
          <li>New journals come with starter prompts you can change.</li>
          <li>Look back at older pages from a calendar, or search them.</li>
        </ul>
        <p className="muted" data-rise="">
          Share a note as an encrypted, read-only link that expires when you choose.
        </p>
        <A className="more" href="/docs/notes" data-rise="">
          Notes and sharing
        </A>
      </Feature>

      <Feature
        label="Review"
        title="See where the time went."
        media={
          <div className="stack-shots">
            <Shot src={stats} alt="Stats: the week on a ruler against the daily goal, and where time went" />
            <Shot src={trackers} alt="Trackers: weight, sleep, and mood charts" className="offset" />
          </div>
        }
      >
        <p data-rise="">Streaks, focus against your daily goal, and how your time split between productive, neutral, and distracting.</p>
        <ul className="ticks" data-rise="">
          <li>Every session is kept for good, with what was blocked and how it ended.</li>
          <li>Time by app and by site, and one click to call any of them productive or distracting.</li>
          <li>A weekly recap, off by default; turn it on in Setup › Goals.</li>
        </ul>
        <p className="muted" data-rise="">
          Trackers cover anything else: numbers, yes or no, 1 to 10, or text.
        </p>
        <A className="more" href="/docs/stats" data-rise="">
          Stats in depth
        </A>
      </Feature>

      <Feature flip id="themes" label="Themes" title="Pick a look and every window follows." media={<ThemePreview />}>
        <p data-rise="">{THEMES.length} themes, each with its own accent and second color, from Sanctum Dark and Light to Nord, Dracula, and Catppuccin.</p>
        <p className="muted" data-rise="">
          Follow Windows switches between your dark and light picks with the system.
        </p>
        <A className="more" href="/docs/themes" data-rise="">
          Themes
        </A>
      </Feature>

      <section className="pillars" aria-label="Principles" data-reveal="">
        <h2 className="headline" data-rise="">
          Local first and open by default.
        </h2>
        <div className="pillar-grid">
          <div className="pillar" data-rise="">
            <strong>Stays on your PC</strong>
            <p>Sessions, activity, notes, the journal, and stats live in a database on your PC.</p>
          </div>
          <div className="pillar" data-rise="">
            <strong>Open source</strong>
            <p>
              Every line is on <a href={REPO}>GitHub</a> under the MIT license.
            </p>
          </div>
          <div className="pillar" data-rise="">
            <strong>No account needed</strong>
            <p>An account is only for a partner and note sharing, and shared notes are encrypted before they leave your PC.</p>
          </div>
        </div>
        <p className="legal-links" data-rise="">
          <A href="/privacy">Privacy policy</A>
          <A href="/terms">Terms of service</A>
          <A href="/legal">License and notices</A>
        </p>
      </section>

      <section className="closing" data-reveal="">
        <h2 className="headline" data-rise="">
          The work is waiting.
        </h2>
        <div data-rise="">
          <Download note={false} />
        </div>
        <p className="small" data-rise="">
          Sanctum isn't code-signed yet, so if Windows warns you, choose <strong>More info</strong>, then <strong>Run anyway</strong>.
        </p>
      </section>
    </div>
  );
}
