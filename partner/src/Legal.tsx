import type { ReactNode } from "react";

// The public pages Google's OAuth consent screen links to (v0.1): /about (the home page),
// /privacy, and /terms. Plain, factual, and kept in step with what the code actually does.

export const CONTACT = "ryan.hang3r@gmail.com";
export const OPERATOR = "Ryan Hang";
export const UPDATED = "September 30, 2026";
const REPO = "https://github.com/ryanhang07/sanctum";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

export function About() {
  return (
    <>
      <h1 className="headline">
        Seal yourself in. <em>Finish what you started.</em>
      </h1>
      <p className="muted">
        Sanctum is a free, open-source focus app for Windows. Pick a profile, enter focus, and Sanctum opens what the work needs, closes what you flagged as
        distracting, blocks distracting sites, and holds the seal until the time is up. Breaking out early takes real effort, or a friend's approval.
      </p>
      <div className="legal-list">
        <p>
          <strong>Profiles and a seal that holds.</strong> Flagged apps close as they open; sites and tabs are blocked in the browser.
        </p>
        <p>
          <strong>Today and Week.</strong> Tasks and routines, with optional two-way Google Calendar sync.
        </p>
        <p>
          <strong>Stats, trackers, and notes.</strong> All of it stays on your PC.
        </p>
        <p>
          <strong>An optional accountability partner.</strong> A friend holds a PIN, approves early exits, and hears when a seal breaks. This site is
          where partners answer.
        </p>
      </div>
      <div className="row">
        <a className="button primary" href={`${REPO}/releases/latest`}>
          Download for Windows
        </a>
        <a className="button ghost" href={REPO}>
          Source code
        </a>
      </div>
      <p className="small">
        Made by {OPERATOR}. Questions: <Mail />.
      </p>
    </>
  );
}

export function Privacy() {
  return (
    <>
      <h1 className="headline">
        Privacy <em>policy.</em>
      </h1>
      <p className="small">Last updated {UPDATED}</p>
      <p className="muted">
        Sanctum is a Windows app made by {OPERATOR}, with this partner site and an optional account. This policy says what each part collects, where it
        goes, and how to delete it. Sanctum has no ads, no analytics, and never sells data.
      </p>

      <Section title="What stays on your PC">
        <p>
          Your focus sessions, profiles, Distractions list, tasks and routines, trackers, notes, stats, and the activity Sanctum notices (which app and
          window is in front) are stored in a database on your own PC. None of it is sent to us. Start over in Setup erases it, and so does uninstalling
          with your data folder removed.
        </p>
      </Section>

      <Section title="Google Calendar">
        <p>
          If you connect Google Calendar in the app, Sanctum asks for your email address and access to your calendars (the{" "}
          <span className="mono">calendar</span> scope). It uses that access only to show your events in Today and Week, to create and edit the events
          you add or change in Sanctum, and to keep a calendar named Sanctum for your routines and tasks.
        </p>
        <p>
          Calendar data travels directly between your PC and Google. It's kept on your PC to show your schedule, and is never sent to Sanctum's servers or
          anyone else. The sign-in token is stored in Windows Credential Manager. Disconnect in Setup › Calendar, or revoke access any time at{" "}
          <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.
        </p>
        <p>
          Sanctum's use and transfer of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use
          requirements.
        </p>
      </Section>

      <Section title="The optional account">
        <p>Only if you sign in (with Google or an email link) to use an accountability partner, Sanctum stores, on Supabase:</p>
        <ul>
          <li>your email address, display name, and time zone;</li>
          <li>who your partner is, and the people you're a partner for, plus any open invite links;</li>
          <li>your partner PIN, as a one-way hash (it can't be read back);</li>
          <li>unlock requests: your reason, the session's profile name and planned end, and your partner's answer and note;</li>
          <li>notifications for your partner, such as a broken seal or an emergency unlock.</li>
        </ul>
        <p>
          Signing in with Google for the account shares only your name and email address. Your activity, tasks, and history are never uploaded, with or
          without an account.
        </p>
      </Section>

      <Section title="Who handles it">
        <ul>
          <li>Supabase hosts the account database and sign-in.</li>
          <li>Vercel hosts this site.</li>
          <li>Brevo sends sign-in links, invites, and partner emails.</li>
          <li>Google provides Google sign-in and Calendar.</li>
        </ul>
        <p>Each handles data only to provide its part of the service.</p>
      </Section>

      <Section title="Keeping and deleting it">
        <p>
          Account data is kept until you delete the account. Delete it any time from Setup › Partner in the app, or from your partners page on this
          site: your profile, partner links, PIN, requests, and notifications are deleted right away. You can also email <Mail /> and it will be deleted
          within 30 days.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Connections are encrypted (HTTPS). Database rules let each account see only its own data and its partner links. PINs are stored as Argon2
          hashes.
        </p>
      </Section>

      <Section title="Children">
        <p>Sanctum isn't directed at children under 13, and doesn't knowingly collect their data.</p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If this policy changes, this page changes and its date moves. Questions or requests: <Mail />.
        </p>
      </Section>
    </>
  );
}

export function Terms() {
  return (
    <>
      <h1 className="headline">
        Terms of <em>service.</em>
      </h1>
      <p className="small">Last updated {UPDATED}</p>
      <p className="muted">
        These terms cover the Sanctum app, the optional account, and this partner site, all made by {OPERATOR}. Using them means you accept these terms.
      </p>

      <Section title="Free and open source">
        <p>
          Sanctum is free. Its code is published under the <a href={`${REPO}/blob/main/LICENSE`}>MIT License</a>, which governs your use of the code.
        </p>
      </Section>

      <Section title="What Sanctum does to your PC">
        <p>
          While you're sealed, Sanctum closes apps you flagged, blocks sites, and can turn on Windows Do Not Disturb. If you turn on Protection, a Windows
          service blocks sites in the hosts file and reopens Sanctum, and, if you choose, closes flagged apps run as administrator. Apps it closes don't
          get a chance to save. You choose what gets flagged; keep your work saved.
        </p>
      </Section>

      <Section title="The account and your partner">
        <p>
          Keep your PIN private. Use invites and partner emails only with people who agreed to be your partner, never to send spam or to harass. Accounts
          that misuse the service can be suspended or deleted.
        </p>
      </Section>

      <Section title="No warranty">
        <p>
          Sanctum is provided as is, without warranties of any kind. It may not catch every distraction, and the online services may change, pause, or
          end. To the extent the law allows, {OPERATOR} isn't liable for lost work, lost data, or other damages from using Sanctum.
        </p>
      </Section>

      <Section title="Other services">
        <p>Google, Supabase, Vercel, and Brevo have their own terms, which apply when you use them through Sanctum.</p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If these terms change, this page changes and its date moves. Questions: <Mail />.
        </p>
      </Section>
    </>
  );
}

/** Links on every page: the home page, privacy, and terms. */
export function Footer() {
  return (
    <footer className="legal-footer">
      <a href="/about">About</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
    </footer>
  );
}
