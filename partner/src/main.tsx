import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../../design/tokens.css";
import "./styles.css";
import "./site/site.css";
import "./site/docs.css";
import { App } from "./App";
import { applyTheme } from "./site/theme";

// The visitor's light/dark pick, before the first paint.
applyTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
