import { useEffect, useRef, type ReactNode } from "react";
import { gsap, RISE_FROM, RISE_STAGGER, RISE_TO } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";

// The status line that opens each connection screen (Protection, Browser, Calendar, Partner):
// a dot, one sentence of what's true, and the one next step. The same tone feeds the side list.

/** ok: working. attention: set up, but something needs doing. off: not set up. */
export type ConnectionTone = "ok" | "attention" | "off";

/** Fine is neutral; needing something is the second color; off is a hollow ring. */
export function StatusDot({ tone }: { tone: ConnectionTone }) {
  const look = tone === "ok" ? "bg-muted" : tone === "attention" ? "bg-second" : "border border-line-input";
  return <span aria-hidden="true" data-tone={tone} className={`h-2 w-2 shrink-0 rounded-full ${look}`} />;
}

export function StatusLine({ tone, testId, children, action }: { tone: ConnectionTone; testId: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div data-testid={testId} data-tone={tone} className="flex min-h-12 items-center gap-[10px] border-b border-line-soft px-[14px] py-2">
      <StatusDot tone={tone} />
      <span className="min-w-0 grow text-body text-text">{children}</span>
      {action}
    </div>
  );
}

/** The detail rows under a status line rise in as a cascade once the screen has its data. */
export function useCascade<T extends HTMLElement>(ready: boolean) {
  const ref = useRef<T>(null);
  const { run } = useMotion(ref);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!ready || done.current || !el) return;
    done.current = true;
    const rows = Array.from(el.children);
    if (!rows.length) return;
    run(() => gsap.timeline({ id: "setup-cascade" }).fromTo(rows, RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }));
  }, [ready, run]);
  return ref;
}

/** "Comet", "Comet and Chrome", "Comet, Chrome, and Edge". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
