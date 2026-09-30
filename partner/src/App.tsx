import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { call, configured, supabase } from "./supabase";

// The accountability partner's page (SPEC 4.6, design/screens/PartnerApprove.dc.html).
// /approve/<id>: one unlock request, full screen, decided with your PIN (the email links here).
// /invite/<token>: accept an invite and set a PIN. /: who you hold the key for, and your PIN.
// Built for phones first: partners open it from an email.

// Dev only: /emails renders every email; /demo/approve shows the approve screen with sample data.
const EmailPreview = import.meta.env.DEV ? lazy(() => import("./EmailPreview")) : () => null;

type Route = { page: "home" } | { page: "invite"; token: string } | { page: "approve"; id: string } | { page: "emails" } | { page: "demo" };

function routeOf(path: string): Route {
  const invite = /^\/invite\/([a-f0-9]+)\/?$/i.exec(path);
  if (invite) return { page: "invite", token: invite[1]! };
  const approve = /^\/approve\/([0-9a-f-]{36})\/?$/i.exec(path);
  if (approve) return { page: "approve", id: approve[1]! };
  if (import.meta.env.DEV && /^\/emails\/?$/.test(path)) return { page: "emails" };
  if (import.meta.env.DEV && /^\/demo\/approve\/?$/.test(path)) return { page: "demo" };
  return { page: "home" };
}

function go(path: string) {
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => routeOf(location.pathname));
  useEffect(() => {
    const on = () => setRoute(routeOf(location.pathname));
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return route;
}

function Card({ context, children }: { context?: ReactNode; children: ReactNode }) {
  return (
    <main className="card">
      <header className="brand">
        <img src="/mark.svg" width="18" height="18" alt="" />
        <span>Sanctum</span>
        {context ? <span className="context">{context}</span> : null}
      </header>
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
        <p className="panel">Check {email.trim()} for a sign-in link, and open it on this device.</p>
      ) : (
        <div className="stack">
          <button className="primary wide" onClick={() => void google()}>
            Continue with Google
          </button>
          <form className="row" onSubmit={(e) => void magic(e)}>
            <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <button className="ghost" type="submit">
              Email me a link
            </button>
          </form>
        </div>
      )}
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}

/** A PIN as boxes (6 shown, up to 12), typed into one real input so paste and autofill work. */
function PinBoxes({ value, onChange, label, autoFocus = false, id }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean; id: string }) {
  const input = useRef<HTMLInputElement>(null);
  const count = Math.max(6, Math.min(12, value.length + (value.length >= 6 && value.length < 12 ? 1 : 0)));
  return (
    <div className="pin" onClick={() => input.current?.focus()}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="pin-boxes">
        {Array.from({ length: count }, (_, i) => (
          <span key={i} className={`pin-box ${i < value.length ? "filled" : ""} ${i === value.length ? "next" : ""}`} aria-hidden="true">
            {i < value.length ? "•" : ""}
          </span>
        ))}
        <input
          id={id}
          ref={input}
          className="pin-input"
          inputMode="numeric"
          type="password"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 12))}
        />
      </div>
    </div>
  );
}

function pinProblem(pin: string, confirm: string): string | null {
  if (pin.length < 6) return "Use at least 6 digits.";
  if (pin !== confirm) return "The PINs don't match.";
  return null;
}

function Invite({ token }: { token: string }) {
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
      go("/");
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
        When {info.from} wants out of a focus session early, you get an email and decide here with a PIN only you know. They can't remove you without your say.
      </p>
      {info.needsPin ? (
        <div className="stack">
          <PinBoxes id="pin-new" label="Choose a PIN, 6 to 12 digits" value={pin} onChange={setPin} autoFocus />
          <PinBoxes id="pin-again" label="Same PIN again" value={confirm} onChange={setConfirm} />
        </div>
      ) : (
        <p className="muted">You'll use the PIN you already set.</p>
      )}
      <button className="primary wide" disabled={busy} onClick={() => void accept()}>
        Hold the key for {info.from}
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
  status: "pending" | "approved" | "denied" | "expired";
  note: string | null;
  profile_name: string | null;
  ends_at: string | null;
}

