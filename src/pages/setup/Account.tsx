import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { Switch } from "../../components/controls";
import { EVENTS, errorText, native, onNative } from "../../lib/native";
import type { CloudStatus, PartnerStatus } from "../../lib/types";
import { useStore } from "../../state/store";
import { Row, Section } from "./parts";
import { StatusLine, useCascade, type ConnectionTone } from "./status";

// Setup > Account (SPEC 4.6, M6): the optional account, and the accountability partner who
// approves early unlocks. Sanctum works fully without either.

function hoursLeft(iso: string): string {
  const h = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
  return h <= 1 ? "Expires within the hour" : `Expires in ${h} hours`;
}

/** Cloud status and the partner link, refreshed on every cloud event. */
function useCloud() {
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

  return { status, partner, setPartner, error, setError, load };
}

export function partnerTone(p: PartnerStatus | null): ConnectionTone {
  if (p?.partner) return "ok";
  return p?.invite ? "attention" : "off";
}

/** For the side list's dot: a partner holds the key, an invite is open, or no partner. */
export function usePartnerStatus(): ConnectionTone {
  return partnerTone(useCloud().partner);
}

function SignIn({ status, onError }: { status: CloudStatus; onError: (e: string) => void }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (status.connecting) {
    return (
      <Row label={sentTo ? `Check ${sentTo}` : "Finish signing in in your browser"} hint={sentTo ? "Open the link on this PC within 15 minutes." : undefined}>
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
      <span className="text-body">Sign in to add a partner</span>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => void native.cloudSignInGoogle().catch((e) => onError(errorText(e)))}>
          Continue with Google
        </Button>
        <span className="text-meta text-muted">or</span>
        <input
          aria-label="Email for a sign-in link"
          type="email"
          value={email}
          placeholder="you@example.com"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void sendLink()}
          className="h-control-sm min-w-0 grow rounded-control border border-line-input bg-transparent px-2 text-meta text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line focus:border-sealed"
        />
        <Button variant="ghost" size="sm" disabled={!email.trim()} onClick={() => void sendLink()}>
          Email me a link
        </Button>
      </div>
    </div>
  );
}

/** Each Monday, last week's totals to your partner (v0.3.1, off to start): sharing progress
 *  makes monitoring work better (Harkin et al. 2016). Totals only, never sites or apps. */
function WeeklySummaryRow({ who }: { who: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => void native.getSetting("partner_weekly_summary").then((v) => setOn(v === "1"), () => setOn(false)), []);
  if (on === null) return null;
  const toggle = (v: boolean) => {
    setOn(v);
    void native.setSetting("partner_weekly_summary", v ? "1" : "0");
  };
  return (
    <Row label={`Send ${who} my week each Monday`} hint="Totals only, never sites or apps.">
      <Switch label={`Send ${who} my week each Monday`} checked={on} onChange={toggle} />
    </Row>
  );
}

