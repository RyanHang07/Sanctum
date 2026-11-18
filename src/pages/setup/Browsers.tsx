import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { EVENTS, native, onNative } from "../../lib/native";
import type { BrowserInfo, BrowserStatus } from "../../lib/types";
import { Row, Section } from "./parts";
import { listNames, StatusDot, StatusLine, useCascade, type ConnectionTone } from "./status";

// Setup > Browser Extension (4b): which browsers have the extension, and how to load it.
// Sites and title keywords seal inside the browser only through the extension.

/** The browsers' extension status, refreshed on every bridge event. null until the first read. */
function useBrowsers(): BrowserStatus | null {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void native.browserStatus().then((s) => live && setStatus(s)).catch(() => undefined);
    load();
    const off = onNative(EVENTS.browser, load);
    return () => {
      live = false;
      void off.then((f) => f());
    };
  }, []);
  return status;
}

/** Browsers on this PC, or with the extension talking to Sanctum. */
const present = (s: BrowserStatus) => s.browsers.filter((b) => b.installed || b.connected);

export function browserTone(s: BrowserStatus | null): ConnectionTone {
  const list = s ? present(s) : [];
  if (!list.length) return "off";
  return list.every((b) => b.connected && !b.missing && b.incognito !== false) ? "ok" : "attention";
}

/** For the side list's dot: every browser connected, one needing something, or none found. */
export function useBrowserStatus(): ConnectionTone {
  return browserTone(useBrowsers());
}

export function browserHint(b: BrowserInfo): string {
  if (b.missing) return "Extension removed. Its windows stay minimized.";
  if (!b.connected) return b.registered ? "Extension not loaded." : "Restart Sanctum to finish setup.";
  const version = b.version ? `v${b.version}` : "Connected";
  return b.incognito === false ? `${version} · Off in private windows` : version;
}

function BrowserRow({ b }: { b: BrowserInfo }) {
  const tone: ConnectionTone = b.connected && !b.missing && b.incognito !== false ? "ok" : b.connected || b.missing ? "attention" : "off";
  return (
    <Row label={b.name} hint={browserHint(b)}>
      <span className="flex shrink-0 items-center gap-[6px] text-body text-text-2">
        <StatusDot tone={tone} />
        {b.connected ? "Connected" : "Not connected"}
      </span>
    </Row>
  );
}

function Steps({ status }: { status: BrowserStatus }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(status.extensionDir).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const steps = ["Open chrome://extensions and turn on Developer mode.", "Choose Load unpacked, then this folder.", "In Details, turn on Allow in Incognito."];
  return (
    <div className="flex flex-col gap-2 px-[14px] py-3">
      <ol className="m-0 flex list-none flex-col gap-[6px] p-0">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-2 text-body text-text-2">
            <span className="w-3 shrink-0 font-mono text-muted">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <span data-testid="extension-dir" className="min-w-0 grow truncate rounded-control border border-line-input px-2 py-[5px] font-mono text-meta text-text-2" title={status.extensionDir}>
          {status.extensionDir}
        </span>
        <Button variant="ghost" size="sm" onClick={copy}>
          {copied ? "Copied" : "Copy path"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void native.browserOpenExtensionDir()}>
          Open folder
        </Button>
      </div>
    </div>
  );
}

/** One sentence for the whole set, worst first: removed, then not loaded, then private windows. */
function summary(list: BrowserInfo[]): string {
  const names = (f: (b: BrowserInfo) => boolean) => listNames(list.filter(f).map((b) => b.name));
  const missing = names((b) => !!b.missing);
  if (missing) return `Removed from ${missing}. Its windows stay minimized.`;
  const off = names((b) => !b.connected);
  if (off) return `Not connected in ${off}. Sites aren’t blocked there yet.`;
  const incognito = names((b) => b.incognito === false);
  if (incognito) return `Private windows in ${incognito} aren’t covered.`;
  return `Connected in ${names(() => true)}.`;
}

/** In Setup the section is already named Browser Extension, so the box drops its title; first run keeps it. */
export function BrowsersSection({ titled = false }: { titled?: boolean } = {}) {
  const status = useBrowsers();
  // null follows the state: steps show until a browser connects, then on request.
  const [showSteps, setShowSteps] = useState<boolean | null>(null);
  const rows = useCascade<HTMLDivElement>(!!status);

  if (!status) return null;
  const list = present(status);
  const tone = browserTone(status);
  const anyConnected = list.some((b) => b.connected);
  const open = showSteps ?? !anyConnected;
  const toggle = () => setShowSteps(!open);

  let action;
  if (tone === "attention" && !open) {
    action = (
      <Button variant="primary" size="sm" onClick={toggle}>
        {anyConnected ? "Show steps" : "Install the extension"}
      </Button>
    );
  } else if (anyConnected) {
    // With nothing connected the steps stay open: they are the next step.
    action = (
      <Button variant="quiet" size="sm" onClick={toggle}>
        {open ? "Hide steps" : "Load in another browser"}
      </Button>
    );
  }

  return (
    <Section title="Browser Extension" titled={titled}>
      <StatusLine tone={tone} testId="browser-status" action={action}>
        {list.length ? summary(list) : "No supported browser found."}
      </StatusLine>
      <div ref={rows}>
        {list.length === 0 ? (
          <Row label="Comet, Chrome, Edge, and Brave work">
            <span />
          </Row>
        ) : (
          list.map((b) => <BrowserRow key={b.exe} b={b} />)
        )}
      </div>
      {open ? <Steps status={status} /> : null}
    </Section>
  );
}
