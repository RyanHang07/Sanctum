import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { EVENTS, errorText, native, onNative } from "../../lib/native";
import type { CloudStatus, PartnerStatus } from "../../lib/types";
import { useStore } from "../../state/store";
import { Row, Section } from "./parts";

// Setup > Account (SPEC 4.6, M6): the optional account, and the accountability partner who
// approves early unlocks. Sanctum works fully without either.

function hoursLeft(iso: string): string {
  const h = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
  return h <= 1 ? "Expires within the hour" : `Expires in ${h} hours`;
}

function SignIn({ status, onError }: { status: CloudStatus; onError: (e: string) => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (status.connecting) {
    return (
      <Row label={sentTo ? `Check ${sentTo}` : "Finish signing in in your browser"} hint={sentTo ? "Open the sign-in link on this PC. It works for 15 minutes." : undefined}>
        <Button variant="quiet" size="sm" onClick={() => void native.cloudCancelSignIn()}>
          Cancel
        </Button>
      </Row>
    );
  }
  const sendLink = async () => {
    try {
      await native.cloudSignInEmail(email);
      setSentTo(email.trim());
    } catch (e) {
      onError(errorText(e));
    }
  };
  return (
    <div className="flex flex-col gap-2 px-[14px] py-3">
      <p className="m-0 text-meta text-muted">Optional. An account lets a friend approve early unlocks and hear when a seal breaks. Nothing else leaves this PC.</p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void native.cloudSignInGoogle().catch((e) => onError(errorText(e)))}>
          Continue with Google
        </Button>
        <span className="text-meta text-faint">or</span>
        <input
          aria-label="Email for a sign-in link"
          type="email"
          value={email}
          placeholder="you@example.com"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void sendLink()}
          className="h-[26px] min-w-0 grow rounded-control border border-line-input bg-transparent px-2 text-meta text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
        />
        <Button variant="ghost" size="sm" disabled={!email.trim()} onClick={() => void sendLink()}>
          Email me a link
        </Button>
      </div>
    </div>
  );
}

function PartnerRows({ p, onChange, onError }: { p: PartnerStatus; onChange: (p: PartnerStatus) => void; onError: (e: string) => void }) {
  const sealed = useStore((s) => s.appState === "sealed");
  const [copied, setCopied] = useState(false);
  const [to, setTo] = useState("");
  const [emailed, setEmailed] = useState<string | null>(null);
  const run = (f: () => Promise<PartnerStatus>) => void f().then(onChange).catch((e) => onError(errorText(e)));
  const emailInvite = () => {
    const address = to.trim();
    if (!address) return;
    void native
      .cloudEmailInvite(address)
      .then((next) => {
        onChange(next);
        setEmailed(address);
        setTo("");
      })
      .catch((e) => onError(errorText(e)));
  };

  let partner;
  if (p.partner) {
    const who = p.partner.name ?? p.partner.email ?? "Your partner";
    partner =
      p.partner.status === "removal_requested" ? (
        <Row label={`Waiting for ${who} to release you`} hint="Removing a partner needs their approval on their page.">
          <Button variant="quiet" size="sm" onClick={() => run(() => native.cloudRequestRemoval(true))}>
            Keep partner
          </Button>
        </Row>
      ) : (
        <Row label={`Partner: ${who}`} hint={p.partner.email && p.partner.name ? p.partner.email : "Approves early unlocks and hears when a seal breaks."}>
          <Button variant="quiet" size="sm" disabled={sealed} onClick={() => run(() => native.cloudRequestRemoval(false))}>
            Ask to remove
          </Button>
        </Row>
      );
  } else if (p.invite) {
    const link = p.invite.link;
    partner = (
      <div className="flex flex-col gap-2 border-b border-line-soft px-[14px] py-3">
        <span className="text-body">Invite link</span>
        <div className="flex items-center gap-2">
          <span data-testid="invite-link" title={link} className="min-w-0 grow truncate rounded-control border border-line-input px-2 py-[5px] font-mono text-[11px] text-text-2">
            {link}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void navigator.clipboard?.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => run(native.cloudCancelInvite)}>
            Cancel
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="email"
            aria-label="Partner's email"
            placeholder="Or email it: friend@example.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && emailInvite()}
            className="h-[26px] min-w-0 grow rounded-control border border-line-input bg-transparent px-2 text-meta text-text outline-none transition-colors duration-ui ease-ui placeholder:text-faint hover:border-check-line focus:border-sealed"
          />
          <Button variant="ghost" size="sm" disabled={!to.trim()} onClick={emailInvite}>
            Email it
          </Button>
        </div>
        <span className="text-[11px] text-muted">
          {emailed ? `Sent to ${emailed}. ` : ""}
          {hoursLeft(p.invite.expiresAt)}. Works once. Your friend signs in and sets their own PIN.
        </span>
      </div>
    );
  } else {
    partner = (
      <Row label="Accountability partner" hint="A friend who approves early unlocks with their own PIN.">
        <Button variant="ghost" size="sm" disabled={sealed} onClick={() => run(native.cloudCreateInvite)}>
          Invite a partner
        </Button>
      </Row>
    );
  }
  return (
    <>
      {partner}
      {p.partnerOf.length ? (
        <Row label={`You're the partner for ${p.partnerOf.join(", ")}`} hint="Approve or deny their requests on the partner page.">
          <span />
        </Row>
      ) : null}
    </>
  );
}

