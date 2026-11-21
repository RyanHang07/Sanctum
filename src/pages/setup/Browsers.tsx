import { useEffect, useState } from "react";
import { Button } from "../../components/Button";
import { EVENTS, errorText, native, onNative } from "../../lib/native";
import { useStore } from "../../state/store";
import { useTheme } from "../../state/theme";
import type { BrowserInfo, BrowserStatus } from "../../lib/types";
import { Row, Section } from "./parts";
import { StatusDot, useCascade, type ConnectionTone } from "./status";

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

/** Green once any browser is connected; red while browsers are found but none is (2026-11-20). */
export function browserTone(s: BrowserStatus | null): ConnectionTone {
  const list = s ? present(s) : [];
  if (!list.length) return "off";
  return list.some((b) => b.connected && !b.missing) ? "ok" : "attention";
}

/** For the side list's dot: green with one browser connected, red with none, a ring with no browser. */
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
  // Each browser says itself: green connected, red not (2026-11-20). Private windows off shows in the hint.
  const tone: ConnectionTone = b.connected && !b.missing ? "ok" : "attention";
  return (
    <Row label={b.name} hint={browserHint(b)}>
      <span className={`flex shrink-0 items-center gap-[6px] text-body ${tone === "ok" ? "text-ok-text" : "text-text-2"}`}>
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

function ExtensionIntro({ open, onToggle }: { open: boolean; onToggle?: () => void }) {
  const scheme = useTheme((s) => s.theme.scheme);
  const guide = () => void native.openSite("docs/extension", scheme).catch((e) => useStore.getState().showNotice({ lead: errorText(e) }));
  return (
    <div data-testid="extension-intro" className="flex min-h-12 items-center gap-[10px] border-b border-line-soft px-[14px] py-2">
      <span className="min-w-0 grow text-body text-text-2">Seals sites and keyword tabs inside your browser.</span>
      <Button variant="ghost" size="sm" onClick={guide}>
        How to use it
      </Button>
      {/* With nothing connected the steps stay open: they are the next step. */}
      {onToggle ? (
        <Button variant="quiet" size="sm" onClick={onToggle}>
          {open ? "Hide steps" : "Show steps"}
        </Button>
      ) : null}
    </div>
  );
}

/** In Setup the section is already named Browser Extension, so the box drops its title; first run keeps it. */
export function BrowsersSection({ titled = false }: { titled?: boolean } = {}) {
  const status = useBrowsers();
  // null follows the state: steps show until a browser connects, then on request.
  const [showSteps, setShowSteps] = useState<boolean | null>(null);
  const rows = useCascade<HTMLDivElement>(!!status);

  if (!status) return null;
  const list = present(status);
  const anyConnected = list.some((b) => b.connected);
  const open = showSteps ?? !anyConnected;
  const toggle = () => setShowSteps(!open);

  return (
    <Section title="Browser Extension" titled={titled}>
      {/* What it is and where to read more, in place of a status line (2026-11-20): each
          browser below carries its own green or red dot. */}
      <ExtensionIntro open={open} onToggle={anyConnected ? toggle : undefined} />
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
