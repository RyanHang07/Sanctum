// Sanctum's emails (design/screens/PartnerApprove.dc.html, "The email that brought you here").
// Plain TypeScript with no Deno imports, so the Edge Functions send it, the partner page's
// /emails preview renders it, and the app's tests check it. Every email has an HTML and a
// plain-text part. Colors are the design's light email palette: mail clients can't read the
// app's CSS tokens, so they're written out here and nowhere else.

export type EmailKind =
  | "unlock_request"
  | "session_broken"
  | "emergency_unlock"
  | "streak_lost"
  | "invite"
  | "unlock_decided"
  | "magic_link"
  | "confirm_signup";

export interface EmailData {
  /** Who it's about: the person sealed in (their display name or email). */
  who?: string;
  /** The partner's name, for emails to the person sealed in. */
  partner?: string;
  /** A reason, or what happened. */
  detail?: string;
  /** The partner's note back. */
  note?: string;
  approved?: boolean;
  /** The profile of the running session. */
  profile?: string;
  /** Minutes into the session, and minutes left. */
  minutesIn?: number;
  minutesLeft?: number;
  /** The button's destination. */
  link?: string;
}

export interface Email {
  subject: string;
  /** The inbox preview line. */
  preheader: string;
  html: string;
  text: string;
}

const C = {
  page: "#F4F5F7",
  card: "#FFFFFF",
  line: "#E1E3E8",
  ink: "#16181D",
  body: "#3A3F4B",
  muted: "#5A6070",
  quote: "#F4F5F7",
  cobalt: "#2F5BFF",
};

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Parts {
  subject: string;
  preheader: string;
  heading: string;
  lines: string[];
  quote?: string;
  quoteLabel?: string;
  button?: { label: string; href: string };
  foot: string;
}

function html(p: Parts): string {
  const e = escapeHtml;
  const para = (t: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${C.body}">${e(t)}</p>`;
  const quote = p.quote
    ? `<div style="margin:4px 0 16px;padding:12px 14px;background:${C.quote};border-left:3px solid ${C.cobalt};border-radius:4px">
${p.quoteLabel ? `<div style="font-size:12px;color:${C.muted};margin-bottom:4px">${e(p.quoteLabel)}</div>` : ""}<div style="font-size:15px;line-height:1.5;color:${C.ink}">“${e(p.quote)}”</div></div>`
    : "";
  const button = p.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px"><tr><td style="background:${C.ink};border-radius:6px">
<a href="${e(p.button.href)}" style="display:inline-block;padding:10px 16px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none">${e(p.button.label)}</a></td></tr></table>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(p.subject)}</title></head>
<body style="margin:0;padding:0;background:${C.page};font-family:-apple-system,'Segoe UI',Geist,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(p.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${C.card};border:1px solid ${C.line};border-radius:10px">
<tr><td style="padding:14px 20px;border-bottom:1px solid ${C.line};font-size:13px;font-weight:600;color:${C.ink}">
<span style="display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:2px;background:${C.cobalt};vertical-align:1px"></span>Sanctum</td></tr>
<tr><td style="padding:22px 20px 18px">
<h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${C.ink}">${e(p.heading)}</h1>
${p.lines.map(para).join("\n")}
${quote}
${button}
</td></tr>
<tr><td style="padding:14px 20px;border-top:1px solid ${C.line};font-size:12px;line-height:1.5;color:${C.muted}">${e(p.foot)}</td></tr>
</table></td></tr></table></body></html>`;
}

function text(p: Parts): string {
  const out = [p.heading, "", ...p.lines];
  if (p.quote) out.push("", `${p.quoteLabel ? `${p.quoteLabel}: ` : ""}"${p.quote}"`);
  if (p.button) out.push("", `${p.button.label}: ${p.button.href}`);
  out.push("", "—", p.foot);
  return out.join("\n");
}

const mins = (n: number) => (n === 1 ? "1 minute" : `${n} minutes`);

function parts(kind: EmailKind, d: EmailData): Parts {
  const who = d.who?.trim() || "Your friend";
  const partner = d.partner?.trim() || "Your partner";
  const link = d.link ?? "";
  const partnerFoot = `You're ${who}'s accountability partner on Sanctum. They can't remove you without your say.`;
  switch (kind) {
    case "unlock_request": {
      const where = d.profile ? (d.minutesIn !== undefined ? `${mins(d.minutesIn)} into ${d.profile}` : `in ${d.profile}`) : "in a focus session";
      return {
        subject: `${who} wants to break their seal`,
        preheader: `${who} asked to leave early. Your call, with your PIN.`,
        heading: `${who} wants out early.`,
        lines: [`${who} is ${where} and asked to leave early. Here's their reason and your call.`],
        quote: d.detail,
        button: link ? { label: "Review request", href: link } : undefined,
        foot: `The request expires in 30 minutes. Approving or denying takes your PIN. ${partnerFoot}`,
      };
    }
    case "session_broken":
      return {
        subject: `${who} broke a seal`,
        preheader: `${who}'s streak reset.`,
        heading: `${who} broke a seal.`,
        lines: [`${who} left a focus session without finishing it${d.detail ? `: ${d.detail}` : ""}. Their streak reset.`],
        button: link ? { label: "Open the partner page", href: link } : undefined,
        foot: partnerFoot,
      };
    case "emergency_unlock":
      return {
        subject: `${who} used their emergency unlock`,
        preheader: `It comes back in 7 days.`,
        heading: `${who} used their emergency unlock.`,
        lines: [`${who} ended a focus session with the once-a-week emergency unlock. It doesn't break their streak, and it comes back in 7 days.`],
        quote: d.detail,
        quoteLabel: "What they said",
        foot: partnerFoot,
      };
    case "streak_lost":
      return {
        subject: `${who}'s streak reset`,
        preheader: d.detail || `A day went by without the goal.`,
        heading: `${who}'s streak reset.`,
        lines: [`${d.detail ? `${d.detail}. ` : ""}A day ended short of ${who}'s focus goal, so their streak starts over.`],
        foot: partnerFoot,
      };
    case "invite":
      return {
        subject: `${who} asked you to hold the key`,
        preheader: `Be ${who}'s accountability partner on Sanctum.`,
        heading: `${who} asked you to hold the key.`,
        lines: [
          `${who} uses Sanctum to protect their focus time. They want you as their accountability partner.`,
          `When they ask to leave a session early, you get an email and decide with a PIN only you know. That's all it asks of you.`,
        ],
        button: link ? { label: "Accept the invite", href: link } : undefined,
        foot: `The link works for 48 hours. If you don't know ${who}, ignore this email.`,
      };
    case "unlock_decided":
      return d.approved
        ? {
            subject: `${partner} approved your unlock`,
            preheader: `Your session ended early, without breaking the streak.`,
            heading: `${partner} let you out.`,
            lines: [`${partner} approved your request, so the session ended early. It doesn't count as a broken seal.`],
            quote: d.note,
            quoteLabel: `${partner} said`,
            foot: "Sent by Sanctum because you asked your partner to end a session early.",
          }
        : {
            subject: `${partner} kept your seal`,
            preheader: `Back to it. You can ask again in 15 minutes.`,
            heading: `${partner} kept your seal.`,
            lines: [`${partner} denied your request, so the session goes on. You can ask again in 15 minutes.`],
            quote: d.note,
            quoteLabel: `${partner} said`,
            foot: "Sent by Sanctum because you asked your partner to end a session early.",
          };
    case "magic_link":
      return {
        subject: "Your Sanctum sign-in link",
        preheader: "It works once and expires in an hour.",
        heading: "Sign in to Sanctum.",
        lines: ["Use the button to sign in. The link works once and expires in an hour."],
        button: { label: "Sign in", href: link },
        foot: "If you didn't ask to sign in, ignore this email. Nobody can sign in without the link.",
      };
    case "confirm_signup":
      return {
        subject: "Confirm your email for Sanctum",
        preheader: "One step to finish your account.",
        heading: "Confirm your email.",
        lines: ["Confirm this address to finish your Sanctum account. It's only used to sign in and for your accountability partner."],
        button: { label: "Confirm email", href: link },
        foot: "If you didn't make a Sanctum account, ignore this email.",
      };
  }
}

