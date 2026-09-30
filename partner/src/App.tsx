import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { call, configured, supabase } from "./supabase";

// The accountability partner's page (SPEC 4.6): accept an invite and set a PIN, see who you
// hold the key for, approve or deny their early unlocks, release them when they ask, reset your PIN.

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

interface UnlockRequest {
  id: string;
  user_id: string;
  reason: string;
  created_at: string;
}

const TTL_MS = 30 * 60_000;

/** One pending unlock request: the reason, the time left, and Approve or Deny with the PIN. */
function RequestCard({ r, who, onDone }: { r: UnlockRequest; who: string; onDone: (msg: string) => void }) {
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = Math.max(0, Math.ceil((new Date(r.created_at).getTime() + TTL_MS - Date.now()) / 60_000));
  const answer = async (approve: boolean) => {
    if (pin.length < 6) return setError("Enter your PIN.");
    setBusy(true);
    try {
      await call("unlock-respond", { requestId: r.id, approve, pin, note });
      onDone(approve ? `You approved it. ${who}'s session is over.` : `You denied it. ${who} stays sealed.`);
    } catch (e) {
      setError((e as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel urgent">
      <div className="row between">
        <strong>{who} wants out early</strong>
        <span className="muted small">expires in {left} min</span>
      </div>
      <p className="quote">“{r.reason}”</p>
      <div className="row">
        <input inputMode="numeric" type="password" autoComplete="off" placeholder="Your PIN" aria-label="Your PIN" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))} />
        <input placeholder="Note back (optional)" aria-label="Note back" value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => void answer(false)}>
          Deny
        </button>
        <button className="ghost" disabled={busy} onClick={() => void answer(true)}>
          Approve
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </section>
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
  const [requests, setRequests] = useState<UnlockRequest[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("partnerships").select("id,user_id,status,created_at").eq("partner_id", session.user.id).neq("status", "ended");
    const rows = (data ?? []) as Link[];
    setLinks(rows);
    const since = new Date(Date.now() - TTL_MS).toISOString();
    const { data: pending } = await supabase
      .from("unlock_requests")
      .select("id,user_id,reason,created_at")
      .eq("status", "pending")
      .neq("user_id", session.user.id)
      .gte("created_at", since)
      .order("created_at");
    setRequests((pending ?? []) as UnlockRequest[]);
    if (rows.length) {
      const { data: people } = await supabase.from("profiles_user").select("id,email,display_name").in("id", rows.map((r) => r.user_id));
      setNames(Object.fromEntries((people ?? []).map((p) => [p.id, p.display_name || p.email || "Someone"])));
    }
    setLoaded(true);
  }, [session.user.id]);
  useEffect(() => {
    void load();
    // New requests show up without a reload.
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

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
      {requests.map((r) => (
        <RequestCard
          key={r.id}
          r={r}
          who={names[r.user_id] ?? "Someone"}
          onDone={(text) => {
            setMessage({ text });
            void load();
          }}
        />
      ))}
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
                <p className="muted small">When {who} asks to leave a session early, the request shows up here with their reason. You'll get an email too.</p>
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

  if (!configured) {
    return (
      <Card>
        <Headline lead="Not set up yet." payoff="Almost there." />
        <p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY for this page. See docs/self-hosting.md in the Sanctum repo.</p>
      </Card>
    );
  }
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
