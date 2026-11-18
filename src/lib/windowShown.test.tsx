import { render } from "@testing-library/react";
import { vi } from "vitest";
import { useWindowShown } from "./windowShown";

// Inside Tauri, a window listener that fails to attach is logged, not left unhandled.
vi.mock("./native", () => ({ inTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onResized: () => Promise.reject("listen failed"),
    onFocusChanged: () => Promise.reject("listen failed"),
    isVisible: async () => true,
    isMinimized: async () => false,
  }),
}));

function Probe() {
  return <span>{useWindowShown() ? "shown" : "hidden"}</span>;
}

describe("window shown, inside Tauri", () => {
  it("logs a listener that fails to attach", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { unmount } = render(<Probe />);
      await vi.waitFor(() => expect(log).toHaveBeenCalledWith("windowShown listen", "listen failed"));
      expect(log).toHaveBeenCalledTimes(2);
      unmount();
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
      log.mockRestore();
    }
  });
});
