import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AboutSection } from "./About";
import { Toast } from "../../components/Toast";
import { useStore } from "../../state/store";
import { resetMockBackend } from "../../lib/mockBackend";

const initial = useStore.getState();

beforeEach(() => {
  resetMockBackend();
  useStore.setState(initial, true);
});

describe("About", () => {
  it("shows the version, checks for updates, and copies diagnostics", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(
      <>
        <AboutSection />
        <Toast />
      </>,
    );
    const about = within(screen.getByRole("region", { name: "About" }));
    expect(await about.findByText("Sanctum 0.1.0")).toBeInTheDocument();
    await act(async () => fireEvent.click(about.getByRole("button", { name: "Check for updates" })));
    expect(about.getByText("You have the latest version.")).toBeInTheDocument();
    await act(async () => fireEvent.click(about.getByRole("button", { name: "Copy diagnostics" })));
    expect(writeText).toHaveBeenCalledWith("Sanctum 0.1.0 (mock)");
    expect(screen.getByRole("status")).toHaveTextContent("Diagnostics copied.");
  });
});
