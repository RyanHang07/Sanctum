import { Mark } from "../components/Mark";
import { native } from "../lib/native";

/** Stub for the tray panel window (SPEC 4.0.1, design/screens/Tray.dc.html). Built in Milestone 12. */
export function TrayPanel() {
  return (
    <div className="box-border flex h-full flex-col overflow-hidden rounded-dialog border border-line-input bg-panel">
      <div className="flex items-center gap-[10px] border-b border-line px-[14px] py-3">
        <Mark size={16} />
        <span className="text-body font-semibold">Sanctum</span>
      </div>
      <p className="m-0 grow px-[14px] py-3 text-meta text-muted">Tray panel arrives in Milestone 12.</p>
      <div className="flex border-t border-line bg-panel-footer px-[14px] py-[10px]">
        <button
          type="button"
          onClick={() => void native.showMain()}
          className="h-control w-full rounded-control border border-line-input bg-raised text-meta text-text transition-colors duration-ui ease-ui hover:border-check-line hover:bg-line"
        >
          Open Sanctum
        </button>
      </div>
    </div>
  );
}
