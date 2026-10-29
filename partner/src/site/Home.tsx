import type { ReactNode } from "react";
import { A } from "./nav";
import { DOWNLOAD, REPO, useReleases } from "./releases";
import { useTabTitle } from "../title";
import hero from "../../../docs/screenshots/sanctum.webp";
import overlay from "../../../docs/screenshots/blocked-overlay.png";
import extension from "../../../docs/screenshots/extension-blocked.png";
import approve from "../../../docs/screenshots/partner-approve.png";
import week from "../../../docs/screenshots/week.png";
import notes from "../../../docs/screenshots/notes.png";
import stats from "../../../docs/screenshots/stats.png";
import trackers from "../../../docs/screenshots/trackers.png";

// The home page (v0.2 site): what Sanctum is, shown with the app's own screenshots, and the
// download. Copy follows SPEC.md (the ladder as changed 2026-10-06, a daily emergency unlock).

function Headline({ lead, payoff, as: Tag = "h2" }: { lead: string; payoff: string; as?: "h1" | "h2" }) {
  return (
    <Tag className="headline">
      {lead} <em>{payoff}</em>
    </Tag>
  );
}

function Shot({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return <img className={`shot ${className}`} src={src} alt={alt} loading="lazy" decoding="async" />;
}

function Feature({ kicker, lead, payoff, children, media, flip = false, id }: { kicker: string; lead: string; payoff: string; children: ReactNode; media: ReactNode; flip?: boolean; id?: string }) {
  return (
    <section className={`feature ${flip ? "flip" : ""}`} id={id}>
      <div className="feature-text">
        <span className="kicker">{kicker}</span>
        <Headline lead={lead} payoff={payoff} />
        {children}
      </div>
      <div className="feature-media">{media}</div>
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
      {note ? (
        <span className="small">
          {latest ? `${latest.tag} · ` : ""}Windows 10 and 11 · Free, no account needed
        </span>
      ) : null}
    </div>
  );
}

export function Home() {
  useTabTitle(null);
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-mesh" aria-hidden="true" />
        <div className="hero-text">
          <Headline as="h1" lead="Seal yourself in." payoff="Finish what you started." />
          <p className="lede">
            A focus app for Windows that holds. Pick what you're working on and enter focus: Sanctum opens what the work needs, closes what distracts you, and keeps the
            door shut until the time is up. Getting out early takes real effort, or a friend's approval.
          </p>
          <Download />
        </div>
        <img
          className="shot hero-shot"
          src={hero}
          alt="Entering focus: the seal closes, Discord is caught and sent back, and the session ends with Sanctum held."
          decoding="async"
        />
      </section>

      <div className="proof" role="list">
        {[
          ["Closes flagged apps", "within a fraction of a second"],
          ["Blocks sites and tabs", "in Chrome, Edge, Brave, and Comet"],
          ["Survives restarts", "and comes back if it's killed"],
          ["Stays on your PC", "no tracking, no ads"],
        ].map(([a, b]) => (
          <div key={a} role="listitem">
            <strong>{a}</strong>
            <span>{b}</span>
          </div>
        ))}
      </div>

      <Feature
        kicker="The seal"
        lead="It holds."
        payoff="Even when you don't."
        media={
          <div className="stack-shots">
            <Shot src={overlay} alt="Discord stays sealed: the overlay a blocked app gets" />
            <Shot src={extension} alt="youtube.com stays sealed: the extension's blocked page" className="offset" />
          </div>
        }
      >
        <p>One Distractions list covers apps, sites, links, and title keywords. Open one while sealed and it closes, with a note that sends you back to the work.</p>
        <ul className="ticks">
          <li>Idle time pauses the countdown, so a 60-minute seal is 60 minutes of work.</li>
          <li>Protection, a small Windows service, blocks sites in every browser and reopens Sanctum within seconds.</li>
          <li>Changing the clock or stopping the guard mid-seal breaks it, and it's logged.</li>
        </ul>
        <A className="more" href="/docs/the-seal">
          How the seal works →
        </A>
      </Feature>

      <Feature
        flip
        id="partner"
        kicker="Leaving early"
        lead="Someone else"
        payoff="holds the key."
        media={<Shot src={approve} alt="The partner's approve page on a phone: the reason, time left, a PIN, Approve or Deny" className="phone" />}
      >
        <p>Getting out early is a climb, not a button.</p>
        <ol className="ladder">
          <li>
            <strong>Say why.</strong> A written reason, then a 5-minute wait.
          </li>
          <li>
            <strong>Mean it.</strong> Retype a paragraph, exactly.
          </li>
          <li>
            <strong>Ask.</strong> With a partner, they get an email and answer from their phone with a PIN only they know.
          </li>
        </ol>
        <p className="muted">The partner is optional. Everything else works without an account.</p>
        <A className="more" href="/docs/partners">
          Being a partner →
        </A>
      </Feature>

      <Feature kicker="Your day" lead="The plan sits" payoff="next to the button." media={<Shot src={week} alt="Week: seven days of routines, tasks, and calendar events" />}>
        <p>Routines, one-time tasks, and Google Calendar, synced both ways. Tag a block with a profile and Home suggests it when it starts. A meeting holds focus, and the next session can wait for it to end.</p>
        <A className="more" href="/docs/planning">
          Today and Week →
        </A>
      </Feature>

      <Feature
        flip
        kicker="Notes and journal"
        lead="Write it down."
        payoff="Keep it yours."
        media={<Shot src={notes} alt="Notes: a note with headings, lists, and checkboxes" />}
      >
        <p>Notes with headings, checklists, tables, images, and links to your tasks. A journal with a page a day, the day's focus at the top, optional prompts, and a lock.</p>
        <p className="muted">Share a note as a live, read-only link that's end-to-end encrypted and expires when you choose.</p>
        <A className="more" href="/docs/notes">
          Notes and sharing →
        </A>
      </Feature>

      <Feature
        kicker="Review"
        lead="See where"
        payoff="the time went."
        media={
          <div className="stack-shots">
            <Shot src={stats} alt="Stats: streaks, daily focus against the goal, and where time went" />
            <Shot src={trackers} alt="Trackers: weight, sleep, and mood charts" className="offset" />
          </div>
        }
      >
        <p>Streaks, focus against your daily goal, what tempted you most, and how your time split between productive, neutral, and distracting. Trackers for anything else: numbers, yes or no, 1 to 10, or text.</p>
      </Feature>

      <section className="pillars" aria-label="Principles">
        <Headline lead="Local first." payoff="Open by default." />
        <div className="pillar-grid">
          <div className="pillar">
            <strong>Stays on your PC</strong>
            <p>Sessions, activity, tasks, notes, the journal, and stats live in a database on your PC. None of it is uploaded.</p>
          </div>
          <div className="pillar">
            <strong>Open source</strong>
            <p>
              Every line is on <a href={REPO}>GitHub</a> under the MIT license. Read it, build it, change it.
            </p>
          </div>
          <div className="pillar">
            <strong>No account needed</strong>
            <p>
              An account exists only for the partner and note sharing. It holds your email, partner links, and a hashed PIN. <A href="/privacy">Privacy policy</A>.
            </p>
          </div>
        </div>
      </section>

      <section className="closing">
        <Headline lead="The work is waiting." payoff="Start the seal." />
        <Download />
        <p className="small">
          Sanctum isn't code-signed yet, so Windows may say it protected your PC. Choose <strong>More info</strong>, then <strong>Run anyway</strong>.
        </p>
      </section>
    </div>
  );
}
