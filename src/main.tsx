import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AppShell } from "./components/AppShell";
import { TrayPanel } from "./windows/TrayPanel";
import { CompactTimer } from "./windows/CompactTimer";
import { InterceptWindow } from "./windows/Intercept";

// One bundle serves all three windows; the Tauri window config picks the view by hash.
const view = window.location.hash.replace(/^#\/?/, "");

function Root() {
  if (view === "tray") return <TrayPanel />;
  if (view === "compact") return <CompactTimer />;
  if (view === "intercept") return <InterceptWindow />;
  return <AppShell />;
}

// Stub windows are transparent so their rounded corners show.
if (view === "tray" || view === "compact" || view === "intercept") document.body.style.background = "transparent";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