/**
 * Deletes the account for good (v0.1, Google's OAuth policy): profile, partner links both ways,
 * PIN, and requests. This PC's data stays. Typed confirmation, and never while sealed.
 */
export function DeleteAccount({ onDone }: { onDone: () => void }) {
  const sealed = useStore((s) => s.appState === "sealed");
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      await native.cloudDeleteAccount();
      onDone();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <>
      <Row label="Delete account" hint="Your account, partner links, and PIN, for good. What's on this PC stays.">
        {asking ? null : (
          <Button variant="ghost" size="sm" disabled={sealed} onClick={() => setAsking(true)}>
            {sealed ? "Waits until the seal ends" : "Delete account"}
          </Button>
        )}
      </Row>
      {asking ? (
        <div className="flex flex-col gap-2 border-t border-line-soft px-[14px] py-3">
          <span className="text-meta text-text-2">
            This can’t be undone. Your partner stops holding your key. Type <span className="font-mono text-text">delete</span> to confirm.
          </span>
          <div className="flex items-center gap-2">
            <input
              aria-label="Type delete to confirm"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="h-[30px] min-w-0 grow rounded-control border border-line-input bg-raised px-[10px] font-mono text-body text-text outline-none transition-colors duration-ui ease-ui focus:border-broken"
            />
            <Button variant="ghost" size="sm" onClick={() => (setAsking(false), setTyped(""))}>
              Cancel
            </Button>
            <button
              type="button"
              disabled={typed.trim().toLowerCase() !== "delete" || busy || sealed}
              onClick={() => void run()}
              className="h-[26px] rounded-control border border-broken-line bg-broken-tint px-2 text-meta font-medium text-broken-text transition-colors duration-ui ease-ui enabled:hover:border-broken disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Deleting…" : "Delete my account"}
            </button>
          </div>
          {error ? <span className="text-meta text-broken-text">{error}</span> : null}
        </div>
      ) : null}
    </>
  );
}

export function AccountSection() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [partner, setPartner] = useState<PartnerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const s = await native.cloudStatus().catch(() => null);
    setStatus(s);
    if (s?.error) setError(s.error);
    if (s?.signedIn && !s.connecting) {
      try {
        setPartner(await native.cloudPartner());
        setError(null);
      } catch (e) {
        setError(errorText(e));
      }
    } else setPartner(null);
  }, []);

  useEffect(() => {
    void load();
    const off = onNative(EVENTS.cloud, () => void load());
    return () => void off.then((f) => f());
  }, [load]);

  if (!status) return null;
  if (!status.configured) {
    return (
      <Section title="Account">
        <p className="m-0 px-[14px] py-3 text-body leading-normal text-muted">
          Accounts and the accountability partner aren’t set up in this build. Add a Supabase project to src-tauri/.env to turn them on (docs/self-hosting.md). Everything else works without one.
        </p>
      </Section>
    );
  }
  const email = partner?.email ?? status.email;
  return (
    <Section
      title="Account"
      action={
        status.signedIn && !status.connecting ? (
          <Button variant="quiet" size="sm" onClick={() => void native.cloudSignOut().then(() => load())}>
            Sign out
          </Button>
        ) : undefined
      }
    >
      {status.signedIn && !status.connecting ? (
        <>
          <Row label={email ? `Signed in as ${email}` : "Signed in"}>
            <span />
          </Row>
          {partner ? <PartnerRows p={partner} onChange={setPartner} onError={setError} /> : null}
          <DeleteAccount onDone={() => void load()} />
        </>
      ) : (
        <SignIn status={status} onError={setError} />
      )}
      {error ? <p className="m-0 border-t border-line-soft px-[14px] py-2 text-meta text-broken-text">{error}</p> : null}
    </Section>
  );
}
