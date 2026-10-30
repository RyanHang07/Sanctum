import { useRef, type CSSProperties, type ReactNode } from "react";
import { A } from "./nav";
import { DOWNLOAD, REPO, useReleases } from "./releases";
import { useTabTitle } from "../title";
import { useHomeMotion } from "./homeMotion";
import hero from "../../../docs/screenshots/sanctum.webp";
import overlay from "../../../docs/screenshots/blocked-overlay.png";
import extension from "../../../docs/screenshots/extension-blocked.png";
import approve from "../../../docs/screenshots/partner-approve.png";
import week from "../../../docs/screenshots/week.png";
import notes from "../../../docs/screenshots/notes.png";
import journal from "../../../docs/screenshots/journal.png";
import stats from "../../../docs/screenshots/stats.png";
import trackers from "../../../docs/screenshots/trackers.png";

// The home page (v0.2 site): what Sanctum is, shown with the app's own screenshots, and the
// download. Copy follows SPEC.md (the ladder as changed 2026-10-06, a daily emergency unlock).

/** A stagger index for a revealed element (home-motion.css). */
const at = (i: number) => ({ "--i": i }) as CSSProperties;

function Headline({ lead, payoff, as: Tag = "h2" }: { lead: string; payoff: string; as?: "h1" | "h2" }) {
  return (
    <Tag className="headline">
      {lead} <em>{payoff}</em>
    </Tag>
  );
}

/** The hero's headline, word by word, so the words can arrive in turn. */
function HeroHeadline({ lead, payoff }: { lead: string; payoff: string }) {
  const words = (text: string, from: number) =>
    text.split(" ").map((w, i) => (
      <span key={i}>
        <span className="w" style={at(from + i)}>
          {w}
        </span>{" "}
      </span>
    ));
  const leadWords = lead.split(" ").length;
  return (
    <h1 className="headline">
      {words(lead, 0)}
      <em>{words(payoff, leadWords)}</em>
    </h1>
  );
}

function Shot({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return <img className={`shot ${className}`} src={src} alt={alt} loading="lazy" decoding="async" />;
}

function Feature({ kicker, lead, payoff, children, media, flip = false, id }: { kicker: string; lead: string; payoff: string; children: ReactNode; media: ReactNode; flip?: boolean; id?: string }) {
  return (
    <section className={`feature ${flip ? "flip" : ""}`} id={id}>
      <div className="feature-text" data-reveal={flip ? "right" : "left"}>
        <span className="kicker">{kicker}</span>
        <Headline lead={lead} payoff={payoff} />
        {children}
      </div>
      <div className="feature-media" data-reveal="zoom" style={at(1)}>
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
  const root = useRef<HTMLDivElement>(null);
  useHomeMotion(root);
  return (
    <div className="home" ref={root}>
      <section className="hero">
        <div className="hero-mesh" aria-hidden="true">
          <span className="blob" />
          <span className="blob" />
          <span className="blob" />
          <span className="blob" />
        </div>
        <div className="hero-text">
          <HeroHeadline lead="Seal yourself in." payoff="Finish what you started." />
          <p className="lede">
            A focus app for Windows that holds. Pick what you're working on and enter focus: Sanctum opens what the work needs, closes what distracts you, and keeps the
            door shut until the time is up. Getting out early takes real effort, or a friend's approval.
          </p>
          <Download />
        </div>
        <div className="hero-stage">
          <img
            className="shot hero-shot"
            src={hero}
            alt="Entering focus: the seal closes, Discord is caught and sent back, and the session ends with Sanctum held."
            decoding="async"
          />
        </div>
      </section>

      <div className="proof" role="list">
        {[
          ["Closes flagged apps", "within a fraction of a second"],
          ["Blocks sites and tabs", "in Chrome, Edge, Brave, and Comet"],
          ["Survives restarts", "and comes back if it's killed"],
          ["Stays on your PC", "no tracking, no ads"],
        ].map(([a, b], i) => (
          <div key={a} role="listitem" className="spot" data-reveal="" style={at(i)}>
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
        <ol className="ladder" data-reveal="">
          <li className="spot" style={at(0)}>
            <strong>Say why.</strong> A written reason, then a 5-minute wait.
          </li>
          <li className="spot" style={at(1)}>
            <strong>Mean it.</strong> Retype a paragraph, exactly.
          </li>
          <li className="spot" style={at(2)}>
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
        media={
          <div className="stack-shots">
            <Shot src={notes} alt="Notes: a block note with bullets and a checklist" />
            <Shot src={journal} alt="Journal: today's page under the evening prompts" className="offset" />
          </div>
        }
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
        <div data-reveal="">
          <Headline lead="Local first." payoff="Open by default." />
        </div>
        <div className="pillar-grid">
          <div className="pillar spot" data-reveal="" style={at(0)}>
            <strong>Stays on your PC</strong>
            <p>Sessions, activity, tasks, notes, the journal, and stats live in a database on your PC. None of it is uploaded.</p>
          </div>
          <div className="pillar spot" data-reveal="" style={at(1)}>
            <strong>Open source</strong>
            <p>
              Every line is on <a href={REPO}>GitHub</a> under the MIT license. Read it, build it, change it.
            </p>
          </div>
          <div className="pillar spot" data-reveal="" style={at(2)}>
            <strong>No account needed</strong>
            <p>
              An account exists only for the partner and note sharing. It holds your email, partner links, and a hashed PIN. <A href="/privacy">Privacy policy</A>.
            </p>
          </div>
        </div>
      </section>

      <section className="closing" data-reveal="zoom">
        <Headline lead="The work is waiting." payoff="Start the seal." />
        <Download />
        <p className="small">
          Sanctum isn't code-signed yet, so Windows may say it protected your PC. Choose <strong>More info</strong>, then <strong>Run anyway</strong>.
        </p>
      </section>
    </div>
  );
}
