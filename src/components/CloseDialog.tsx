import { useEffect, useState } from "react";
import { CheckMark } from "./controls";
import { Button, Kbd } from "./Button";
import { canQuit } from "../state/appState";
import { useStore } from "../state/store";
import { errorText, native } from "../lib/native";
import { quitSaved } from "../state/quit";
import { clock, countdown } from "../lib/time";

type Choice = "tray" | "quit";

/** While sealed, what the dialog says about quitting: when it opens, if a session knows its end. */
export function quitOpens(endsAt: number | null | undefined): { subtitle: string; quit: string } {
  if (!endsAt) return { subtitle: "You’re sealed. Sanctum will keep running in the tray.", quit: "Not while sealed. Quitting now counts as breaking the seal." };
  const at = clock(endsAt);
  return { subtitle: `Quit opens at ${at}. Until then, Sanctum keeps running in the tray.`, quit: `Opens at ${at}. Quitting before then breaks the seal.` };
}

/** Close dialog (design/gate-canvas/project/CloseDialog.dc.html, SPEC 4.0.1). */
export function CloseDialog() {
  const open = useStore((s) => s.closeDialogOpen);
  const appState = useStore((s) => s.appState);
  const dismiss = useStore((s) => s.closeCloseDialog);
  const setCloseAction = useStore((s) => s.setCloseAction);
  const session = useStore((s) => s.session);
  const [picked, setPicked] = useState<Choice>("tray");
  const [remember, setRemember] = useState(true);

  const sealed = !canQuit(appState);
  const choice: Choice = sealed ? "tray" : picked;
  const opens = quitOpens(session?.endsAt);

  const confirm = () => {
    if (remember) setCloseAction(choice);
    dismiss();
    // The window stays up if this fails: say why.
    const failed = (e: unknown) => useStore.getState().showNotice({ lead: errorText(e) });
    if (choice === "quit" && canQuit(useStore.getState().appState)) quitSaved().catch(failed);
    else native.hideToTray().catch(failed);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
      else if (e.key === "Enter") confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  const options = [
    {
      id: "tray" as const,
      title: "Minimize to tray",
      desc: "Keeps blocking, check-ins, and calendar sync running. Click the tray icon to reopen.",
    },
    {
      id: "quit" as const,
      title: "Quit Sanctum",
      desc: sealed ? opens.quit : "Stops everything until you open it again or restart.",
    },
  ];

  return (
    <div className="fixed inset-0 z-40 animate-fade-in bg-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Close Sanctum"
        className="absolute left-1/2 top-[170px] flex w-[420px] -translate-x-1/2 animate-rise-in flex-col overflow-hidden rounded-dialog border border-line-input bg-panel shadow-dialog"
      >
        <div className="flex flex-col gap-1 px-[18px] pb-3 pt-[18px]">
          <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">Close Sanctum</h1>
          <p data-testid="close-subtitle" className="m-0 text-body text-muted">
            {sealed ? opens.subtitle : "Choose what the close button does."}
          </p>
        </div>
        <div role="radiogroup" aria-label="On close" className="flex flex-col gap-[6px] px-[18px] pb-[14px]">
          {options.map((o) => {
            const on = o.id === choice;
            const disabled = sealed && o.id === "quit";
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={on}
                aria-disabled={disabled || undefined}
                disabled={disabled}
                onClick={() => setPicked(o.id)}
                className={`flex items-start gap-3 whitespace-normal rounded-panel border p-3 transition-colors duration-ui ease-ui ${
                  on ? "border-sealed-line bg-sealed-tint" : "border-line bg-transparent enabled:hover:border-line-input enabled:hover:bg-raised"
                } ${disabled ? "cursor-not-allowed text-muted" : "cursor-pointer text-text"}`}
              >
                <span
                  className={`mt-px box-border flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    on ? "border border-sealed bg-sealed" : "border-[1.5px] border-check-line"
                  }`}
                >
                  {on ? <span className="h-[6px] w-[6px] rounded-full bg-sealed-on" /> : null}
                </span>
                <span className="flex min-w-0 grow flex-col gap-[2px] text-left">
                  <span className="flex items-center gap-2 text-body font-medium">
                    {o.title}
                    {/* While sealed, the tray choice carries the seal's time left: seal timing is the accent. */}
                    {sealed && o.id === "tray" && session ? (
                      <span data-testid="close-left" className="ml-auto font-mono text-micro font-normal text-sealed-text">
                        {countdown(session.remainingMs)} left
                      </span>
                    ) : null}
                  </span>
                  <span className="text-meta text-muted">{o.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={remember}
            onClick={() => setRemember(!remember)}
            className="check-pop flex h-control items-center gap-2 border-none bg-transparent p-0 text-meta text-text-2 transition-colors duration-ui ease-ui hover:text-text"
          >
            <CheckMark done={remember} />
            Don't ask again
          </button>
          <Button variant="ghost" className="ml-auto" onClick={dismiss}>
            Cancel
          </Button>
          <Button variant="primary" className="gap-[10px] px-[14px]" onClick={confirm}>
            {choice === "quit" ? "Quit" : "Minimize"}
            <Kbd onFill>↵</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}
