import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { call, supabase } from "./supabase";

// The accountability partner's page (SPEC 4.6): accept an invite and set a PIN, see who you
// hold the key for, release them when they ask, reset your PIN. Approvals arrive in M7.

const inviteToken = () => /^\/invite\/([a-f0-9]+)\/?$/i.exec(location.pathname)?.[1] ?? null;

function Card({ children }: { children: ReactNode }) {
  return (
    <main className="card">
      <div className="brand">
        <img src="/mark.svg" width="18" height="18" alt="" />
        <span>Sanctum partner</span>
      </div>
      {children}
    </main>
  );
}

function Headline({ lead, payoff }: { lead: string; payoff: string }) {
  return (
    <h1 className="headline">
      {lead} <em>{payoff}</em>
    </h1>
  );
}

function SignIn({ intro }: { intro: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const redirectTo = location.href;
  const google = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) setError(error.message);
  };
  const magic = async (e: FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo } });
    if (error) setError(error.message);
    else setSent(true);
  };
  return (
    <>
      <p className="muted">{intro}</p>
      {sent ? (
        <p>Check {email.trim()} for a sign-in link. Open it on this device.</p>
      ) : (
        <>
          <button className="primary" onClick={() => void google()}>
            Continue with Google
          </button>
          <form className="row" onSubmit={(e) => void magic(e)}>
            <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <button className="ghost" type="submit">
              Email me a link
            </button>
          </form>
        </>
      )}
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}

function PinFields({ pin, confirm, setPin, setConfirm }: { pin: string; confirm: string; setPin: (v: string) => void; setConfirm: (v: string) => void }) {
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 12);
  return (
    <div className="row">
      <input inputMode="numeric" type="password" autoComplete="new-password" placeholder="PIN, 6 to 12 digits" aria-label="PIN" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
      <input inputMode="numeric" type="password" autoComplete="new-password" placeholder="Same PIN again" aria-label="Confirm PIN" value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} />
    </div>
  );
}

function pinProblem(pin: string, confirm: string): string | null {
  if (pin.length < 6) return "Use at least 6 digits.";
  if (pin !== confirm) return "The PINs don't match.";
  return null;
}

function Invite({ token, onDone }: { token: string; onDone: () => void }) {
  const [info, setInfo] = useState<{ from: string; needsPin: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<{ from: string; needsPin: boolean }>("invite", { action: "peek", token }).then(setInfo, (e: Error) => setError(e.message));
  }, [token]);

  const accept = async () => {
    const problem = info?.needsPin ? pinProblem(pin, confirm) : null;
    if (problem) return setError(problem);
    setBusy(true);
    try {
      await call("invite", { action: "accept", token, pin: info?.needsPin ? pin : undefined });
      history.replaceState(null, "", "/");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <p className={error ? "error" : "muted"}>{error ?? "Opening the invite…"}</p>;
  return (
    <>
      <Headline lead={`${info.from} asked you`} payoff="to hold the key." />
      <p className="muted">
        When they want out of a focus session early, you'll get an email. You approve or deny it here with your PIN. They never see your PIN, and they can't remove
        you without your say.
      </p>
      {info.needsPin ? <PinFields pin={pin} confirm={confirm} setPin={setPin} setConfirm={setConfirm} /> : <p className="muted">You'll use the PIN you already set.</p>}
      <button className="primary" disabled={busy} onClick={() => void accept()}>
        Accept
      </button>
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}

interface Link {
  id: string;
  user_id: string;
  status: "active" | "removal_requested";
  created_at: string;
}

function Dashboard({ session }: { session: Session }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("partnerships").select("id,user_id,status,created_at").eq("partner_id", session.user.id).neq("status", "ended");
    const rows = (data ?? []) as Link[];
    setLinks(rows);
    if (rows.length) {
      const { data: people } = await supabase.from("profiles_user").select("id,email,display_name").in("id", rows.map((r) => r.user_id));
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.display_name || p.email || "Someone"])));
    }
    setLoaded(true);
  }, [session.user.id]);
  useEffect(() => void load(), [load]);

  const end = async (id: string) => {
    const { error } = await supabase.rpc("end_partnership", { pid: id });
    setMessage(error ? { text: error.message, bad: true } : { text: "Released." });
    void load();
  };
  const resetPin = async (e: FormEvent) => {
    e.preventDefault();
    const problem = pinProblem(pin, confirm);
    if (problem) return setMessage({ text: problem, bad: true });
    try {
      await call("pin-set", { pin });
      setPin("");
      setConfirm("");
      setMessage({ text: "PIN updated." });
    } catch (err) {
      setMessage({ text: (err as Error).message, bad: true });
    }
  };

  return (
    <>
      <Headline lead="You hold" payoff={links.length === 1 ? "one key." : `${links.length || "no"} keys.`} />
      {!loaded ? <p className="muted">Loading…</p> : null}
      {loaded && !links.length ? <p className="muted">Nobody has chosen you as their partner yet. Invites come as a link from the Sanctum app.</p> : null}
      {links.map((l) => {
        const who = names[l.user_id] ?? "Someone";
        return (
          <section key={l.id} className="panel">
            <div className="row between">
              <strong>{who}</strong>
              <span className="muted small">since {new Date(l.created_at).toLocaleDateString()}</span>
            </div>
            {l.status === "removal_requested" ? (
              <>
                <p>{who} asked you to step down as their partner.</p>
                <div className="row">
                  <button className="primary" onClick={() => void end(l.id)}>
                    Release {who}
                  </button>
                  <span className="muted small">Or leave it; nothing changes until you release them.</span>
                </div>
              </>
            ) : (
              <>
                <p className="muted small">Unlock requests will show here with their reason, to approve or deny with your PIN.</p>
                <button className="ghost" onClick={() => void end(l.id)}>
                  Step down
                </button>
              </>
            )}
          </section>
        );
      })}
      {links.length ? (
        <form className="panel" onSubmit={(e) => void resetPin(e)}>
          <strong>Reset your PIN</strong>
          <PinFields pin={pin} confirm={confirm} setPin={setPin} setConfirm={setConfirm} />
          <button className="ghost" type="submit">
            Save PIN
          </button>
        </form>
      ) : null}
      {message ? <p className={message.bad ? "error" : "muted"}>{message.text}</p> : null}
      <p className="muted small">
        Signed in as {session.user.email}.{" "}
        <button className="link" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </p>
    </>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [token, setToken] = useState(inviteToken);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <Card>{null}</Card>;
  if (!session) {
    return (
      <Card>
        <Headline lead={token ? "Someone wants you" : "Hold the key."} payoff={token ? "in their corner." : "Keep them honest."} />
        <SignIn intro={token ? "Sign in to see the invite. Google or an email link, no password." : "Sign in to see who you're a partner for."} />
      </Card>
    );
  }
  return <Card>{token ? <Invite token={token} onDone={() => setToken(null)} /> : <Dashboard session={session} />}</Card>;
}
