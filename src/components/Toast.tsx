import { LockIcon } from "./icons";
import { lockedToast } from "../state/appState";
import { useStore } from "../state/store";

/**
 * Bottom-center toast. Shows the locked-tab message from HomeFocus.dc.html
 * ("Week is locked while you're sealed. End focus to open it.") or a general notice.
 */
export function Toast() {
  const tab = useStore((s) => s.lockedToast);
  const notice = useStore((s) => s.notice);
  const dismiss = useStore((s) => s.dismissToast);
  const msg = tab ? lockedToast(tab) : notice;
  if (!msg) return null;
  return (
    <div
      role="status"
      onClick={dismiss}
      className="absolute bottom-7 left-1/2 z-20 flex max-w-[calc(100%-56px)] -translate-x-1/2 animate-rise-in items-center gap-3 rounded-panel border border-line-input bg-toast py-[10px] pl-[14px] pr-3 shadow-toast"
    >
      {tab ? <LockIcon size={14} className="shrink-0 text-sealed" /> : null}
      <span className="whitespace-nowrap text-body text-text">{msg.lead}</span>
      {msg.rest ? <span className="truncate text-body text-muted">{msg.rest}</span> : null}
      {!tab && notice?.action ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            notice.action!.run();
            dismiss();
          }}
          className="shrink-0 rounded-control px-2 py-[2px] text-body font-medium text-sealed-text transition-colors duration-ui ease-ui hover:bg-line-soft hover:text-sealed-text-hover"
        >
          {notice.action.label}
        </button>
      ) : null}
    </div>
  );
}
