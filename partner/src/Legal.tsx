import type { ReactNode } from "react";

// The public pages Google's OAuth consent screen links to (v0.1): the home page (site/Home.tsx;
// /about still lands there), /privacy, and /terms; and /legal (v0.3, site/LegalPage.tsx).
// Plain, factual, and kept in step with what the code actually does.

export const CONTACT = "ryan.hang3r@gmail.com";
export const OPERATOR = "Ryan Hang";
export const UPDATED = "October 29, 2026";
const REPO = "https://github.com/ryanhang07/sanctum";
export const SITE = "https://sanctum-desktop.vercel.app";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

export function Privacy() {
  return (
    <>
      <h1 className="headline">
        Privacy <em>policy.</em>
      </h1>
      <p className="small">Last updated {UPDATED}</p>
      <p className="muted">
        Sanctum is a Windows app made by {OPERATOR}, with this site ({SITE.replace("https://", "")}) and an optional account. This policy says what each
        part collects, where it goes, and how to delete it. Sanctum has no ads, no analytics, and never sells data.
      </p>

      <Section title="What stays on your PC">
        <p>
          Your focus sessions, profiles, Distractions list, tasks and routines, trackers, notes and their images, your journal, your theme, stats, and the
          activity Sanctum notices (which app and window is in front) are stored in a database on your own PC. None of it is sent to us. The journal is
          never shared or synced; its optional lock (Windows Hello or a PIN) keeps people at your PC out, and isn't encryption. Start over in Setup erases
          it all, and so does uninstalling with your data folder removed.
        </p>
      </Section>

      <Section title="The browser extension">
        <p>
          The extension blocks what you flagged while you're sealed. It reports to the app on your PC only the active tab's domain (never the full
          address or the page's title), so Stats can sort your time by site, and the sites it blocked. It keeps your theme to draw its own pages. None of
          it leaves your PC.
        </p>
      </Section>

      <Section title="Updates">
        <p>
          Sanctum checks GitHub Releases for a new version a little after it starts and every 6 hours, and downloads one when there is. GitHub sees the
          request like any download (your IP address); nothing about you or your use of Sanctum is sent.
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
        <p>Only if you sign in (with Google or an email link) to use an accountability partner or to share notes, Sanctum stores, on Supabase:</p>
        <ul>
          <li>your email address, display name, and time zone;</li>
          <li>who your partner is, and the people you're a partner for, plus any open invite links;</li>
          <li>your partner PIN, as a one-way hash (it can't be read back);</li>
          <li>unlock requests: your reason, the session's profile name and planned end, and your partner's answer and note;</li>
          <li>notifications for your partner, such as a broken seal or an emergency unlock;</li>
          <li>notes you share, only while their link lasts (see below).</li>
        </ul>
        <p>
          Signing in with Google for the account shares only your name and email address. Your activity, tasks, and history are never uploaded, with or
          without an account.
        </p>
      </Section>

      <Section title="Shared notes">
        <p>
          When you share a note, the app encrypts it and its images on your PC before anything is uploaded. The key is the part of the link after{" "}
          <span className="mono">#</span>, which browsers never send to a server, so Sanctum's servers hold only ciphertext that nobody, including us, can
          read. Images are stripped of their hidden data (location, camera, times) first. Anyone you give the link to can read the note until it
          expires (1 hour, 1 day, or 7 days, as you choose). Stopping the share, deleting the note, or the link expiring removes the shared copy.
        </p>
      </Section>

      <Section title="Who handles it">
        <ul>
          <li>Supabase hosts the account database and sign-in.</li>
          <li>Vercel hosts this site.</li>
          <li>GitHub hosts Sanctum's code, releases, and updates.</li>
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
          hashes. Shared notes are end-to-end encrypted (AES-256-GCM). Updates are signed, and Sanctum installs only signed ones.
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
        These terms cover the Sanctum app, its browser extension, the optional account, and this site, all made by {OPERATOR}. Using them means you
        accept these terms.
      </p>

      <Section title="Free and open source">
        <p>
          Sanctum is free. Its code is published under the <a href={`${REPO}/blob/main/LICENSE`}>MIT License</a>, which governs your use of the code.
          The libraries it uses keep their own licenses; see <a href="/legal">Legal</a>.
        </p>
      </Section>

      <Section title="What Sanctum does to your PC">
        <p>
          While you're sealed, Sanctum closes apps you flagged, blocks sites, and can turn on Windows Do Not Disturb. If you turn on Protection, a Windows
          service blocks sites in the hosts file and reopens Sanctum, and, if you choose, closes flagged apps run as administrator. Apps it closes don't
          get a chance to save. You choose what gets flagged; keep your work saved.
        </p>
      </Section>

      <Section title="Updates">
        <p>
          Sanctum downloads new versions in the background and installs one when you click Restart to update (never while you're sealed). Updates are
          signed by the project and come from its GitHub Releases.
        </p>
      </Section>

      <Section title="Sharing notes">
        <p>
          A shared link lets anyone who has it read the note until it expires or you stop it. You're responsible for what you share and who you share it
          with; don't share anything you don't have the right to, or anything unlawful. Shares that misuse the service can be removed.
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
        <p>Google, GitHub, Supabase, Vercel, and Brevo have their own terms, which apply when you use them through Sanctum.</p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If these terms change, this page changes and its date moves. Questions: <Mail />.
        </p>
      </Section>
    </>
  );
}
