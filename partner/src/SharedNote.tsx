import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { decryptBytes, decryptJson } from "./shareCrypto";
import { useTabTitle } from "./title";

// A shared note (v0.2): /n/<token>#<key>. The server hands over ciphertext; the key in the
// link's #fragment (never sent anywhere) decrypts it here. The note is drawn from its blocks
// with React elements: no HTML from the note is ever inserted, so nothing in a note can run on
// this site (which also holds partners' sign-ins). Edits arrive live; the link dies at expiry.

interface Node {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

interface Shared {
  title: string;
  doc: Node;
}

type State =
  | { kind: "loading" }
  | { kind: "ready"; note: Shared; images: Record<string, string>; expiresAt: number }
  | { kind: "empty" }
  | { kind: "gone" }
  | { kind: "nokey" }
  | { kind: "badkey" }
  | { kind: "offline" };

/** Only web and mail links open; anything else (javascript:, data:, …) is shown as text. */
const safeHref = (href: unknown) => (typeof href === "string" && /^(https?:|mailto:)/i.test(href) ? href : null);
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && v >= lo && v <= hi ? Math.floor(v) : undefined);

function Text({ n }: { n: Node }): ReactNode {
  let out: ReactNode = n.text ?? "";
  for (const m of n.marks ?? []) {
    if (m.type === "bold") out = <strong>{out}</strong>;
    else if (m.type === "italic") out = <em>{out}</em>;
    else if (m.type === "strike") out = <s>{out}</s>;
    else if (m.type === "underline") out = <u>{out}</u>;
    else if (m.type === "code") out = <code>{out}</code>;
    else if (m.type === "link") {
      const href = safeHref(m.attrs?.href);
      if (href)
        out = (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {out}
          </a>
        );
    }
  }
  return out;
}