const TTL_MS = 30 * 60_000;

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const countdown = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function nameOf(id: string): Promise<string> {
  const { data } = await supabase.from("profiles_user").select("email,display_name").eq("id", id).maybeSingle();
  return data?.display_name || data?.email || "Someone";
}

const DEMO: UnlockRequest = {
  id: "00000000-0000-0000-0000-000000000000",
  user_id: "demo",
  reason: "Recruiter moved my call up and I need Discord for the shared screen link.",
  created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
  status: "pending",
  note: null,
  profile_name: "Interview Prep",
  ends_at: new Date(Date.now() + 32 * 60_000 + 14_000).toISOString(),
};

/** One unlock request, full screen (PartnerApprove.dc.html). `demo` uses sample data and sends nothing. */
function Approve({ id, demo = false }: { id: string; demo?: boolean }) {
  const [r, setR] = useState<UnlockRequest | null>(null);
  const [who, setWho] = useState("");
  const [asks, setAsks] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"approved" | "denied" | null>(null);
  const now = useNow();

  useEffect(() => {
    if (demo) {
      setR(DEMO);
      setWho("Ryan");
      setAsks(2);
      return;
    }
    void (async () => {
      const { data } = await supabase.from("unlock_requests").select("id,user_id,reason,created_at,status,note,profile_name,ends_at").eq("id", id).maybeSingle();
      if (!data) return setError("That request doesn't exist, or it isn't yours to answer.");
      setR(data as UnlockRequest);
      setWho(await nameOf(data.user_id));
      const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { count } = await supabase.from("unlock_requests").select("id", { count: "exact", head: true }).eq("user_id", data.user_id).gte("created_at", week);
      setAsks(count ?? null);
    })();
  }, [id, demo]);

  if (!r) return <p className={error ? "error" : "muted"}>{error ?? "Opening the request…"}</p>;
  const expiresIn = new Date(r.created_at).getTime() + TTL_MS - now;
  const left = r.ends_at ? new Date(r.ends_at).getTime() - now : null;
  const status = done ?? (r.status === "pending" && expiresIn <= 0 ? "expired" : r.status);

  const answer = async (approve: boolean) => {
    if (pin.length < 6) return setError("Enter your PIN.");
    setBusy(true);
    setError(null);
    try {
      if (!demo) await call("unlock-respond", { requestId: r.id, approve, pin, note });
      setDone(approve ? "approved" : "denied");
    } catch (e) {
      setError((e as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  if (status !== "pending") {
    const [lead, payoff, line] =
      status === "approved"
        ? [`You let ${who}`, "out.", `The session ended early. It doesn't count as a broken seal.`]
        : status === "denied"
          ? ["You kept", "the seal.", `${who} stays in. They can ask again in 15 minutes.`]
          : ["This request", "expired.", `Nobody answered in 30 minutes, so ${who} stays sealed.`];
    return (
      <>
        <Headline lead={lead} payoff={payoff} />
        <p className="muted">{line}</p>
        <button className="ghost" onClick={() => go("/")}>
          Back to your partners
        </button>
      </>
    );
  }

  return (
    <>
      <Headline lead={`${who} wants out`} payoff="early." />
      <section className="panel flush" aria-label="Request">
        <p className="reason">“{r.reason}”</p>
        <dl className="facts">
          <div>
            <dt>Session</dt>
            <dd>{r.profile_name ?? "Focus"}</dd>
          </div>
          <div>
            <dt>Time left</dt>
            <dd className="mono">{left !== null ? countdown(left) : "—"}</dd>
          </div>
          <div>
            <dt>Asks this week</dt>
            <dd className="mono">{asks ?? "—"}</dd>
          </div>
        </dl>
      </section>
      <PinBoxes id="pin" label="Your PIN, to confirm it's you" value={pin} onChange={setPin} autoFocus />
      <label className="field">
        <span className="label">Note back (optional)</span>
        <input placeholder="Use your phone for the link. Finish the set." value={note} maxLength={280} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="choices">
        <button className="ghost" disabled={busy} onClick={() => void answer(false)}>
          Deny, keep the seal
        </button>
        <button className="light" disabled={busy} onClick={() => void answer(true)}>
          Approve, end it
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="small">Works once and expires in {Math.max(0, Math.ceil(expiresIn / 60_000))} minutes. 3 wrong PINs lock approvals for 30 minutes.</p>
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
  const [requests, setRequests] = useState<Pick<UnlockRequest, "id" | "user_id" | "reason" | "created_at">[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const now = useNow(15_000);

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
    setRequests(pending ?? []);
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
      setResetting(false);
      setMessage({ text: "PIN updated." });
    } catch (err) {
      setMessage({ text: (err as Error).message, bad: true });
    }
  };

  return (
    <>
      <Headline lead="You hold" payoff={links.length === 1 ? "one key." : `${links.length || "no"} keys.`} />
      {!loaded ? <p className="muted">Loading…</p> : null}
      {requests.map((r) => {
        const who = names[r.user_id] ?? "Someone";
        const left = Math.max(0, Math.ceil((new Date(r.created_at).getTime() + TTL_MS - now) / 60_000));
        return (
          <section key={r.id} className="panel urgent" aria-label={`${who} wants out early`}>
            <div className="row between">
              <strong>{who} wants out early</strong>
              <span className="small">{left} min to answer</span>
            </div>
            <p className="reason clamp">“{r.reason}”</p>
            <button className="primary wide" onClick={() => go(`/approve/${r.id}`)}>
              Review request
            </button>
          </section>
        );
      })}
      {loaded && !links.length ? <p className="muted">Nobody has chosen you as their partner yet. Invites come as a link or an email from the Sanctum app.</p> : null}
      {links.map((l) => {
        const who = names[l.user_id] ?? "Someone";
        return (
          <section key={l.id} className="panel" aria-label={who}>
            <div className="row between">
              <strong>{who}</strong>
              <span className="small">since {new Date(l.created_at).toLocaleDateString()}</span>
            </div>
            {l.status === "removal_requested" ? (
              <>
                <p>{who} asked you to step down as their partner. Nothing changes until you release them.</p>
                <button className="primary" onClick={() => void end(l.id)}>
                  Release {who}
                </button>
              </>
            ) : (
              <>
                <p className="muted">When {who} asks to leave a session early, you'll get an email and the request shows up here.</p>
                <button className="ghost" onClick={() => void end(l.id)}>
                  Step down
                </button>
              </>
            )}
          </section>
        );
      })}
      {links.length ? (
        resetting ? (
          <form className="panel" onSubmit={(e) => void resetPin(e)}>
            <strong>Choose a new PIN</strong>
            <PinBoxes id="pin-reset" label="New PIN, 6 to 12 digits" value={pin} onChange={setPin} autoFocus />
            <PinBoxes id="pin-reset-again" label="Same PIN again" value={confirm} onChange={setConfirm} />
            <div className="row">
              <button className="primary" type="submit">
                Save PIN
              </button>
              <button className="ghost" type="button" onClick={() => setResetting(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="link" onClick={() => setResetting(true)}>
            Reset your PIN
          </button>
        )
      ) : null}
      {message ? <p className={message.bad ? "error" : "muted"}>{message.text}</p> : null}
      <p className="small">
        Signed in as {session.user.email}.{" "}
        <button className="link" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </p>
    </>
  );
}

export function App() {
  const route = useRoute();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!configured) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (route.page === "emails") {
    return (
      <Suspense fallback={null}>
        <EmailPreview />
      </Suspense>
    );
  }
  if (route.page === "demo") {
    return (
      <Card context={<span>You're Ryan's accountability partner</span>}>
        <Approve id={DEMO.id} demo />
      </Card>
    );
  }
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
    const [lead, payoff, intro] =
      route.page === "invite"
        ? ["Someone wants you", "in their corner.", "Sign in to see the invite. Google or an email link, no password."]
        : route.page === "approve"
          ? ["A request", "is waiting.", "Sign in to answer it. Google or an email link, no password."]
          : ["Hold the key.", "Keep them honest.", "Sign in to see who you're a partner for."];
    return (
      <Card>
        <Headline lead={lead} payoff={payoff} />
        <SignIn intro={intro} />
      </Card>
    );
  }
  return (
    <Card
      context={
        route.page === "home" ? undefined : (
          <button className="link small" onClick={() => go("/")}>
            Your partners
          </button>
        )
      }
    >
      {route.page === "invite" ? <Invite token={route.token} /> : route.page === "approve" ? <Approve key={route.id} id={route.id} /> : <Dashboard session={session} />}
    </Card>
  );
}
