import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog, Switch } from "../../components/controls";
import { useCalendar } from "../../state/calendar";
import { syncedAgo } from "../../lib/calendar";
import { useNow } from "../../lib/useNow";
import type { GcalStatus } from "../../lib/types";
import { Row, Section } from "./parts";
import { StatusLine, useCascade, type ConnectionTone } from "./status";

// Setup > Connections (design/screens/Setup.dc.html): Google Calendar sign-in and the
// calendars Sanctum reads (SPEC 4.3).

export function calendarTone(s: GcalStatus | null): ConnectionTone {
  if (!s?.connected && !s?.needsReconnect) return "off";
  return s.needsReconnect || s.error ? "attention" : "ok";
}

/** For the side list's dot: connected, needing a reconnect or showing an error, or not connected. */
export function useCalendarStatus(): ConnectionTone {
  return calendarTone(useCalendar((s) => s.status));
}

function CalendarStatus({ status }: { status: GcalStatus }) {
  const { connect, cancelConnect, syncNow } = useCalendar();
  const tone = calendarTone(status);
  if (!status.configured) return <StatusLine tone="off" testId="calendar-status">Not set up in this build.</StatusLine>;
  if (status.connecting) {
    return (
      <StatusLine
        tone="off"
        testId="calendar-status"
        action={
          <Button variant="quiet" size="sm" onClick={cancelConnect}>
            Cancel
          </Button>
        }
      >
        Finish signing in in your browser.
      </StatusLine>
    );
  }
  if (status.needsReconnect) {
    return (
      <StatusLine
        tone={tone}
        testId="calendar-status"
        action={
          <Button variant="primary" size="sm" onClick={() => void connect()}>
            Reconnect
          </Button>
        }
      >
        Google sign-in expired.
      </StatusLine>
    );
  }
  if (!status.connected) {
    return (
      <StatusLine
        tone={tone}
        testId="calendar-status"
        action={
          <Button variant="primary" size="sm" onClick={() => void connect()}>
            Connect
          </Button>
        }
      >
        Not connected to Google Calendar.
      </StatusLine>
    );
  }
  return (
    <StatusLine
      tone={tone}
      testId="calendar-status"
      action={
        <Button variant="quiet" size="sm" disabled={status.syncing} onClick={syncNow}>
          Sync now
        </Button>
      }
    >
      {status.error ?? "Connected to Google Calendar."}
    </StatusLine>
  );
}

function CalendarList() {
  const calendars = useCalendar((s) => s.calendars);
  const setSelected = useCalendar((s) => s.setSelected);
  if (!calendars.length) return null;
  return (
    <div className="border-b border-line-soft py-1">
      <span className="block px-[14px] pb-1 pt-2 label">Show in Sanctum</span>
      {calendars.map((c) => (
        <div key={c.id} className="flex h-9 items-center gap-[10px] px-[14px]">
          <span className="min-w-0 grow truncate text-body text-text">
            {c.summary}
            {c.primary ? <span className="text-muted"> · main</span> : null}
            {c.sanctum ? <span className="text-muted"> · where Sanctum writes</span> : null}
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
    <Dialog label="Remove the Sanctum calendar" alert onClose={onClose} width={420}>
      <div className="flex flex-col gap-2 px-[18px] pb-4 pt-[18px]">
        <h1 className="m-0 text-[16px] font-semibold tracking-[-0.01em]">This removes the Sanctum calendar.</h1>
        <p className="m-0 text-body text-muted">Deletes it from Google and disconnects. Your routines and items stay in Sanctum.</p>
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
  const { disconnect } = useCalendar();
  const now = useNow();
  const [removing, setRemoving] = useState(false);
  const connected = !!status?.connected;
  const rows = useCascade<HTMLDivElement>(connected);
  return (
    <Section title="Google Calendar">
      {status ? <CalendarStatus status={status} /> : null}
      {status && !status.configured ? (
        <Row label="Add a Google OAuth client" hint="src-tauri/.env, see docs/self-hosting.md">
          <span />
        </Row>
      ) : null}
      {connected ? (
        <div ref={rows}>
          <Row label={status!.email ?? "Google account"}>
            <span className="shrink-0 text-body text-text-2">{status!.syncing ? "Syncing" : syncedAgo(status!.lastSyncAt, now)}</span>
          </Row>
          <CalendarList />
          <div className="flex items-center gap-2 px-[14px] py-[10px]">
            <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
              Disconnect
            </Button>
            <Button variant="quiet" size="sm" className="ml-auto" onClick={() => setRemoving(true)}>
              Remove Sanctum calendar
            </Button>
          </div>
        </div>
      ) : null}
      {removing ? <RemoveDialog onClose={() => setRemoving(false)} /> : null}
    </Section>
  );
}
