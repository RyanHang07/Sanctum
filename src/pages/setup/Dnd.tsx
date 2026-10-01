import { useEffect, useState } from "react";
import { Switch } from "../../components/controls";
import { Row } from "./parts";
import { errorText, native } from "../../lib/native";
import { useStore } from "../../state/store";
import type { DndStatus } from "../../lib/types";

// Setup › General › App (v0.1): Windows Do Not Disturb while sealed. Windows has no public switch,
// so Sanctum uses the internal one; the hint says plainly when this Windows won't allow it.

export function DndRow() {
  const [s, setS] = useState<DndStatus | null>(null);
  const sealed = useStore((st) => st.appState === "sealed");
  useEffect(() => {
    let live = true;
    void native
      .dndStatus()
      .then((v) => live && setS(v))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sealed]);
  const toggle = async (on: boolean) => {
    try {
      setS(await native.dndSetEnabled(on));
    } catch (e) {
      useStore.getState().showNotice({ lead: errorText(e) });
    }
  };
  const hint = !s
    ? undefined
    : !s.supported
      ? "This version of Windows doesn't allow it. Turn Do not disturb on yourself when you seal."
      : s.active
        ? "On now. Notifications come back when the seal ends; alarms still ring."
        : "Notifications hold until the seal ends; alarms still ring.";
  return (
    <Row label="Do not disturb while sealed" hint={hint}>
      <Switch label="Do not disturb while sealed" checked={s?.enabled ?? true} onChange={(v) => void toggle(v)} />
    </Row>
  );
}
