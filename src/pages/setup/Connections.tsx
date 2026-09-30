import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog, Switch } from "../../components/controls";
import { useCalendar } from "../../state/calendar";
import { syncedAgo } from "../../lib/calendar";
import { useNow } from "../../lib/useNow";
import type { GcalStatus } from "../../lib/types";
import { Row, Section } from "./parts";

// Setup > Connections (design/screens/Setup.dc.html): Google Calendar sign-in and the
// calendars Sanctum reads (SPEC 4.3).

function SyncDot({ tone }: { tone: "event" | "broken" | "open" }) {
  const bg = tone === "event" ? "bg-event" : tone === "broken" ? "bg-broken" : "bg-open";
  return <span aria-hidden="true" className={`h-[6px] w-[6px] shrink-0 rounded-full ${bg}`} />;
}

function hintFor(s: GcalStatus, now: number): string {
  if (!s.configured) return "Google Calendar isn't set up in this build. Add a Google OAuth client to src-tauri/.env (docs/self-hosting.md).";
  if (s.connecting) return "Finish signing in in your browser.";
  if (s.needsReconnect) return "Sign-in expired. Google asks again every 7 days while the app is in testing.";
  if (!s.connected) return "Routines and timed items sync to a Sanctum calendar.";
  if (s.error) return s.error;
  return `${s.email ?? "Connected"} · ${s.syncing ? "Syncing" : syncedAgo(s.lastSyncAt, now)}`;
}

function GoogleRow() {
  const status = useCalendar((s) => s.status);
  const { connect, cancelConnect } = useCalendar();
  const now = useNow();
  if (!status) return null;

  let action;
  if (status.connecting) {
    action = (
      <Button variant="quiet" size="sm" onClick={cancelConnect}>
        Cancel
      </Button>
    );
  } else if (status.needsReconnect) {
    action = (
      <Button variant="tint" size="sm" onClick={() => void connect()}>
        Reconnect
      </Button>
    );
  } else if (status.connected) {
    action = (
      <span className="flex shrink-0 items-center gap-[6px] text-meta text-muted">
        <SyncDot tone={status.error ? "broken" : "event"} />
        Two-way sync
      </span>
    );
  } else {
    action = (
      <Button variant="ghost" size="sm" disabled={!status.configured} onClick={() => void connect()}>
        Connect
      </Button>
    );
  }
  return (
    <Row label="Google Calendar" hint={hintFor(status, now)}>
      {action}
    </Row>
  );
}

function CalendarList() {
  const calendars = useCalendar((s) => s.calendars);
  const setSelected = useCalendar((s) => s.setSelected);
  if (!calendars.length) return null;
  return (
    <div className="border-b border-line-soft py-1">
      <span className="block px-[14px] pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">Show in Sanctum</span>
      {calendars.map((c) => (
        <div key={c.id} className="flex h-9 items-center gap-[10px] px-[14px]">
          <span className="min-w-0 grow truncate text-body text-text">
            {c.summary}
            {c.primary ? <span className="text-muted"> · main</span> : null}
            {c.sanctum ? <span className="text-muted"> · routines and timed items</span> : null}
            {!c.writable ? <span className="text-muted"> · read-only</span> : null}
          </span>
          <Switch label={`Show ${c.summary}`} checked={c.selected} onChange={(v) => void setSelected(c.id, v)} />
        </div>
      ))}
    </div>
  );
}

function RemoveDialog({ onClose }: { onClose: () => void }) {
  const removeCalendar = useCalendar((s) => s.removeCalendar);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog label="Remove the Sanctum calendar" onClose={onClose} width={420}>
      <div className="flex flex-col gap-2 px-[18px] pb-4 pt-[18px]">
        <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">Remove the Sanctum calendar.</h1>
        <p className="m-0 text-body text-muted">
          Deletes it and its events from Google, then disconnects. Your routines and items stay in Sanctum.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line bg-panel-footer px-[18px] py-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void removeCalendar().then(onClose);
          }}
        >
          Remove calendar
        </Button>
      </div>
    </Dialog>
  );
}

export function ConnectionsSection() {
  const status = useCalendar((s) => s.status);
  const { syncNow, disconnect } = useCalendar();
  const [removing, setRemoving] = useState(false);
  const connected = !!status?.connected;
  return (
    <Section title="Connections">
      <GoogleRow />
      {connected ? (
        <>
          <CalendarList />
          <div className="flex items-center gap-2 px-[14px] py-[10px]">
            <Button variant="ghost" size="sm" disabled={status?.syncing || status?.needsReconnect} onClick={syncNow}>
              Sync now
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
              Disconnect
            </Button>
            <Button variant="quiet" size="sm" className="ml-auto" onClick={() => setRemoving(true)}>
              Remove Sanctum calendar
            </Button>
          </div>
        </>
      ) : null}
      {removing ? <RemoveDialog onClose={() => setRemoving(false)} /> : null}
    </Section>
  );
}
