import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { AboutSection, StartOverSection } from "./About";
import { native } from "../../lib/native";
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

describe("Start over", () => {
  it("erases everything after a typed confirmation, then reloads into setup", async () => {
    await native.createProfile({ name: "Deep Work" });
    await native.saveNote({ title: "Keep?", body: "no" });
    const reload = vi.fn();
    render(
      <>
        <StartOverSection reload={reload} />
        <Toast />
      </>,
    );
    const section = within(screen.getByRole("region", { name: "Start over" }));
    fireEvent.click(section.getByRole("button", { name: "Start over" }));
    const erase = section.getByRole("button", { name: "Erase and start over" });
    expect(erase).toBeDisabled();
    fireEvent.change(section.getByLabelText("Type start over to confirm"), { target: { value: "Start Over" } });
    await act(async () => fireEvent.click(erase));
    expect(reload).toHaveBeenCalledOnce();
    expect(await native.listProfiles()).toEqual([]);
    expect(await native.listNotes()).toEqual([]);
    // First-run setup shows: nothing marks it done, and dev builds won't reseed.
    expect(await native.getSetting("onboarded")).toBeNull();
    expect(await native.getSetting("dev_seeded")).toBe("1");
  });

  it("waits while sealed", async () => {
    act(() => useStore.getState().setAppState("sealed"));
    render(<StartOverSection reload={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Waits until the seal ends" })).toBeDisabled();
  });
});
