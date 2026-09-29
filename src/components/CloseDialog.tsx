import { useEffect, useState } from "react";
import { CheckIcon } from "./icons";
import { Button, Kbd } from "./Button";
import { canQuit } from "../state/appState";
import { useStore } from "../state/store";
import { native } from "../lib/native";

type Choice = "tray" | "quit";

/** Close dialog from design/screens/CloseDialog.dc.html (SPEC 4.0.1). */
export function CloseDialog() {
  const open = useStore((s) => s.closeDialogOpen);
  const appState = useStore((s) => s.appState);
  const dismiss = useStore((s) => s.closeCloseDialog);
  const setCloseAction = useStore((s) => s.setCloseAction);
  const [picked, setPicked] = useState<Choice>("tray");
  const [remember, setRemember] = useState(true);

  const sealed = !canQuit(appState);
  const choice: Choice = sealed ? "tray" : picked;

  const confirm = () => {
    if (remember) setCloseAction(choice);
    dismiss();
    if (choice === "quit" && canQuit(useStore.getState().appState)) void native.quitApp();
    else void native.hideToTray();
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
      desc: sealed
        ? "Not while sealed. Quitting now counts as breaking the seal."
        : "Stops everything until you open it again or restart.",
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
          <p className="m-0 text-body text-muted">
            {sealed ? "You’re sealed. Sanctum will keep running in the tray." : "What should the close button do?"}
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
                className={`flex items-start gap-3 whitespace-normal rounded-panel border p-3 text-text transition-colors duration-ui ease-ui ${
                  on ? "border-sealed-line bg-sealed-tint" : "border-line bg-transparent enabled:hover:border-line-input enabled:hover:bg-line-soft"
                } ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
              >
                <span
                  className={`mt-px box-border flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                    on ? "border border-sealed bg-sealed" : "border-[1.5px] border-check-line"
                  }`}
                >
                  {on ? <span className="h-[6px] w-[6px] rounded-full bg-sealed-on" /> : null}
                </span>
                <span className="flex flex-col gap-[2px] text-left">
                  <span className="text-body font-medium">{o.title}</span>
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
            className="flex h-control items-center gap-2 border-none bg-transparent p-0 text-meta text-text-2 transition-colors duration-ui ease-ui hover:text-text"
          >
            <span
              className={`box-border flex h-[15px] w-[15px] items-center justify-center rounded-[4px] text-sealed-on ${
                remember ? "border border-sealed bg-sealed" : "border-[1.5px] border-check-line"
              }`}
            >
              {remember ? <CheckIcon size={9} /> : null}
            </span>
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