export function renderEmail(kind: EmailKind, data: EmailData = {}): Email {
  const p = parts(kind, data);
  return { subject: p.subject, preheader: p.preheader, html: html(p), text: text(p) };
}

/** Sample data for the /emails preview and the tests. */
export const SAMPLES: { kind: EmailKind; label: string; data: EmailData }[] = [
  { kind: "unlock_request", label: "Unlock request (to the partner)", data: { who: "Ryan", profile: "Interview Prep", minutesIn: 18, minutesLeft: 42, detail: "Recruiter moved my call up and I need Discord for the shared screen link.", link: "https://partner.example/approve/123" } },
  { kind: "session_broken", label: "Seal broken (to the partner)", data: { who: "Ryan", detail: "Interview Prep: the system clock was set forward 60 min", link: "https://partner.example/" } },
  { kind: "emergency_unlock", label: "Emergency unlock (to the partner)", data: { who: "Ryan", detail: "Family call" } },
  { kind: "streak_lost", label: "Streak lost (to the partner)", data: { who: "Ryan", detail: "Tuesday ended at 45 of 120 minutes" } },
  { kind: "invite", label: "Invite (to a future partner)", data: { who: "Ryan", link: "https://partner.example/invite/abc" } },
  { kind: "unlock_decided", label: "Unlock approved (to you)", data: { partner: "Alex", approved: true, note: "Go. Finish the set after." } },
  { kind: "unlock_decided", label: "Unlock denied (to you)", data: { partner: "Alex", approved: false, note: "Use your phone for the link. Finish the set." } },
  { kind: "magic_link", label: "Sign-in link (Supabase template)", data: { link: "{{ .ConfirmationURL }}" } },
  { kind: "confirm_signup", label: "Confirm email (Supabase template)", data: { link: "{{ .ConfirmationURL }}" } },
];
