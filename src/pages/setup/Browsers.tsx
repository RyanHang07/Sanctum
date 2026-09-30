import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { EVENTS, native, onNative } from "../../lib/native";
import type { BrowserInfo, BrowserStatus } from "../../lib/types";
import { Row, Section } from "./parts";

// Setup > Browser extension (4b): which browsers have the extension, and how to load it.
// Sites and title keywords seal inside the browser only through the extension.

function Dot({ tone }: { tone: "open" | "event" | "broken" }) {
  const bg = tone === "event" ? "bg-event" : tone === "broken" ? "bg-broken" : "bg-faint";
  return <span aria-hidden="true" className={`h-[6px] w-[6px] shrink-0 rounded-full ${bg}`} />;
}

export function browserHint(b: BrowserInfo): string {
  if (b.missing) return "Running without the extension. Its windows stay minimized until it's back.";
  if (!b.connected) return b.registered ? "Extension not loaded." : "Restart Sanctum to register the bridge.";
  const version = b.version ? `v${b.version}` : "Connected";
  if (b.incognito === false) return `${version} · Not allowed in private windows. Sealed sites stay open there.`;
  return `${version} · Seals sites and keywords`;
}

function BrowserRow({ b }: { b: BrowserInfo }) {
  const tone = b.missing ? "broken" : b.connected && b.incognito !== false ? "event" : b.connected ? "broken" : "open";
  return (
    <Row label={b.name} hint={browserHint(b)}>
      <span className="flex shrink-0 items-center gap-[6px] text-meta text-muted">
        <Dot tone={tone} />
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
  const steps = [
    "Open chrome://extensions in the browser and turn on Developer mode.",
    "Choose Load unpacked and pick this folder.",
    "Open the extension's Details and turn on Allow in Incognito.",
  ];
  return (
    <div className="flex flex-col gap-2 px-[14px] py-3">
      <ol className="m-0 flex list-none flex-col gap-[6px] p-0">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-2 text-meta text-text-2">
            <span className="w-3 shrink-0 font-mono text-faint">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <span data-testid="extension-dir" className="min-w-0 grow truncate rounded-control border border-line-input px-2 py-[5px] font-mono text-[11px] text-text-2" title={status.extensionDir}>
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

export function BrowsersSection() {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [showSteps, setShowSteps] = useState(false);

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

  if (!status) return null;
  const installed = status.browsers.filter((b) => b.installed || b.connected);
  const anyConnected = installed.some((b) => b.connected);
  const open = showSteps || !anyConnected;
  return (
    <Section
      title="Browser extension"
      action={
        anyConnected ? (
          <Button variant="quiet" size="sm" onClick={() => setShowSteps(!showSteps)}>
            {showSteps ? "Hide steps" : "Load in another browser"}
          </Button>
        ) : undefined
      }
    >
      {installed.length === 0 ? (
        <p className="m-0 border-b border-line-soft px-[14px] py-3 text-meta text-muted">
          No Chromium browser found. Comet, Chrome, Edge, and Brave are supported.
        </p>
      ) : (
        installed.map((b) => <BrowserRow key={b.exe} b={b} />)
      )}
      {open ? <Steps status={status} /> : null}
    </Section>
  );
}