/** The partner's status line, then the rows under it: the partner or the open invite. */
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
  const tone = partnerTone(p);

  let line;
  let details = null;
  if (p.partner) {
    const who = p.partner.name ?? p.partner.email ?? "Your partner";
    if (p.partner.status === "removal_requested") {
      line = (
        <StatusLine
          tone={tone}
          testId="partner-status"
          action={
            <Button variant="quiet" size="sm" onClick={() => run(() => native.cloudRequestRemoval(true))}>
              Keep partner
            </Button>
          }
        >
          Waiting for {who} to release you.
        </StatusLine>
      );
    } else {
      line = (
        <StatusLine
          tone={tone}
          testId="partner-status"
          action={
            <Button variant="quiet" size="sm" disabled={sealed} onClick={() => run(() => native.cloudRequestRemoval(false))}>
              Ask to remove
            </Button>
          }
        >
          {who} approves your early unlocks.
        </StatusLine>
      );
    }
    details = (
      <>
        <Row label={`Partner: ${who}`} hint={p.partner.email && p.partner.name ? p.partner.email : undefined}>
          <span />
        </Row>
        {p.partner.status === "removal_requested" ? null : <WeeklySummaryRow who={who} />}
      </>
    );
  } else if (p.invite) {
    const link = p.invite.link;
    line = (
      <StatusLine tone={tone} testId="partner-status">
        Invite open. Send your friend the link.
      </StatusLine>
    );
    details = (
      <div className="flex flex-col gap-2 border-b border-line-soft px-[14px] py-3">
        <div className="flex items-center gap-2">
          <span data-testid="invite-link" title={link} className="min-w-0 grow truncate rounded-control border border-line-input px-2 py-[5px] font-mono text-meta text-text-2">
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
            className="h-control-sm min-w-0 grow rounded-control border border-line-input bg-transparent px-2 text-meta text-text transition-colors duration-ui ease-ui placeholder:text-muted hover:border-check-line focus:border-sealed"
          />
          <Button variant="ghost" size="sm" disabled={!to.trim()} onClick={emailInvite}>
            Email it
          </Button>
        </div>
        <span className="text-meta text-muted">
          {emailed ? `Sent to ${emailed}. ` : ""}
          {hoursLeft(p.invite.expiresAt)}. Works once.
        </span>
      </div>
    );
  } else {
    line = (
      <StatusLine
        tone={tone}
        testId="partner-status"
        action={
          <Button variant="primary" size="sm" disabled={sealed} onClick={() => run(native.cloudCreateInvite)}>
            Invite a partner
          </Button>
        }
      >
        No partner. Early unlocks need only you.
      </StatusLine>
    );
  }
  return (
    <>
      {line}
      {details}
      {p.partnerOf.length ? (
        <Row label={`You're the partner for ${p.partnerOf.join(", ")}`} hint="Answer them on the partner page.">
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
      <Row label="Delete account" hint="This PC's data stays">
        {asking ? null : (
          <Button variant="danger-quiet" size="sm" disabled={sealed} onClick={() => setAsking(true)}>
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
              className="h-control-sm min-w-0 grow rounded-control border border-line-input bg-raised px-[10px] font-mono text-body text-text transition-colors duration-ui ease-ui focus:border-danger"
            />
            <Button variant="ghost" size="sm" onClick={() => (setAsking(false), setTyped(""))}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={typed.trim().toLowerCase() !== "delete" || busy || sealed}
              onClick={() => void run()}
            >
              {busy ? "Deleting…" : "Delete my account"}
            </Button>
          </div>
          {error ? <span className="text-meta text-broken-text">{error}</span> : null}
        </div>
      ) : null}
    </>
  );
}

export function AccountSection() {
  const { status, partner, setPartner, error, setError, load } = useCloud();
  const signedIn = !!status?.signedIn && !status.connecting;
  const rows = useCascade<HTMLDivElement>(!!status);

  if (!status) return null;
  if (!status.configured) {
    return (
      <Section title="Account">
        <StatusLine tone="off" testId="partner-status">
          Accounts aren’t set up in this build.
        </StatusLine>
        <Row label="Add a Supabase project" hint="src-tauri/.env, see docs/self-hosting.md">
          <span />
        </Row>
      </Section>
    );
  }
  const email = partner?.email ?? status.email;
  return (
    <Section title="Account">
      {signedIn ? (
        partner ? (
          <PartnerRows p={partner} onChange={setPartner} onError={setError} />
        ) : (
          <StatusLine tone="off" testId="partner-status">
            Signed in.
          </StatusLine>
        )
      ) : (
        <StatusLine tone="off" testId="partner-status">
          No partner. Early unlocks need only you.
        </StatusLine>
      )}
      <div ref={rows}>
        {signedIn ? (
          // Delete account lives in Your Data's danger zone, beside Start over (decided 2026-11-16).
          <Row label={email ? `Signed in as ${email}` : "Signed in"}>
            <Button variant="quiet" size="sm" onClick={() => void native.cloudSignOut().then(() => load())}>
              Sign out
            </Button>
          </Row>
        ) : (
          <SignIn status={status} onError={setError} />
        )}
      </div>
      {error ? <p className="m-0 border-t border-line-soft px-[14px] py-2 text-body text-broken-text">{error}</p> : null}
    </Section>
  );
}
