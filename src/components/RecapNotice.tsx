import { Button } from "./Button";
import { useStore } from "../state/store";
import { recapLines, useRecap } from "../state/recap";

// The weekly recap card (v0.3): bottom right, once a week, until closed.

export function RecapNotice() {
  const { recap, close } = useRecap();
  const navigate = useStore((s) => s.navigate);
  if (!recap) return null;
  const { lead, lines } = recapLines(recap);
  return (
    <div role="region" aria-label="Last week" className="flex w-[320px] animate-rise-in flex-col gap-3 rounded-panel border border-line-input bg-toast p-[14px] shadow-toast">
      <div className="flex flex-col gap-1">
        <span className="text-body font-medium text-text">{lead}</span>
        {lines.map((l) => (
          <span key={l} className="text-meta text-text-2">
            {l}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={close}>
          Close
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            close();
            navigate("stats");
          }}
        >
          See the week
        </Button>
      </div>
    </div>
  );
}