/** Only signed links into Sanctum's shared-images bucket are fetched. */
const IMAGE_PREFIX = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/storage/v1/object/sign/note-shares/`;
const safeImageUrl = (url: unknown) => (typeof url === "string" && url.startsWith(IMAGE_PREFIX) && !url.includes("..") ? url : undefined);

/** An image: its encrypted bytes from the signed URL, decrypted here into a local blob. */
function SharedImage({ url, alt, k }: { url: string | undefined; alt: string; k: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let made: string | null = null;
    void fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => decryptBytes(k, new Uint8Array(buf)))
      .then((bytes) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes as BlobPart]));
        setSrc(made);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url, k]);
  return src ? <img src={src} alt={alt} /> : <div className="img-wait" aria-label="Image loading" />;
}

function Blocks({ nodes, ctx }: { nodes: Node[] | undefined; ctx: Ctx }) {
  return <>{(nodes ?? []).map((n, i) => <Block key={i} n={n} ctx={ctx} />)}</>;
}

interface Ctx {
  images: Record<string, string>;
  k: string;
}

function Block({ n, ctx }: { n: Node; ctx: Ctx }): ReactNode {
  const kids = <Blocks nodes={n.content} ctx={ctx} />;
  switch (n.type) {
    case "text":
      return <Text n={n} />;
    case "paragraph":
      return <p>{kids}</p>;
    case "heading": {
      const level = num(n.attrs?.level, 1, 3) ?? 2;
      return level === 1 ? <h1>{kids}</h1> : level === 2 ? <h2>{kids}</h2> : <h3>{kids}</h3>;
    }
    case "bulletList":
      return <ul>{kids}</ul>;
    case "orderedList":
      return <ol start={num(n.attrs?.start, 1, 100000)}>{kids}</ol>;
    case "listItem":
      return <li>{kids}</li>;
    case "taskList":
      return <ul className="tasks">{kids}</ul>;
    case "taskItem":
      return (
        <li className={n.attrs?.checked === true ? "done" : undefined}>
          <input type="checkbox" checked={n.attrs?.checked === true} disabled aria-label={n.attrs?.checked === true ? "Done" : "Not done"} />
          <div>{kids}</div>
        </li>
      );
    case "blockquote":
      return <blockquote>{kids}</blockquote>;
    case "callout":
      return <div className="callout">{kids}</div>;
    case "horizontalRule":
      return <hr />;
    case "hardBreak":
      return <br />;
    case "codeBlock":
      return (
        <pre>
          <code>{kids}</code>
        </pre>
      );
    case "details":
      return <details open={n.attrs?.open === true}>{kids}</details>;
    case "detailsSummary":
      return <summary>{kids}</summary>;
    case "detailsContent":
      return <div>{kids}</div>;
    case "table":
      return (
        <div className="table">
          <table>
            <tbody>{kids}</tbody>
          </table>
        </div>
      );
    case "tableRow":
      return <tr>{kids}</tr>;
    case "tableHeader":
      return (
        <th colSpan={num(n.attrs?.colspan, 1, 50)} rowSpan={num(n.attrs?.rowspan, 1, 50)}>
          {kids}
        </th>
      );
    case "tableCell":
      return (
        <td colSpan={num(n.attrs?.colspan, 1, 50)} rowSpan={num(n.attrs?.rowspan, 1, 50)}>
          {kids}
        </td>
      );
    case "image": {
      const id = /^noteimg:(\d+)$/.exec(String(n.attrs?.src ?? ""))?.[1];
      return <SharedImage url={id ? safeImageUrl(ctx.images[id]) : undefined} alt={typeof n.attrs?.alt === "string" ? n.attrs.alt : ""} k={ctx.k} />;
    }
    case "mention":
      return <span className="link">@{typeof n.attrs?.label === "string" ? n.attrs.label : ""}</span>;
    default:
      // Unknown block: its text, nothing else.
      return kids;
  }
}

const until = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/** Keeps shared notes out of search engines and referrers, while this page is open. */
function usePrivatePage() {
  useEffect(() => {
    const metas = [
      Object.assign(document.createElement("meta"), { name: "robots", content: "noindex, nofollow" }),
      Object.assign(document.createElement("meta"), { name: "referrer", content: "no-referrer" }),
    ];
    metas.forEach((m) => document.head.appendChild(m));
    return () => metas.forEach((m) => m.remove());
  }, []);
}

export function SharedNote({ token }: { token: string }) {
  const k = location.hash.slice(1);
  const [state, setState] = useState<State>(() => (/^[A-Za-z0-9_-]{43}$/.test(k) ? { kind: "loading" } : { kind: "nokey" }));
  usePrivatePage();
  useTabTitle(state.kind === "ready" ? "Shared note" : state.kind === "gone" ? "Link expired" : "Shared note");

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_note_share", { share_token: token });
    if (error) return setState((s) => (s.kind === "ready" ? s : { kind: "offline" }));
    const row = (data as { cipher: string; images: Record<string, string>; expires_at: string }[] | null)?.[0];
    if (!row) return setState({ kind: "gone" });
    if (!row.cipher) return setState({ kind: "empty" });
    try {
      const note = await decryptJson<Shared>(k, row.cipher);
      setState({ kind: "ready", note, images: row.images ?? {}, expiresAt: Date.parse(row.expires_at) });
    } catch {
      setState({ kind: "badkey" });
    }
  }, [token, k]);

  useEffect(() => {
    if (state.kind === "nokey") return;
    void load();
    // Live: the app announces each edit; a slow check covers a missed one.
    const channel = supabase
      .channel(`note-share:${token}`)
      .on("broadcast", { event: "changed" }, () => void load())
      .subscribe();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      clearInterval(t);
      void supabase.removeChannel(channel);
    };
  }, [load, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // The link dies on time even with the page left open.
  const expiresAt = state.kind === "ready" ? state.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const t = setTimeout(() => setState({ kind: "gone" }), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [expiresAt]);

  const message = (title: string, body: string) => (
    <div className="shared-empty">
      <h1 className="headline">{title}</h1>
      <p className="muted">{body}</p>
    </div>
  );

  return (
    <main className="sheet">
      <header className="brand">
        <img src="/mark.svg" width="18" height="18" alt="" />
        <span>Sanctum</span>
        <span className="context">{state.kind === "ready" ? `Read only · until ${until(state.expiresAt)}` : "Shared note"}</span>
      </header>
      {state.kind === "loading" ? <p className="muted">Opening…</p> : null}
      {state.kind === "nokey" ? message("This link is missing its key.", "Shared notes are encrypted; the key is the part after # in the link. Ask for the full link.") : null}
      {state.kind === "badkey" ? message("This link's key doesn't fit.", "The note can't be read with it. Ask for the link again.") : null}
      {state.kind === "gone" ? message("This note isn't shared anymore.", "The link expired, or sharing was stopped.") : null}
      {state.kind === "empty" ? message("Almost there.", "The note is on its way. This page updates on its own.") : null}
      {state.kind === "offline" ? message("Can't reach Sanctum.", "Check your connection; this page tries again on its own.") : null}
      {state.kind === "ready" ? (
        <article className="shared-note">
          <h1 className="shared-title">{state.note.title.trim() || "Untitled"}</h1>
          <Block n={state.note.doc} ctx={{ images: state.images, k }} />
        </article>
      ) : null}
    </main>
  );
}
