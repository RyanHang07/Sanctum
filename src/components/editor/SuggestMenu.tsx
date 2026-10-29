import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { ReactRenderer } from "@tiptap/react";
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from "@tiptap/suggestion";

// The popup list behind "/" (blocks) and "@" (links to Sanctum). Focus stays in the note: the
// arrow keys and Enter reach the list through the suggestion plugin, so typing carries on.

export interface MenuItem {
  id: string;
  title: string;
  /** A second line: what it is, or where it lives. */
  hint?: string;
  /** A short glyph or label shown in the square at the left. */
  icon?: string;
}

interface ListProps {
  items: MenuItem[];
  command: (item: MenuItem) => void;
  label: string;
}

export interface MenuHandle {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

const MenuList = forwardRef<MenuHandle, ListProps>(function MenuList({ items, command, label }, ref) {
  const [at, setAt] = useState(0);
  useEffect(() => setAt(0), [items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!items.length) return false;
      if (event.key === "ArrowDown") return setAt((i) => (i + 1) % items.length), true;
      if (event.key === "ArrowUp") return setAt((i) => (i + items.length - 1) % items.length), true;
      if (event.key === "Enter" || event.key === "Tab") return command(items[at]!), true;
      return false;
    },
  }));
  if (!items.length) {
    return <div className="rounded-panel border border-line-input bg-panel px-3 py-2 text-meta text-muted shadow-toast">Nothing matches.</div>;
  }
  return (
    <div role="listbox" aria-label={label} className="flex max-h-[300px] w-[260px] flex-col overflow-y-auto rounded-panel border border-line-input bg-panel p-1 shadow-toast">
      {items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={i === at}
          // Keep the caret in the note.
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setAt(i)}
          onClick={() => command(item)}
          className={`flex items-center gap-[10px] rounded-control px-2 py-[6px] text-left transition-colors duration-ui ease-ui ${i === at ? "bg-raised" : ""}`}
        >
          <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control border border-line-input bg-app font-mono text-[11px] text-text-2">
            {item.icon ?? "•"}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-body text-text">{item.title}</span>
            {item.hint ? <span className="truncate text-[11px] text-muted">{item.hint}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
});

/**
 * Places the popup under the caret, or above it when there isn't room below (CSS anchor
 * positioning can't follow a caret, and isn't in WebView2 yet: fixed coordinates instead).
 */
function place(el: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return;
  const gap = 6;
  const h = el.offsetHeight || 300;
  const w = el.offsetWidth || 260;
  const below = rect.bottom + gap + h <= window.innerHeight;
  el.style.top = `${below ? rect.bottom + gap : Math.max(gap, rect.top - gap - h)}px`;
  el.style.left = `${Math.max(gap, Math.min(rect.left, window.innerWidth - w - gap))}px`;
}

/** The suggestion plugin's `render`, showing MenuList. */
export function menuRenderer(label: string): SuggestionOptions<MenuItem>["render"] {
  return () => {
    let view: ReactRenderer<MenuHandle, ListProps> | null = null;
    const show = (p: SuggestionProps<MenuItem>) => {
      const el = view!.element as HTMLElement;
      // Wait a frame so the list has its size before it's placed.
      requestAnimationFrame(() => place(el, p.clientRect?.()));
    };
    return {
      onStart: (p) => {
        view = new ReactRenderer(MenuList, { props: { items: p.items, command: p.command, label }, editor: p.editor });
        const el = view.element as HTMLElement;
        el.style.position = "fixed";
        el.style.zIndex = "50";
        el.dataset.suggest = label;
        document.body.appendChild(el);
        show(p);
      },
      onUpdate: (p) => {
        view?.updateProps({ items: p.items, command: p.command, label });
        show(p);
      },
      onKeyDown: (p) => {
        if (p.event.key === "Escape") {
          view?.destroy();
          (view?.element as HTMLElement | undefined)?.remove();
          view = null;
          return true;
        }
        return view?.ref?.onKeyDown(p) ?? false;
      },
      onExit: () => {
        (view?.element as HTMLElement | undefined)?.remove();
        view?.destroy();
        view = null;
      },
    };
  };
}
