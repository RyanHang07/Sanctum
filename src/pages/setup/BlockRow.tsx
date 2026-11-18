import { useRef, type ReactNode } from "react";
import { ChevronIcon } from "../../components/icons";
import { DUR, EASE, gsap, RISE_FROM, RISE_STAGGER, RISE_TO, useGSAP } from "../../lib/gsap";
import { useMotion } from "../../lib/useMotion";

/**
 * One row of Setup › Distractions › When it blocks (decided 2026-11-16): a name, a one-line
 * summary, and its switch. A row with something to edit opens like Pending: it grows to its
 * height, then its contents rise in one after the next.
 */
export function BlockRow({
  title,
  summary,
  summaryTestId,
  control,
  open = false,
  onToggle,
  children,
}: {
  title: string;
  summary: ReactNode;
  summaryTestId?: string;
  control: ReactNode;
  open?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const { run } = useMotion(body);
  useGSAP(
    () => {
      const el = body.current;
      if (!open || !el) return;
      const parts = Array.from(el.firstElementChild?.children ?? []);
      run(() =>
        gsap
          .timeline({ id: `block-row-${title}` })
          .fromTo(el, { height: 0 }, { height: "auto", duration: DUR.state, ease: EASE.glide, clearProps: "height" })
          .fromTo(parts, RISE_FROM, { ...RISE_TO, stagger: RISE_STAGGER }, "-=0.06"),
      );
    },
    { scope: body, dependencies: [open] },
  );
  const editable = !!children && !!onToggle;
  const text = (
    <span className="flex min-w-0 grow flex-col gap-[2px]">
      <span className="text-body text-text">{title}</span>
      <span data-testid={summaryTestId} className="flex min-w-0 items-center gap-2 truncate text-micro text-muted">
        {summary}
      </span>
    </span>
  );
  return (
    <section aria-label={title} className="border-b border-line-soft last:border-b-0">
      <div className="flex min-h-12 items-center gap-[10px] pr-[14px]">
        {editable ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex min-h-12 min-w-0 grow items-center gap-[10px] py-[6px] pl-[14px] text-left transition-colors duration-ui ease-ui hover:bg-raised"
          >
            <ChevronIcon size={10} className={`shrink-0 text-muted transition-transform duration-ui ease-ui ${open ? "" : "-rotate-90"}`} />
            {text}
          </button>
        ) : (
          <div className="flex min-w-0 grow items-center gap-[10px] py-[6px] pl-[14px]">
            <span className="w-[10px] shrink-0" />
            {text}
          </div>
        )}
        {control}
      </div>
      {editable && open ? (
        <div ref={body} data-testid={`${title} editor`} className="overflow-hidden">
          <div className="flex flex-col gap-3 pb-[14px] pl-[34px] pr-[14px]">{children}</div>
        </div>
      ) : null}
    </section>
  );
}
